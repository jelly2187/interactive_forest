"""
请求/响应的数据模型（Pydantic）
"""
from typing import List, Optional, Tuple
from pydantic import BaseModel, Field

# ---- 会话初始化 ----
class InitRequest(BaseModel):
    image_path: Optional[str] = None       # 后端可读路径（二选一）
    image_b64: Optional[str] = None        # dataURL 或纯base64（二选一）
    image_name: Optional[str] = None       # 可用于命名，如 drawing_0030.png
    keep_session: bool = False             # 默认为 False: 启动新图片时清空旧会话，避免坐标/图片错配
    max_side: Optional[int] = Field(default=None, description="可选：限制图像最大边，后端统一缩放以加速")

class InitResponse(BaseModel):
    session_id: str
    width: int
    height: int
    image_name: str

# ---- 更新已存在会话的图像（摄像头连续拍照复用 predictor） ----
class UpdateImageRequest(BaseModel):
    session_id: str
    image_path: Optional[str] = None
    image_b64: Optional[str] = None
    image_name: Optional[str] = None
    max_side: Optional[int] = Field(default=None, description="可选：更新时限制最大边")

class UpdateImageResponse(BaseModel):
    session_id: str
    width: int
    height: int
    image_name: str

# ---- 每个 ROI 的分割（候选） ----
class SegmentRequest(BaseModel):
    session_id: str
    points: List[Tuple[float, float]] = Field(default_factory=list)   # 原图坐标
    labels: List[int] = Field(default_factory=list)                   # 1=FG,0=BG
    box: Tuple[float, float, float, float]                            # x1,y1,x2,y2
    multimask: bool = True
    top_n: int = 3
    smooth: bool = True

class MaskInfo(BaseModel):
    mask_id: str
    score: float
    path: str

class SegmentResponse(BaseModel):
    masks: List[MaskInfo]
    width: int
    height: int

# ---- 导出单个 ROI 的最终 PNG ----
class ExportROIRequest(BaseModel):
    session_id: str
    mask_id: Optional[str] = None      # 用 /sam/segment 的候选ID
    roi_index: int = 1                 # 用于命名 seg_<stem>_roi_<i>.png
    feather_px: int = 0                # >0 时做柔化边缘
    mask_png_b64: Optional[str] = None # 可直接上传最终掩码（例如前端笔刷微调后）
                                       # 二选一：mask_id 或 mask_png_b64
    roi_box: Optional[Tuple[float, float, float, float]] = None  # ROI坐标 (x, y, width, height)

class ExportROIResponse(BaseModel):
    sprite_path: str
    bbox: dict

# ---- 画笔删补接口 ----
class BrushStroke(BaseModel):
    x: float
    y: float
    brush_size: float
    brush_mode: str  # 'add' 或 'erase'

class BrushRefinementRequest(BaseModel):
    session_id: str
    mask_id: str  # 基础mask的ID
    strokes: List[BrushStroke]  # 画笔操作序列
    roi_box: Optional[Tuple[float, float, float, float]] = None  # ROI坐标 (x, y, width, height)

class BrushRefinementResponse(BaseModel):
    refined_mask_id: str
    refined_mask_path: str
    width: int
    height: int
