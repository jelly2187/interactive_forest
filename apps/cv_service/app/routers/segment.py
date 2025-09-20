import os, base64
from pathlib import Path
import numpy as np
import cv2
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from ..schemas import (
    InitRequest, InitResponse,
    SegmentRequest, SegmentResponse, MaskInfo,
    ExportROIRequest, ExportROIResponse
)
from ..services.sam_engine import SamEngine
from ..services.splitter import export_single
from ..services.postprocess import make_output_path

router = APIRouter(prefix="/sam", tags=["sam"])
engine = SamEngine()

# ---- 1) 初始化会话 ----
@router.post("/init", response_model=InitResponse)
def init(req: InitRequest):
    try:
        sess = engine.init_session(req.image_path, req.image_b64, req.image_name)
        return InitResponse(session_id=sess.id, width=sess.w, height=sess.h, image_name=sess.image_name)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# ---- 2) 针对单个ROI请求候选掩码 ----
@router.post("/segment", response_model=SegmentResponse)
def segment(req: SegmentRequest):
    try:
        outs, (w, h) = engine.segment(
            req.session_id, req.points, req.labels, req.box, req.multimask, req.top_n, req.smooth
        )
        masks = [MaskInfo(mask_id=Path(p).stem, score=s, path=p) for (p, s) in outs]
        return SegmentResponse(masks=masks, width=w, height=h)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# ---- 3) 取某个候选掩码的PNG，用于前端预览叠加 ----
@router.get("/mask/{session_id}/{mask_id}")
def get_mask_png(session_id: str, mask_id: str):
    sess = engine.sessions.get(session_id)
    if not sess:
        raise HTTPException(status_code=404, detail="Session not found")
    target = None
    for p in sess.tmp_dir.glob(f"{mask_id}*.png"):
        target = p; break
    if target is None:
        cand = sess.tmp_dir / f"{mask_id}.png"
        if cand.exists(): target = cand
    if target is None or not target.exists():
        raise HTTPException(status_code=404, detail="Mask not found")
    return FileResponse(str(target), media_type="image/png")

# ---- 4) 导出单ROI结果为透明PNG（seg_<stem>_roi_<i>.png）----
@router.post("/export-roi", response_model=ExportROIResponse)
def export_roi(req: ExportROIRequest):
    sess = engine.sessions.get(req.session_id)
    if not sess:
        raise HTTPException(status_code=404, detail="Session not found")

    # 最终掩码来源：优先 mask_png_b64（前端笔刷后），否则用候选 mask_id
    mask01 = None
    if req.mask_png_b64:
        b64 = req.mask_png_b64.split(",",1)[1] if "," in req.mask_png_b64 else req.mask_png_b64
        data = base64.b64decode(b64)
        arr = np.frombuffer(data, dtype=np.uint8)
        mk = cv2.imdecode(arr, cv2.IMREAD_UNCHANGED)
        if mk is None:
            raise HTTPException(status_code=400, detail="Invalid mask PNG")
        if mk.ndim == 3 and mk.shape[2] == 4:
            mask01 = (mk[:, :, 3] > 0).astype(np.uint8)
        else:
            if mk.ndim == 3:
                mk = cv2.cvtColor(mk, cv2.COLOR_BGR2GRAY)
            mask01 = (mk > 127).astype(np.uint8)

    elif req.mask_id:
        # 从候选中读取
        mask_png = None
        for p in sess.tmp_dir.glob(f"{req.mask_id}*.png"):
            mask_png = p; break
        if mask_png is None:
            cand = sess.tmp_dir / f"{req.mask_id}.png"
            if cand.exists(): mask_png = cand
        if mask_png is None or not mask_png.exists():
            raise HTTPException(status_code=404, detail="Mask not found")
        mk = cv2.imread(str(mask_png), cv2.IMREAD_GRAYSCALE)
        mask01 = (mk > 127).astype(np.uint8)

    else:
        raise HTTPException(status_code=400, detail="mask_id or mask_png_b64 required")

    # 命名：seg_<stem>_roi_<i>.png
    out_dir = Path(os.getenv("OUTPUT_DIR", "output"))
    out_path = Path(make_output_path(sess.image_name, str(out_dir), req.roi_index))

    info = export_single(sess.image_bgr, mask01, out_path, feather_px=req.feather_px)
    return ExportROIResponse(**info)
