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
    你当前主流程：每个 ROI 得到单元素掩码，直接导出到 seg_<stem>_roi_<i>.png
    """
    m = (mask01 > 0).astype(np.uint8)
    if m.sum() == 0:
        raise ValueError("export_single: empty mask")

    ys, xs = np.where(m > 0)
    ymin, ymax = int(ys.min()), int(ys.max())
    xmin, xmax = int(xs.min()), int(xs.max())

    out_path.parent.mkdir(parents=True, exist_ok=True)

    if feather_px and feather_px > 0:
        alpha = feather_edges(m, radius_px=feather_px)
        crop_rgba = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2BGRA)
        crop_rgba = crop_rgba[ymin:ymax+1, xmin:xmax+1]
        crop_alpha = alpha[ymin:ymax+1, xmin:xmax+1]
        crop_rgba[:, :, 3] = crop_alpha
        cv2.imwrite(str(out_path), crop_rgba)
    else:
        crop_im = image_bgr[ymin:ymax+1, xmin:xmax+1]
        crop_mk = m[ymin:ymax+1, xmin:xmax+1]
        save_rgba(crop_im, crop_mk, str(out_path))

    return {
        "sprite_path": str(out_path),
        "bbox": {"xmin": xmin, "ymin": ymin, "xmax": xmax, "ymax": ymax}
    }
