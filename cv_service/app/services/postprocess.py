import os
from pathlib import Path

import cv2
import numpy as np


def smooth_mask(mask, open_ks=3, close_ks=3):
    """
    掩码平滑与去噪：开闭运算 + 轻羽化
    """
    m = (mask > 0).astype(np.uint8)
    if open_ks and open_ks >= 3:
        kernel = np.ones((open_ks, open_ks), np.uint8)
        m = cv2.morphologyEx(m, cv2.MORPH_OPEN, kernel, iterations=1)
    if close_ks and close_ks >= 3:
        kernel = np.ones((close_ks, close_ks), np.uint8)
        m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, kernel, iterations=1)
    # 轻微羽化边缘
    m = cv2.GaussianBlur(m.astype(np.float32), (3, 3), 0)
    return (m > 0.5).astype(np.uint8)

def feather_edges(mask: np.ndarray, radius_px: int = 6) -> np.ndarray:
    """
    将二值 mask (0/1 或 0/255) 转为带“柔化边缘”的 Alpha (0..255)。
    - 不改变几何，只让边界出现渐变。
    - radius_px：软边半径，像素单位（越大越柔和）。
    返回：uint8 的 alpha（0..255）
    """
    if radius_px <= 0:
        # 不柔化：直接返回二值 Alpha
        m01 = (mask > 0).astype(np.uint8)
        return (m01 * 255).astype(np.uint8)

    m01 = (mask > 0).astype(np.uint8)

    # 距离变换（像素到最近背景/前景的距离）
    # 内部：到背景的距离
    dist_in = cv2.distanceTransform(m01, cv2.DIST_L2, 3)
    # 外部：到前景的距离（先取反，计算到“1”的距离）
    dist_out = cv2.distanceTransform(1 - m01, cv2.DIST_L2, 3)

    # 签名距离：内部为正，外部为负
    signed = dist_in - dist_out  # >0 inside, <0 outside

    # 在线性带 [-radius, +radius] 内做 0..255 的渐变，其他区域全0或全255
    r = float(radius_px)
    alpha = 255.0 * np.clip(0.5 + signed / (2.0 * r), 0.0, 1.0)

    return alpha.astype(np.uint8)


def rgba_from_bgr_and_mask(image_bgr, mask):
    """BGR + mask -> RGBA（透明通道）"""
    h, w = image_bgr.shape[:2]
    a = (mask > 0).astype(np.uint8) * 255
    rgba = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2BGRA)
    rgba[:, :, 3] = a
    return rgba


def save_rgba(image_bgr, mask, out_path):
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    rgba = rgba_from_bgr_and_mask(image_bgr, mask)
    cv2.imwrite(out_path, rgba)

def save_rgba_soft(image_bgr: np.ndarray, alpha: np.ndarray, out_path: str):
    """
    直接使用 0..255 的 alpha 保存 RGBA。
    """
    h, w = image_bgr.shape[:2]
    if alpha.shape[:2] != (h, w):
        raise ValueError("alpha size must match image size")
    rgba = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2BGRA)
    rgba[:, :, 3] = alpha
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    cv2.imwrite(out_path, rgba)

def make_output_path(image_path: str, output_dir: str, roi_idx: int) -> str:
    """
    输入原图路径和 ROI 序号，返回形如：
    output/seg_<stem>_roi_<idx>.png
    例如：drawing_0030.png -> output/seg_drawing_0030_roi_1.png
    """
    stem = Path(image_path).stem            # e.g. "drawing_0030"
    outdir = Path(output_dir)
    outdir.mkdir(parents=True, exist_ok=True)
    name = f"seg_{stem}_roi_{roi_idx:02d}.png"  # 如需补零可用 {roi_idx:02d}
    return str(outdir / name)