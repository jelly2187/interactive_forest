# ===== Mouse Callbacks for Box Drawing =====
import os

import cv2
import numpy as np
from matplotlib import pyplot as plt
from matplotlib.patches import Rectangle

from apps.cv_service.app.services.SAM import show_mask, show_points
from apps.cv_service.app.services.utils import resize_to_fit, _figure_to_bgr
from apps.cv_service.app.services.postprocess import feather_edges, make_output_path, save_rgba_soft


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


def sam_segment_with_candidates(image_rgb, box_xyxy, points_np, labels_np, sam_predictor, top_n=3, tile_max_h=360):
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


def process_image(image_path, output_dir, sam_predictor, top_n, tile_max_h):
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
        if pts is None:
            print("  - skipped by user.")
            continue

        # 3) SAM 候选 + 平滑
        best_mask = sam_segment_with_candidates(
            image_rgb=image_rgb,
            box_xyxy=box,
            points_np=pts,
            labels_np=labs,
            sam_predictor=sam_predictor,
            top_n=top_n,
            tile_max_h=tile_max_h
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
        out_path = make_output_path(image_path, output_dir, i)
        # save_rgba(image_bgr, refined, out_path)
        save_rgba_soft(image_bgr, alpha, out_path)
        print(f"  - saved: {out_path}")
