import os
import cv2
import numpy as np
import torch
from PIL import Image
import matplotlib
matplotlib.use("Agg")  # 无窗口后端
from matplotlib import pyplot as plt
from matplotlib.patches import Rectangle
from pathlib import Path
from segment_anything import sam_model_registry, SamPredictor
from rembg import remove

# ==== Globals & Utilities ====
input_points, input_labels = [], []
undo_stack, redo_stack = [], []

draw_start = None  # 框选起点（缩放后）
draw_end = None  # 框选终点（缩放后）
is_drawing_box = False
multi_boxes = []  # 多个框（原图坐标的 [x1,y1,x2,y2]）
current_box_index = -1

# 轮廓笔刷微调
REFINE_MODE = False
BRUSH_RADIUS = 12
PAINTING = False
PAINT_MODE = +1  # +1=补（前景），-1=擦（背景）

# --- initialize the SAM model ---
# https://github.com/facebookresearch/segment-anything/blob/main/notebooks/predictor_example.ipynb
# SAM_CHECKPOINT = "cv_service/app/models/sam_vit_h_4b8939.pth"
# MODEL_TYPE = "vit_h"
# device = "cuda" if torch.cuda.is_available() else "cpu"
#
# sam = sam_model_registry[MODEL_TYPE](checkpoint=SAM_CHECKPOINT)
# sam.to(device=device)
# sam_predictor = SamPredictor(sam)

# U2_Net_Enable = False


def _figure_to_bgr(fig) -> np.ndarray:
    try:
        from matplotlib.backends.backend_agg import FigureCanvasAgg
        if not isinstance(fig.canvas, FigureCanvasAgg):
            FigureCanvasAgg(fig)  # 绑定 Agg 画布
    except Exception:
        pass
    fig.canvas.draw()
    w, h = fig.canvas.get_width_height()
    rgba = np.asarray(fig.canvas.buffer_rgba(), dtype=np.uint8).reshape(h, w, 4)
    # rgb = buf.reshape(h, w, 3)
    bgr = cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGR)
    plt.close(fig)
    return bgr


def show_mask(mask, ax, random_color=False):
    """
    Visualization Mask
    :param mask:
    :param ax:
    :param random_color:
    :return:
    """
    if random_color:
        color = np.concatenate([np.random.random(3), np.array([0.6])], axis=0)
    else:
        color = np.array([30 / 255, 144 / 255, 255 / 255, 0.6])
    h, w = mask.shape[-2:]
    mask_image = mask.reshape(h, w, 1) * color.reshape(1, 1, -1)
    ax.imshow(mask_image)


def show_points(coords, labels, ax, marker_size=120):
    pos_points = coords[labels == 1]
    neg_points = coords[labels == 0]
    ax.scatter(pos_points[:, 0], pos_points[:, 1], color='green', marker='*', s=marker_size, edgecolor='white',
               linewidth=1.25)
    ax.scatter(neg_points[:, 0], neg_points[:, 1], color='red', marker='*', s=marker_size, edgecolor='white',
               linewidth=1.25)


def resize_to_fit(image, max_width=1280, max_height=720):
    """
    Resizes an image to fit within a maximum width and height, maintaining aspect ratio.
    """
    h, w = image.shape[:2]
    scale = min(max_width / w, max_height / h)
    if scale >= 1.0:
        return image.copy(), 1.0
    new_size = (int(w * scale), int(h * scale))
    resized_image = cv2.resize(image, new_size, interpolation=cv2.INTER_AREA)
    return resized_image, scale


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



# ===== Mouse Callbacks for Box Drawing =====
def _draw_boxes_overlay(scaled_img, scale_factor, boxes_xyxy):
    """在缩放图上画出所有已选框（boxes 是原图坐标，需要换算）"""
    vis = scaled_img.copy()
    for i, (x1, y1, x2, y2) in enumerate(boxes_xyxy):
        sx1, sy1 = int(x1 * scale_factor), int(y1 * scale_factor)
        sx2, sy2 = int(x2 * scale_factor), int(y2 * scale_factor)
        color = (0, 255, 255)
        cv2.rectangle(vis, (sx1, sy1), (sx2, sy2), color, 2)
        cv2.putText(vis, f"#{i + 1}", (sx1, sy1 - 6), cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)
    return vis


def _on_mouse_box(event, x, y, flags, param):
    """多框选的鼠标回调：拖动画框。仅用于显示（坐标为缩放后）"""
    global is_drawing_box, draw_start, draw_end
    if event == cv2.EVENT_LBUTTONDOWN:
        is_drawing_box = True
        draw_start = (x, y)
        draw_end = (x, y)
    elif event == cv2.EVENT_MOUSEMOVE and is_drawing_box:
        draw_end = (x, y)
        # 实时预览在外层循环里做（避免闪烁）
    elif event == cv2.EVENT_LBUTTONUP and is_drawing_box:
        is_drawing_box = False
        draw_end = (x, y)
        sx1, sy1 = draw_start
        sx2, sy2 = draw_end
        if abs(sx2 - sx1) > 5 and abs(sy2 - sy1) > 5:
            # 转回原图坐标
            scale = param['scale_factor']
            x1, y1 = int(min(sx1, sx2) / scale), int(min(sy1, sy2) / scale)
            x2, y2 = int(max(sx1, sx2) / scale), int(max(sy1, sy2) / scale)
            multi_boxes.append([x1, y1, x2, y2])


def multi_box_select(image_bgr):
    """多框选交互：Enter/回车完成；Backspace 删除最后一个；C 清空；Esc 取消"""
    global multi_boxes, is_drawing_box, draw_start, draw_end
    multi_boxes = []
    draw_start = draw_end = None
    is_drawing_box = False

    scaled, scale = resize_to_fit(image_bgr)
    win = "Step1: Multi-Box Select (Enter=Done, Backspace=Del Last, C=Clear, Esc=Cancel)"
    cv2.namedWindow(win, cv2.WINDOW_AUTOSIZE)
    cv2.setMouseCallback(win, _on_mouse_box, param={'scale_factor': scale})

    while True:
        vis = _draw_boxes_overlay(scaled, scale, multi_boxes)
        # 临时绘制当前正在拖拽的框
        if is_drawing_box and draw_start and draw_end:
            vis2 = vis.copy()
            cv2.rectangle(vis2, draw_start, draw_end, (0, 200, 0), 2)
            cv2.imshow(win, vis2)
        else:
            cv2.imshow(win, vis)

        k = cv2.waitKey(20) & 0xFF
        if k in (13, 10):  # Enter
            break
        elif k == 27:  # Esc
            multi_boxes = []
            break
        elif k == 8:  # Backspace 删除最后一个
            if multi_boxes:
                multi_boxes.pop()
        elif k in (ord('c'), ord('C')):
            multi_boxes = []

    cv2.destroyWindow(win)
    return multi_boxes[:]  # 返回拷贝


def _on_mouse_points(event, x, y, flags, param):
    """点选前景/背景：左键=前景，右键=背景（坐标为缩放后，需要映射到原图）"""
    global input_points, input_labels, undo_stack, redo_stack
    scale = param['scale_factor']

    if event == cv2.EVENT_LBUTTONDOWN:
        ox, oy = int(x / scale), int(y / scale)
        input_points.append([ox, oy])
        input_labels.append(1)
        undo_stack.append(('add', 1, (ox, oy)))
        redo_stack.clear()
    elif event == cv2.EVENT_RBUTTONDOWN:
        ox, oy = int(x / scale), int(y / scale)
        input_points.append([ox, oy])
        input_labels.append(0)
        undo_stack.append(('add', 0, (ox, oy)))
        redo_stack.clear()


def point_select_for_box(image_bgr, box_xyxy):
    """
    在给定 box 内部进行点选细化（可点 box 外，但建议框内）
    键位：z 撤销、Z 重做、s 生成候选、Esc 返回
    """
    global input_points, input_labels, undo_stack, redo_stack
    input_points, input_labels = [], []
    undo_stack, redo_stack = [], []

    scaled, scale = resize_to_fit(image_bgr)
    vis = scaled.copy()

    # 在显示层画出 box
    x1, y1, x2, y2 = box_xyxy
    sx1, sy1 = int(x1 * scale), int(y1 * scale)
    sx2, sy2 = int(x2 * scale), int(y2 * scale)
    cv2.rectangle(vis, (sx1, sy1), (sx2, sy2), (255, 200, 0), 2)

    win = "Step2: Point Hints (L=FG, R=BG, z=Undo, Z=Redo, s=Segment)"
    cv2.namedWindow(win, cv2.WINDOW_AUTOSIZE)
    cv2.setMouseCallback(win, _on_mouse_points, param={'scale_factor': scale})

    while True:
        canvas = vis.copy()
        # 画点
        for (ox, oy), lab in zip(input_points, input_labels):
            sx, sy = int(ox * scale), int(oy * scale)
            color = (0, 255, 0) if lab == 1 else (0, 0, 255)
            cv2.circle(canvas, (sx, sy), 5, color, -1)

        cv2.imshow(win, canvas)
        k = cv2.waitKey(20) & 0xFF
        if k in (ord('s'), ord('S')):  # 开始分割
            cv2.destroyWindow(win)
            return np.array(input_points, np.float32), np.array(input_labels, np.int32)
        elif k == 27:  # Esc 退出
            cv2.destroyWindow(win)
            return None, None
        elif k == ord('z'):  # 撤销
            if undo_stack:
                act, lab, (ox, oy) = undo_stack.pop()
                if act == 'add' and input_points:
                    # 从尾部删除一次
                    input_points.pop()
                    input_labels.pop()
                    redo_stack.append(('add', lab, (ox, oy)))
        elif k == ord('Z'):  # 重做（Shift+Z）
            if redo_stack:
                act, lab, (ox, oy) = redo_stack.pop()
                if act == 'add':
                    input_points.append([ox, oy])
                    input_labels.append(lab)
                    undo_stack.append(('add', lab, (ox, oy)))


def sam_segment_with_candidates(image_rgb, box_xyxy, points_np, labels_np, top_n=3, tile_max_h=360):
    """
    对单个框执行 SAM 分割，返回用户选定的一张掩码（二值 np.uint8）。
    支持 Top-N 候选预览（按 1/2/3 选择）。
    """
    # SAM 只需 set_image 一次：请确保在外层对整张 image_rgb 先 set 过
    bx = np.array(box_xyxy, np.float32) if box_xyxy is not None else None
    pc = points_np if points_np is not None and len(points_np) > 0 else None
    pl = labels_np if labels_np is not None and len(labels_np) > 0 else None

    masks, scores, _ = sam_predictor.predict(
        point_coords=pc,
        point_labels=pl,
        box=bx,
        multimask_output=True
    )
    order = np.argsort(scores)[::-1][:max(1, top_n)]
    # cand = [(masks[i].astype(np.uint8), float(scores[i])) for i in order]
    sel_masks = [masks[i].astype(np.uint8) for i in order]
    sel_scores = [float(scores[i]) for i in order]

    tiles = []
    for idx, (m, sc) in enumerate(zip(sel_masks, sel_scores), start=1):
        # 单个候选用一个小figure渲染
        fig, ax = plt.subplots(figsize=(6, 6), dpi=150)
        ax.imshow(image_rgb)
        # 叠加候选 mask 与点
        show_mask(m, ax)
        if pc is not None and pl is not None and len(pc) == len(pl) and len(pc) > 0:
            show_points(pc, pl, ax)
        if box_xyxy is not None:
            x1, y1, x2, y2 = box_xyxy
            ax.add_patch(Rectangle((x1, y1), x2 - x1, y2 - y1, fill=False, edgecolor='yellow', linewidth=2))
        ax.set_title(f"{idx}: score={sc:.2f}", fontsize=10)
        ax.axis("off")
        fig.tight_layout(pad=0)

        tile_bgr = _figure_to_bgr(fig)

        # 统一高度，避免拼接变形
        h, w = tile_bgr.shape[:2]
        scale = tile_max_h / float(h)
        tile_bgr = cv2.resize(tile_bgr, (int(w * scale), tile_max_h), interpolation=cv2.INTER_AREA)

        # 左上角标大号编号（1/2/3）
        cv2.putText(tile_bgr, str(idx), (14, 36), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (30, 30, 30), 4, cv2.LINE_AA)
        cv2.putText(tile_bgr, str(idx), (14, 36), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (255, 255, 255), 2, cv2.LINE_AA)

        tiles.append(tile_bgr)

    # --- 3) 拼接横向预览（太宽时自动每行3个） ---
    if not tiles:
        return None

    def make_canvas(tiles, margin=10, bg=(20, 20, 20), per_row=3):
        th = tiles[0].shape[0]
        tws = [t.shape[1] for t in tiles]
        max_tw = max(tws)
        rows = (len(tiles) + per_row - 1) // per_row
        cols = min(per_row, len(tiles))
        canvas_w = margin + (max_tw + margin) * cols
        canvas_h = margin + (th + margin) * rows
        canvas = np.full((canvas_h, canvas_w, 3), bg, dtype=np.uint8)
        idx = 0
        for r in range(rows):
            for c in range(cols):
                if idx >= len(tiles): break
                t = tiles[idx]
                x0 = margin + c * (max_tw + margin) + (max_tw - t.shape[1]) // 2
                y0 = margin + r * (th + margin)
                canvas[y0:y0 + t.shape[0], x0:x0 + t.shape[1]] = t
                idx += 1
        return canvas

    total_w = sum(t.shape[1] for t in tiles) + 10 * (len(tiles) + 1)
    screen_w = 1800
    per_row = len(tiles) if total_w <= screen_w else 3
    canvas = make_canvas(tiles, per_row=per_row)

    win = f"Step3: Pick Candidate (press 1..{len(tiles)} / Enter=1 / Esc)"
    cv2.imshow(win, canvas)

    # candidates choice
    choice = None
    while True:
        k = cv2.waitKey(0) & 0xFF
        if k in (ord('1'), ord('2'), ord('3')):
            choice = int(chr(k)) - 1
            break
        elif k in (13, 10):  # 回车默认选第一个
            choice = 0
            break
        elif k == 27:  # Esc 取消
            choice = None
            break
    cv2.destroyWindow(win)
    if choice is None:
        return None

    best_mask = (sel_masks[choice] > 0).astype(np.uint8)
    # best_mask = smooth_mask(best_mask, open_ks=0, close_ks=3)  # 掩码平滑与去噪
    return (best_mask > 0).astype(np.uint8)


def refine_with_brush(
        image_bgr: np.ndarray,
        mask_in: np.ndarray,
        brush_radius: int = 12,
        overlay_color=(0, 255, 255),  # BGR 黄色
        overlay_alpha: float = 0.5
):
    """
    轮廓微调（无撤销版）：
      - 左键拖动：补（mask=1）
      - 右键拖动：删（mask=0）
      - [ / ]   ：调整画笔半径
      - S       ：保存（返回 0/1 掩码；并原地写回 mask_in 的 dtype/范围）
      - Esc     ：取消（返回 None）
    要求：mask_in 与 image_bgr 尺寸一致。
    """
    assert image_bgr is not None and mask_in is not None
    H, W = image_bgr.shape[:2]
    assert mask_in.shape[:2] == (H, W), "mask 与原图大小必须一致"

    # 工作掩码（0/1），编辑都在这里进行；保存时再写回 mask_in
    mask_work = (mask_in > 0).astype(np.uint8)

    # 显示底图（缩放），只做一次
    disp_bgr, scale = resize_to_fit(image_bgr)
    sh, sw = disp_bgr.shape[:2]

    # ======== 局部工具（自包含） ========
    def to_img_coords(x, y):
        """显示坐标 -> 原图坐标，并裁剪到边界内"""
        cx, cy = int(x / scale), int(y / scale)
        return max(0, min(W - 1, cx)), max(0, min(H - 1, cy))

    def paint_disk(mask: np.ndarray, cx: int, cy: int, r: int, value: int):
        """以 (cx,cy) 为圆心、半径 r 的圆盘区域赋值 value(0/1)，只更新 ROI。"""
        x0, x1 = max(0, cx - r), min(W, cx + r + 1)
        y0, y1 = max(0, cy - r), min(H, cy + r + 1)
        if x1 <= x0 or y1 <= y0:
            return
        yy, xx = np.ogrid[y0:y1, x0:x1]
        disk = (xx - cx) * (xx - cx) + (yy - cy) * (yy - cy) <= r * r
        if value == 1:
            mask[y0:y1, x0:x1][disk] = 1
        else:
            mask[y0:y1, x0:x1][disk] = 0

    def apply_segment(mask: np.ndarray, p_prev, p_curr, value: int, r: int):
        """
        上一点 -> 当前点 这一段路径，用固定步长沿线盖圆盘，保证不漏点。
        value: 1=补, 0=删
        """
        if p_prev is None or p_prev == p_curr:
            paint_disk(mask, p_curr[0], p_curr[1], r, value)
            return
        x0, y0 = p_prev;
        x1, y1 = p_curr
        dx, dy = x1 - x0, y1 - y0
        dist = float(np.hypot(dx, dy))
        if dist < 1:
            paint_disk(mask, x1, y1, r, value)
            return
        step = max(1.0, r * 0.5)  # 半径一半为步长，保证覆盖重叠
        n_steps = int(np.ceil(dist / step))
        for t in np.linspace(0.0, 1.0, n_steps + 1):
            x = int(round(x0 + t * dx))
            y = int(round(y0 + t * dy))
            paint_disk(mask, x, y, r, value)

    # ======== 交互状态 ========
    win = "Step4: Refine Brush (Mouse_L=add, R=erase, [ / ] radius, S=save, Esc=cancel)"
    cv2.namedWindow(win, cv2.WINDOW_AUTOSIZE)
    state = {
        "cursor": None,  # 显示坐标 (x, y)
        "painting": False,  # 是否按住鼠标
        "value": 1,  # 1=补 / 0=删
        "last_pt": None,  # 上一原图像素坐标（连续落笔）
        "radius": int(brush_radius),
        "dirty": True,  # 需要重绘
    }

    # ======== 鼠标回调（实时写回 mask_work） ========
    def on_mouse(event, x, y, flags, param):
        s = scale
        state["cursor"] = (x, y)

        cx, cy = to_img_coords(x, y)
        pt = (cx, cy)

        if event == cv2.EVENT_LBUTTONDOWN:
            state["painting"] = True
            state["value"] = 1  # 补
            state["last_pt"] = None
            apply_segment(mask_work, state["last_pt"], pt, state["value"], state["radius"])
            state["last_pt"] = pt
            state["dirty"] = True

        elif event == cv2.EVENT_RBUTTONDOWN:
            state["painting"] = True
            state["value"] = 0  # 删
            state["last_pt"] = None
            apply_segment(mask_work, state["last_pt"], pt, state["value"], state["radius"])
            state["last_pt"] = pt
            state["dirty"] = True

        elif event == cv2.EVENT_MOUSEMOVE:
            if state["painting"]:
                apply_segment(mask_work, state["last_pt"], pt, state["value"], state["radius"])
                state["last_pt"] = pt
                state["dirty"] = True
            else:
                state["dirty"] = True

        elif event in (cv2.EVENT_LBUTTONUP, cv2.EVENT_RBUTTONUP):
            state["painting"] = False
            state["last_pt"] = None
            state["dirty"] = True

    cv2.setMouseCallback(win, on_mouse)

    # ======== 渲染循环 ========
    while True:
        if state["dirty"]:
            state["dirty"] = False

            # 将当前 mask_work 缩放到显示尺寸并叠加半透明
            mask_vis = cv2.resize((mask_work * 255).astype(np.uint8), (sw, sh), interpolation=cv2.INTER_NEAREST)
            overlay = disp_bgr.copy()
            sel = mask_vis > 0
            if np.any(sel):
                overlay[sel] = (
                        overlay[sel] * (1 - overlay_alpha)
                        + np.array(overlay_color, dtype=np.float32) * overlay_alpha
                ).astype(np.uint8)

            # 画刷光标圈
            if state["cursor"] is not None:
                disp_r = max(1, int(state["radius"] * scale))
                cur_color = (0, 255, 0) if state["value"] == 1 else (0, 0, 255)
                cv2.circle(overlay, state["cursor"], disp_r, (255, 255, 255), 2, cv2.LINE_AA)
                cv2.circle(overlay, state["cursor"], disp_r, cur_color, 1, cv2.LINE_AA)

            tip = f"Brush {state['radius']}px   [ / ] resize    L=add  R=erase    S=save   Esc=cancel"
            cv2.putText(overlay, tip, (12, 26), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (30, 30, 30), 3, cv2.LINE_AA)
            cv2.putText(overlay, tip, (12, 26), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 1, cv2.LINE_AA)

            cv2.imshow(win, overlay)

        k = cv2.waitKey(15) & 0xFF
        if k in (ord('s'), ord('S')):  # 保存：返回 0/1 掩码，并原地写回 mask_in
            cv2.destroyWindow(win)
            final01 = (mask_work > 0).astype(np.uint8)

            # 原地写回到 mask_in，保持 dtype/范围
            if mask_in.dtype == np.bool_:
                mask_in[:] = final01.astype(np.bool_)
            elif mask_in.dtype == np.uint8 and mask_in.max() > 1:
                mask_in[:] = (final01 * 255).astype(np.uint8)
            else:
                mask_in[:] = final01.astype(mask_in.dtype)

            return final01

        elif k == 27:  # 取消
            cv2.destroyWindow(win)
            return None

        elif k == ord('['):
            state["radius"] = max(1, state["radius"] - 1)
            state["dirty"] = True
        elif k == ord(']'):
            state["radius"] = min(128, state["radius"] + 1)
            state["dirty"] = True




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


def process_image(image_path, output_dir):
    """
    新流程：
      1) 多框选（一次选多个元素区域）
      2) 每个框内点选细化（支持撤销/重做）
      3) SAM 多候选，选择最佳 + 掩码平滑
      4) 轮廓笔刷微调
      5) 独立输出：每个框保存一个 RGBA 结果
    """
    image_bgr = cv2.imread(image_path, cv2.IMREAD_COLOR)
    if image_bgr is None:
        print(f"[Error] read image failed: {image_path}")
        return

    image_rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)

    # —— 性能优化点 A：对整图只 set_image 一次，后续 box+points 直接 predict
    sam_predictor.set_image(image_rgb)

    # 1) 多框选
    boxes = multi_box_select(image_bgr)
    if not boxes:
        print("[Info] no boxes selected, aborted.")
        return

    # 输出目录：每个框一个文件
    os.makedirs(output_dir, exist_ok=True)

    for i, box in enumerate(boxes, start=1):
        print(f"[ROI {i}/{len(boxes)}] box = {box}")

        # 2) 框内点选
        pts, labs = point_select_for_box(image_bgr, box)
        print(pts)
        if pts is None:
            print("  - skipped by user.")
            continue

        # 3) SAM 候选 + 平滑
        best_mask = sam_segment_with_candidates(
            image_rgb=image_rgb,
            box_xyxy=box,
            points_np=pts,
            labels_np=labs,
            top_n=args.top_n,
            tile_max_h=args.tile_h
        )
        if best_mask is None:
            print("  - no mask chosen.")
            continue

        # 4) 轮廓笔刷微调
        refined = refine_with_brush(image_bgr, best_mask)
        if refined is None:
            # 用户取消微调就用 best_mask
            refined = best_mask

        # 5) 柔化边缘
        alpha = feather_edges(refined, radius_px=6)


        # 5) 导出 RGBA（每个框单独文件）
        out_path = make_output_path(image_path, "output", i)
        # save_rgba(image_bgr, refined, out_path)
        save_rgba_soft(image_bgr, alpha, out_path)
        print(f"  - saved: {out_path}")

# ===== 单张图片：命令行入口 =====
if __name__ == "__main__":
    import argparse, os, cv2, numpy as np, torch
    from segment_anything import sam_model_registry, SamPredictor

    parser = argparse.ArgumentParser(description="Kids Art • Single Image Segmentation (SAM + Brush Refine)")
    parser.add_argument("--image", "-i", help="Path to input image (e.g., /path/to/paper.jpg)")
    parser.add_argument("--out", "-o", default="./outputs", help="Output directory for cutouts (PNG with alpha)")
    parser.add_argument("--weights", "-w", help="Path to SAM checkpoint (e.g., sam_vit_h_4b8939.pth)")
    parser.add_argument("--model-type", default="vit_h", choices=["vit_h","vit_l","vit_b"], help="SAM model type")
    parser.add_argument("--device", default=None, choices=[None, "cuda", "cpu"], help="Force device (default auto)")
    parser.add_argument("--top-n", type=int, default=3, help="How many candidate masks to preview (1..9)")
    parser.add_argument("--tile-h", type=int, default=480, help="Preview tile height for candidate gallery")
    args = parser.parse_args()

    # ---- 初始化 SAM 预测器（全局：sam_predictor）----
    if args.device is None:
        device = "cuda" if torch.cuda.is_available() else "cpu"
    else:
        device = args.device

    print(f"[SAM] loading {args.model_type} from {args.weights} on {device} ...")
    # --- initialize the SAM model ---
    # https://github.com/facebookresearch/segment-anything/blob/main/notebooks/predictor_example.ipynb
    SAM_CHECKPOINT = "E:\\Desktop\\workplace\\xbotpark\\interactive_forest\\apps\\cv_service\\app\\models\\sam_vit_h_4b8939.pth"
    # MODEL_TYPE = "vit_h"
    # device = "cuda" if torch.cuda.is_available() else "cpu"
    #
    # sam = sam_model_registry[MODEL_TYPE](checkpoint=SAM_CHECKPOINT)
    # sam.to(device=device)
    # sam_predictor = SamPredictor(sam)
    sam = sam_model_registry[args.model_type](checkpoint=SAM_CHECKPOINT)
    sam.to(device)
    sam_predictor = SamPredictor(sam)

    # ---- 读取图片 ----
    # image_path = args.image
    image_path = 'E:/Desktop/workplace/xbotpark/interactive_forest/assets/datasets/test/drawing_0006.png'
    process_image(image_path, args.out)

    print("[Done] All selected ROIs processed.")


'''

def on_mouse_click_scaled(event, x, y, flags, param):
    original_image = param['original_image']
    scale_factor = param['scale_factor']

    # Convert mouse coordinates back to the original image's coordinates
    original_x = int(x / scale_factor)
    original_y = int(y / scale_factor)

    if event == cv2.EVENT_LBUTTONDOWN or event == cv2.EVENT_RBUTTONDOWN:
        if event == cv2.EVENT_LBUTTONDOWN:
            input_points.append([original_x, original_y])
            input_labels.append(1)  # Foreground point
        else:
            input_points.append([original_x, original_y])
            input_labels.append(0)  # Background point

        # Display points on the scaled image for visual feedback
        image_with_points = param['scaled_image'].copy()
        for i, (px, py) in enumerate(input_points):
            scaled_x = int(px * scale_factor)
            scaled_y = int(py * scale_factor)
            color = (0, 255, 0) if input_labels[i] == 1 else (0, 0, 255)
            cv2.circle(image_with_points, (scaled_x, scaled_y), 5, color, -1)

        cv2.imshow("Select ROI (Left: FG, Right: BG)", image_with_points)


def get_roi_from_sam(image_path: str):
    """
    使用 SAM 模型进行交互式 ROI 框选。
    左键点击添加前景点，右键点击添加背景点。
    """
    global input_points, input_labels
    input_points.clear()
    input_labels.clear()

    image_bgr = cv2.imread(image_path)
    if image_bgr is None:
        print(f"Error: Unable to read image from {image_path}")
        return None, None

    image_rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)

    # Resize the image for display purposes only
    scaled_image, scale_factor = resize_to_fit(image_bgr)

    # feed the image to SAM
    sam_predictor.set_image(image_rgb)

    cv2.imshow("Select ROI (Left: FG, Right: BG)", scaled_image)
    cv2.setMouseCallback("Select ROI (Left: FG, Right: BG)", on_mouse_click_scaled,
                         param={'original_image': image_bgr, 'scaled_image': scaled_image,
                                'scale_factor': scale_factor})
    key = cv2.waitKey(0)
    cv2.destroyAllWindows()

    if key == ord('s') or key == ord('S'):
        if input_points:
            input_points_np = np.array(input_points)
            input_labels_np = np.array(input_labels)

            # 使用 SAM 生成掩码
            masks, scores, _ = sam_predictor.predict(
                point_coords=input_points_np,
                point_labels=input_labels_np,
                multimask_output=True,
            )

            if len(masks) == 0:
                print("No mask generated by SAM.")
                return None, None

            # find the best mask based on scores
            # id = np.argmax(masks)
            best_mask = masks[np.argmax(scores)]

            # print(best_mask.shape)

            plt.figure(figsize=(15, 15))
            plt.imshow(image_rgb)
            show_mask(best_mask, plt.gca())
            show_points(input_points_np, input_labels_np, plt.gca())
            plt.title("SAM Segmentation Result", fontsize=18)
            plt.axis('off')
            plt.show()

            # 找到掩码的最小包围框作为 ROI
            y_coords, x_coords = np.where(best_mask)
            if y_coords.size > 0 and x_coords.size > 0:
                ymin, ymax = np.min(y_coords), np.max(y_coords)
                xmin, xmax = np.min(x_coords), np.max(x_coords)
                roi_box = (xmin, ymin, xmax, ymax)

                roi_image_rgb = image_rgb[ymin:ymax, xmin:xmax]

                plt.figure(figsize=(10, 10))
                plt.imshow(roi_image_rgb)
                plt.title("ROI Cropped Result", fontsize=18)
                plt.axis('off')
                plt.show()
                return roi_box, best_mask
            else:
                print("No mask found, please try again.")
                return None, None

    return None, None


def extract_elements(image: np.ndarray, mask: np.ndarray):
    """
    Directly extracts elements from the original image using the SAM mask,
    creating a transparent background.
    """
    # 裁剪 ROI 区域
    y_coords, x_coords = np.where(mask)
    if y_coords.size == 0 or x_coords.size == 0:
        return None

    ymin, ymax = np.min(y_coords), np.max(y_coords)
    xmin, xmax = np.min(x_coords), np.max(x_coords)

    roi_image = image[ymin:ymax, xmin:xmax]
    roi_mask = mask[ymin:ymax, xmin:xmax]

    if not U2_Net_Enable:
        # Create a 4-channel RGBA image from the cropped image
        # The alpha channel is initialized to zeros (fully transparent)

        extracted_element = np.zeros(
            (roi_image.shape[0], roi_image.shape[1], 4),
            dtype=np.uint8
        )

        # Copy the RGB channels from the original cropped image
        extracted_element[:, :, :3] = roi_image

        # Set the alpha channel based on the cropped mask
        # The mask is boolean (True/False), so we convert it to uint8 (0/1) and scale to 0-255
        extracted_element[:, :, 3] = roi_mask.astype(np.uint8) * 255
    else:
        # 转换为 PIL Image
        pil_image = Image.fromarray(cv2.cvtColor(roi_image, cv2.COLOR_BGR2RGB))

        # rembg for background removal
        output_image = remove(pil_image, alpha_matting_foreground_threshold=240)
        extracted_element = cv2.cvtColor(np.array(output_image), cv2.COLOR_RGB2BGRA)

    return extracted_element


def process_image_old(image_path: str, output_path: str = "output.png"):
    """
    Processes a single image and saves the result.
    """
    print("Step 1: Selecting ROI using SAM...")
    roi_box, mask = get_roi_from_sam(image_path)

    if roi_box and mask is not None:
        print("ROI selected.")
        image = cv2.imread(image_path)

        print("Step 2: Extracting elements using deep learning matting model...")
        extracted_element = extract_elements(image, mask)

        if extracted_element is not None:
            cv2.imwrite(output_path, extracted_element)
            print(f"Successfully extracted and saved to {output_path}")

            if not U2_Net_Enable:
                # --- 可视化模拟透明背景 ---
                bg_image = np.full(extracted_element.shape, (128, 128, 128, 255), dtype=np.uint8)  # 创建一个灰色的背景
                bgr_channels = extracted_element[:, :, :3]
                alpha_channel = extracted_element[:, :, 3]
                alpha_mask = cv2.cvtColor(alpha_channel, cv2.COLOR_GRAY2BGR)  # 将 Alpha 通道转换为 3 通道掩码，用于融合
                blended_result = np.where(alpha_mask == 255, bgr_channels, bg_image[:, :, :3])  # 将前景（抠图结果）和背景融合

                scaled_result, _ = resize_to_fit(blended_result)
            else:
                scaled_result, _ = resize_to_fit(extracted_element)

            cv2.imshow("Extracted Element", scaled_result)
            cv2.waitKey(0)
            cv2.destroyAllWindows()
    else:
        print("ROI selection failed or was cancelled.")


if __name__ == "__main__":
    input_dir = 'datasets/test'
    output_dir = 'output/'

    if not os.path.exists(output_dir):
        os.makedirs(output_dir)

    file_list = os.listdir(input_dir)
    image_files = sorted([f for f in file_list if f.endswith('.png')])

    # 遍历所有图片文件
    # for filename in image_files:
    #     input_path = os.path.join(input_dir, filename)
    #
    #     # 自动生成输出文件名，例如 'drawing_0001.png' -> 'seg_drawing_0001.png'
    #     output_filename = f'seg_{filename}'
    #     output_path = os.path.join(output_dir, output_filename)
    #
    #     print(f"Processing file: {input_path}")
    #
    #     # 调用处理函数
    #     process_image(input_path, output_path)
    process_image('assets/datasets/test/drawing_0030.png', 'output/seg_drawing_0030.png')

'''