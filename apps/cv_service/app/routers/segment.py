import os, base64
from pathlib import Path
import numpy as np
import cv2
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from ..schemas import (
    InitRequest, InitResponse,
    SegmentRequest, SegmentResponse, MaskInfo,
    ExportROIRequest, ExportROIResponse,
    BrushRefinementRequest, BrushRefinementResponse
)
from ..services.sam_engine import SamEngine
from ..services.splitter import export_single
from ..services.postprocess import make_output_path

router = APIRouter(prefix="/sam", tags=["sam"])
engine = SamEngine()

# ---- 0) 获取当前活动sessions（调试用）----
@router.get("/sessions")
def list_sessions():
    """列出当前活动的会话，用于调试"""
    return {
        "active_sessions": list(engine.sessions.keys()),
        "session_count": len(engine.sessions)
    }

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
        # 添加session存在性检查和详细错误信息
        if req.session_id not in engine.sessions:
            available_sessions = list(engine.sessions.keys())
            raise HTTPException(
                status_code=404, 
                detail=f"Session not found: {req.session_id}. Available sessions: {available_sessions}. "
                       f"Note: Sessions are lost when server restarts. Please call /sam/init again."
            )
        
        outs, (w, h) = engine.segment(
            req.session_id, req.points, req.labels, req.box, req.multimask, req.top_n, req.smooth
        )
        masks = [MaskInfo(mask_id=Path(p).stem, score=s, path=p) for (p, s) in outs]
        return SegmentResponse(masks=masks, width=w, height=h)
    except HTTPException:
        raise  # 重新抛出HTTP异常
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

    # 如果提供了ROI坐标，使用ROI区域进行裁剪
    roi_box = req.roi_box
    print(f"Debug: roi_box = {roi_box}")
    print(f"Debug: mask01.shape = {mask01.shape}")
    print(f"Debug: sess.image_bgr.shape = {sess.image_bgr.shape}")
    
    if roi_box:
        x, y, w, h = roi_box
        print(f"Debug: ROI coordinates - x={x}, y={y}, w={w}, h={h}")
        # 确保坐标在图像范围内
        x = max(0, int(x))
        y = max(0, int(y))
        w = min(sess.w - x, int(w))
        h = min(sess.h - y, int(h))
        print(f"Debug: Adjusted ROI coordinates - x={x}, y={y}, w={w}, h={h}")
        
        # 裁剪图像和mask到ROI区域
        roi_image = sess.image_bgr[y:y+h, x:x+w]
        roi_mask = mask01[y:y+h, x:x+w]
        print(f"Debug: roi_image.shape = {roi_image.shape}")
        print(f"Debug: roi_mask.shape = {roi_mask.shape}")
        
        info = export_single(roi_image, roi_mask, out_path, feather_px=req.feather_px)
        # 更新返回的坐标信息，加上ROI偏移
        if "bbox" in info:
            info["bbox"]["xmin"] += x
            info["bbox"]["ymin"] += y
            info["bbox"]["xmax"] += x
            info["bbox"]["ymax"] += y
    else:
        info = export_single(sess.image_bgr, mask01, out_path, feather_px=req.feather_px)
    return ExportROIResponse(**info)

# ---- 5) 画笔删补接口 ----
@router.post("/brush-refinement", response_model=BrushRefinementResponse)
def brush_refinement(req: BrushRefinementRequest):
    sess = engine.sessions.get(req.session_id)
    if not sess:
        raise HTTPException(status_code=404, detail="Session not found")

    # 读取基础mask
    base_mask_path = None
    for p in sess.tmp_dir.glob(f"{req.mask_id}*.png"):
        base_mask_path = p
        break
    if base_mask_path is None:
        cand = sess.tmp_dir / f"{req.mask_id}.png"
        if cand.exists():
            base_mask_path = cand
    if base_mask_path is None or not base_mask_path.exists():
        raise HTTPException(status_code=404, detail="Base mask not found")

    # 读取基础mask
    base_mask = cv2.imread(str(base_mask_path), cv2.IMREAD_GRAYSCALE)
    if base_mask is None:
        raise HTTPException(status_code=400, detail="Failed to load base mask")

    # 创建可编辑的mask副本
    refined_mask = base_mask.copy()

    # 应用画笔操作
    for stroke in req.strokes:
        # 如果提供了ROI信息，将ROI相对坐标转换为图像坐标
        if req.roi_box:
            roi_x, roi_y, roi_w, roi_h = req.roi_box
            # stroke.x, stroke.y 是相对于ROI的归一化坐标
            abs_x = roi_x + stroke.x * roi_w
            abs_y = roi_y + stroke.y * roi_h
            abs_brush_size = stroke.brush_size * max(roi_w, roi_h)
        else:
            # 直接使用整个图像的归一化坐标
            abs_x = stroke.x * base_mask.shape[1]
            abs_y = stroke.y * base_mask.shape[0]
            abs_brush_size = stroke.brush_size * max(base_mask.shape[1], base_mask.shape[0])
        
        x = int(abs_x)
        y = int(abs_y)
        radius = max(1, int(abs_brush_size))

        if stroke.brush_mode == 'add':
            # 添加模式：在mask上画白色
            cv2.circle(refined_mask, (x, y), radius, 255, -1)
        elif stroke.brush_mode == 'erase':
            # 擦除模式：在mask上画黑色
            cv2.circle(refined_mask, (x, y), radius, 0, -1)

    # 生成新的mask ID和保存路径
    refined_mask_id = f"{req.mask_id}_refined_{len(req.strokes)}"
    refined_mask_path = sess.tmp_dir / f"{refined_mask_id}.png"

    # 保存refined mask
    success = cv2.imwrite(str(refined_mask_path), refined_mask)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to save refined mask")

    return BrushRefinementResponse(
        refined_mask_id=refined_mask_id,
        refined_mask_path=str(refined_mask_path),
        width=base_mask.shape[1],
        height=base_mask.shape[0]
    )
