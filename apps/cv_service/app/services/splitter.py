import uuid
from pathlib import Path
import cv2
import numpy as np
from .postprocess import rgba_from_bgr_and_mask, save_rgba, save_rgba_soft, feather_edges

def split_and_export(image_bgr: np.ndarray, mask: np.ndarray, out_root: Path,
                     min_area: int = 500, max_elements: int = 20):
    """
    备选：把“总掩码”拆成多个元素（连通域），各自导出 sprite.png。
    """
    out_root.mkdir(parents=True, exist_ok=True)
    m = (mask > 0).astype(np.uint8)
    num, labels = cv2.connectedComponents(m)
    elements = []
    for i in range(1, num):
        part = (labels == i).astype(np.uint8)
        area = int(part.sum())
        if area < min_area:
            continue
        ys, xs = np.where(part > 0)
        ymin, ymax = int(ys.min()), int(ys.max())
        xmin, xmax = int(xs.min()), int(xs.max())

        crop_rgba = rgba_from_bgr_and_mask(
            image_bgr[ymin:ymax+1, xmin:xmax+1],
            part[ymin:ymax+1, xmin:xmax+1]
        )

        eid = str(uuid.uuid4())
        el_dir = out_root / eid
        el_dir.mkdir(parents=True, exist_ok=True)
        sprite_path = el_dir / "sprite.png"
        cv2.imwrite(str(sprite_path), crop_rgba)

        elements.append({
            "uuid": eid,
            "sprite_path": str(sprite_path),
            "bbox": {"xmin": xmin, "ymin": ymin, "xmax": xmax, "ymax": ymax}
        })
        if len(elements) >= max_elements:
            break
    return elements

def export_single(image_bgr: np.ndarray,
                  mask01: np.ndarray,
                  out_path: Path,
                  *,
                  feather_px: int = 0):
    """
    导出ROI区域内的分割结果，使用mask作为透明度通道
    - image_bgr: ROI区域的原图
    - mask01: ROI区域的mask (0/1 或 0/255)
    - 输出: 整个ROI区域的RGBA图像，mask区域保留原图，非mask区域透明
    """
    m = (mask01 > 0).astype(np.uint8)
    if m.sum() == 0:
        raise ValueError("export_single: empty mask")

    # 确保image_bgr和mask01的尺寸匹配
    if image_bgr.shape[:2] != mask01.shape[:2]:
        raise ValueError(f"Image shape {image_bgr.shape[:2]} doesn't match mask shape {mask01.shape[:2]}")

    out_path.parent.mkdir(parents=True, exist_ok=True)

    if feather_px and feather_px > 0:
        # 使用柔化边缘
        alpha = feather_edges(m, radius_px=feather_px)
        rgba = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2BGRA)
        rgba[:, :, 3] = alpha
        cv2.imwrite(str(out_path), rgba)
    else:
        # 直接使用mask作为alpha通道
        save_rgba(image_bgr, m, str(out_path))

    # 计算实际内容的边界框（用于定位）
    ys, xs = np.where(m > 0)
    ymin, ymax = int(ys.min()), int(ys.max())
    xmin, xmax = int(xs.min()), int(xs.max())

    return {
        "sprite_path": str(out_path),
        "bbox": {"xmin": xmin, "ymin": ymin, "xmax": xmax, "ymax": ymax}
    }
