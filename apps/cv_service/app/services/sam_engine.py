import os
import shutil
import base64
import uuid
from dataclasses import dataclass, field
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
    created_at: float = field(default_factory=lambda: __import__('time').time())
    last_used: float = field(default_factory=lambda: __import__('time').time())

class SamEngine:
    def __init__(self, weights_path: Optional[str] = None, model_type: Optional[str] = None, device: Optional[str] = None):
        self.model_type = model_type or os.getenv("SAM_MODEL_TYPE", "vit_h")
        self.device = device or os.getenv("SAM_DEVICE", "cuda")
        self.weights_path = weights_path or os.getenv("SAM_WEIGHTS")
        if not self.weights_path or not os.path.exists(self.weights_path):
            raise RuntimeError("SAM weights not found. Set SAM_WEIGHTS to a valid .pth file.")
        self.sessions: dict[str, Session] = {}
        # 最大活跃会话数（超过后自动回收最旧的），避免 GPU / 内存膨胀
        try:
            self.max_sessions = int(os.getenv("SAM_MAX_SESSIONS", "2"))
        except ValueError:
            self.max_sessions = 2
        import time
        t0 = time.perf_counter()
        self._model = sam_model_registry[self.model_type](checkpoint=self.weights_path).to(self.device)
        t1 = time.perf_counter()
        try:
            import torch
            print(f"[SAM][Init] model_type={self.model_type} device={self.device} cuda_available={torch.cuda.is_available()} load_time={(t1-t0)*1000:.1f}ms")
        except Exception:
            print(f"[SAM][Init] model_type={self.model_type} device={self.device} load_time={(t1-t0)*1000:.1f}ms (torch inspect failed)")

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

    def init_session(self, image_path: Optional[str], image_b64: Optional[str], image_name: Optional[str], max_side: Optional[int] = None) -> Session:
        import time
        t0 = time.perf_counter()
        image_bgr = self._decode_image(image_path, image_b64)
        t1 = time.perf_counter()
        resized = False
        if max_side and max_side > 0:
            h0, w0 = image_bgr.shape[:2]
            if max(h0, w0) > max_side:
                scale = max_side / max(h0, w0)
                image_bgr = cv2.resize(image_bgr, (int(w0*scale), int(h0*scale)), interpolation=cv2.INTER_AREA)
                resized = True
        t2 = time.perf_counter()
        h, w = image_bgr.shape[:2]
        sid = str(uuid.uuid4())
        # 增加时间前缀，便于溯源与调试：YYYYMMDD_HHMMSS_<session-uuid>
        import time
        time_prefix = time.strftime('%Y%m%d_%H%M%S')
        tmp_dir = Path("assets/tmp") / f"{time_prefix}_{sid}"
        tmp_dir.mkdir(parents=True, exist_ok=True)

        predictor = SamPredictor(self._model)
        t3 = time.perf_counter()
        predictor.set_image(cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB))  # 生成图像 embedding（最耗时）
        t4 = time.perf_counter()
        print(f"[SAM][SessionInit] sid={sid[:8]} decode={(t1-t0)*1000:.1f}ms resize={(t2-t1)*1000:.1f}ms new_predictor={(t3-t2)*1000:.1f}ms embed={(t4-t3)*1000:.1f}ms total={(t4-t0)*1000:.1f}ms resized={resized} shape={w}x{h}")

        # 命名：优先用 image_name，否则用路径stem，最后 fallback 为 session_xxx
        if image_name:
            name = image_name
        elif image_path:
            name = Path(image_path).name
        else:
            name = f"session_{sid}.png"

        sess = Session(id=sid, image_bgr=image_bgr, h=h, w=w, tmp_dir=tmp_dir, predictor=predictor, image_name=name)
        self.sessions[sid] = sess
        self._trim_sessions()  # 确保不会无限增长
        self._log_memory_state(tag="SessionInit")
        return sess

    def update_session_image(self, session_id: str, image_path: str) -> Session:
        """更新一个已有会话的底图而不销毁 predictor，提高摄像头连续拍摄速度。
        会清理该会话 tmp_dir 下旧的临时 mask（保留最终导出的不在此目录的结果）。
        """
        session = self.sessions.get(session_id)
        if not session:
            raise ValueError("Session not found")
        if not Path(image_path).exists():
            raise FileNotFoundError(image_path)

        import cv2
        image_bgr = cv2.imread(image_path)
        if image_bgr is None:
            raise ValueError("Failed to read image for update")
        # 可选：若分辨率过大，限制最大边，减少后续推理耗时
        max_side = 1280
        h0, w0 = image_bgr.shape[:2]
        if max(h0, w0) > max_side:
            scale = max_side / max(h0, w0)
            image_bgr = cv2.resize(image_bgr, (int(w0*scale), int(h0*scale)), interpolation=cv2.INTER_AREA)

        session.image_bgr = image_bgr
        session.h, session.w = image_bgr.shape[:2]
        session.image_name = Path(image_path).name
        # 重新设置 predictor 图像（无需重新实例化 predictor）
        session.predictor.set_image(cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB))

        # 清空旧的临时 mask 文件，避免混淆
        for f in session.tmp_dir.glob("*.png"):
            try:
                f.unlink()
            except Exception:
                pass
        # 不重建 predictor，只是更新 image 引用
        session.last_used = __import__('time').time()
        self._log_memory_state(tag="UpdateImagePath")
        return session

    def update_session_image_b64(self, session_id: str, image_b64: str, max_side: Optional[int] = None) -> Session:
        """复用已有 predictor，使用 base64 图像更新。"""
        session = self.sessions.get(session_id)
        if not session:
            raise ValueError("Session not found")
        import time
        t0 = time.perf_counter()
        img = self._decode_image(None, image_b64)
        t1 = time.perf_counter()
        resized = False
        if max_side and max_side > 0:
            h0, w0 = img.shape[:2]
            if max(h0, w0) > max_side:
                scale = max_side / max(h0, w0)
                img = cv2.resize(img, (int(w0*scale), int(h0*scale)), interpolation=cv2.INTER_AREA)
                resized = True
        t2 = time.perf_counter()
        session.image_bgr = img
        session.h, session.w = img.shape[:2]
        # 复用 predictor：重新 set_image
        session.predictor.set_image(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
        t3 = time.perf_counter()
        # 清除旧临时掩码
        for f in session.tmp_dir.glob("*.png"):
            try:
                f.unlink()
            except Exception:
                pass
        print(f"[SAM][UpdateImage] sid={session_id[:8]} decode={(t1-t0)*1000:.1f}ms resize={(t2-t1)*1000:.1f}ms embed={(t3-t2)*1000:.1f}ms total={(t3-t0)*1000:.1f}ms resized={resized} shape={session.w}x{session.h}")
        session.last_used = __import__('time').time()
        self._log_memory_state(tag="UpdateImageB64")
        return session

    def clear_all_sessions(self):
        """清理所有已存在的会话及其临时目录，防止残留掩码导致坐标错配或磁盘膨胀。"""
        for sess in list(self.sessions.values()):
            try:
                if sess.tmp_dir.exists():
                    shutil.rmtree(sess.tmp_dir, ignore_errors=True)
            except Exception:
                pass
        self.sessions.clear()
        self._torch_empty_cache()
        print("[SAM][GC] Cleared all sessions")

    # ---------------- 内部辅助 -----------------
    def _trim_sessions(self):
        if self.max_sessions <= 0:
            return
        if len(self.sessions) <= self.max_sessions:
            return
        # 根据 last_used 排序，淘汰最久未使用的
        ordered = sorted(self.sessions.values(), key=lambda s: s.last_used)
        excess = len(self.sessions) - self.max_sessions
        to_remove = ordered[:excess]
        for sess in to_remove:
            try:
                if sess.tmp_dir.exists():
                    shutil.rmtree(sess.tmp_dir, ignore_errors=True)
            except Exception:
                pass
            # 显式释放 predictor 引用
            try:
                del sess.predictor
            except Exception:
                pass
            self.sessions.pop(sess.id, None)
            print(f"[SAM][Trim] Removed session {sess.id[:8]}")
        if to_remove:
            self._torch_empty_cache()

    def _torch_empty_cache(self):
        try:
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass

    def _log_memory_state(self, tag: str):
        try:
            import psutil, torch, time
            proc = psutil.Process(os.getpid())
            rss = proc.memory_info().rss / 1024 / 1024
            txt = f"[SAM][Mem][{tag}] sessions={len(self.sessions)} rss={rss:.1f}MB"
            if torch.cuda.is_available():
                alloc = torch.cuda.memory_allocated() / 1024 / 1024
                reserved = torch.cuda.memory_reserved() / 1024 / 1024
                txt += f" gpu_alloc={alloc:.1f}MB gpu_reserved={reserved:.1f}MB"
            print(txt)
        except Exception:
            pass

    def segment(self, session_id: str, points, labels, box, multimask: bool, top_n: int, smooth: bool):
        sess = self.sessions.get(session_id)
        if not sess:
            raise ValueError(f"Session not found: {session_id}")

        # 清理旧的候选掩码文件（仅删除纯 32 位 hex 命名的初始候选，保留 *_refined_*）
        try:
            for p in sess.tmp_dir.glob('*.png'):
                stem = p.stem
                if len(stem) == 32 and '_' not in stem:  # uuid4().hex 长度 32
                    p.unlink(missing_ok=True)
        except Exception:
            pass

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
