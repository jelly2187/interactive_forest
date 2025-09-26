import os
import base64
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Tuple

import cv2
import numpy as np
from segment_anything import sam_model_registry, SamPredictor

@dataclass
class Session:
    id: str
    image_bgr: np.ndarray
    h: int
    w: int
    tmp_dir: Path
    predictor: SamPredictor
    image_name: str  # 用于导出命名（stem）

class SamEngine:
    def __init__(self, weights_path: Optional[str] = None, model_type: Optional[str] = None, device: Optional[str] = None):
        self.model_type = model_type or os.getenv("SAM_MODEL_TYPE", "vit_h")
        self.device = device or os.getenv("SAM_DEVICE", "cuda")
        self.weights_path = weights_path or os.getenv("SAM_WEIGHTS")
        if not self.weights_path or not os.path.exists(self.weights_path):
            raise RuntimeError("SAM weights not found. Set SAM_WEIGHTS to a valid .pth file.")
        self.sessions: dict[str, Session] = {}
        self._model = sam_model_registry[self.model_type](checkpoint=self.weights_path).to(self.device)

    def _decode_image(self, image_path: Optional[str], image_b64: Optional[str]) -> np.ndarray:
        if image_path:
            img = cv2.imread(image_path, cv2.IMREAD_COLOR)
            if img is None:
                raise ValueError(f"Failed to read image: {image_path}")
            return img
        if image_b64:
            if "," in image_b64:
                image_b64 = image_b64.split(",", 1)[1]
            data = base64.b64decode(image_b64)
            arr = np.frombuffer(data, np.uint8)
            img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
            if img is None:
                raise ValueError("Failed to decode base64 image")
            return img
        raise ValueError("Either image_path or image_b64 must be provided.")

    def init_session(self, image_path: Optional[str], image_b64: Optional[str], image_name: Optional[str]) -> Session:
        image_bgr = self._decode_image(image_path, image_b64)
        h, w = image_bgr.shape[:2]
        sid = str(uuid.uuid4())
        # 增加时间前缀，便于溯源与调试：YYYYMMDD_HHMMSS_<session-uuid>
        import time
        time_prefix = time.strftime('%Y%m%d_%H%M%S')
        tmp_dir = Path("assets/tmp") / f"{time_prefix}_{sid}"
        tmp_dir.mkdir(parents=True, exist_ok=True)

        predictor = SamPredictor(self._model)
        predictor.set_image(cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB))

        # 命名：优先用 image_name，否则用路径stem，最后 fallback 为 session_xxx
        if image_name:
            name = image_name
        elif image_path:
            name = Path(image_path).name
        else:
            name = f"session_{sid}.png"

        sess = Session(id=sid, image_bgr=image_bgr, h=h, w=w, tmp_dir=tmp_dir, predictor=predictor, image_name=name)
        self.sessions[sid] = sess
        return sess

    def segment(self, session_id: str, points, labels, box, multimask: bool, top_n: int, smooth: bool):
        sess = self.sessions.get(session_id)
        if not sess:
            raise ValueError(f"Session not found: {session_id}")

        pc = np.array(points, dtype=np.float32) if points else None
        pl = np.array(labels, dtype=np.int32) if labels else None
        bx = np.array(box, dtype=np.float32) if box is not None else None

        masks, scores, _ = sess.predictor.predict(
            point_coords=pc,
            point_labels=pl,
            box=bx,
            multimask_output=multimask
        )

        # 统一为 (K,H,W)
        if masks.ndim == 2:
            masks = masks[None, ...]
            scores = np.array([float(scores)])

        order = np.argsort(scores)[::-1][:max(1, int(top_n))]
        out = []
        for i in order:
            mask = (masks[i] > 0).astype(np.uint8)
            if smooth:
                mask = self._smooth_mask(mask)
            path = self._save_mask_png(sess, mask)
            out.append((path, float(scores[i])))
        return out, (sess.w, sess.h)

    def _save_mask_png(self, sess: Session, mask: np.ndarray) -> str:
        path = sess.tmp_dir / f"{uuid.uuid4().hex}.png"
        cv2.imwrite(str(path), (mask * 255).astype(np.uint8))
        return str(path)

    def _smooth_mask(self, mask: np.ndarray) -> np.ndarray:
        kernel = np.ones((3,3), np.uint8)
        m = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel, iterations=1)
        m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, kernel, iterations=1)
        return (m > 0).astype(np.uint8)
