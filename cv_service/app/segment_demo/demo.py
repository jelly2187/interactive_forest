# ==== Globals & Utilities ====
from cv_service.app.routers.segment import process_image

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

if __name__ == "__main__":
    import argparse, os, cv2, numpy as np, torch
    from segment_anything import sam_model_registry, SamPredictor

    parser = argparse.ArgumentParser(description="Kids Art • Single Image Segmentation (SAM + Brush Refine)")
    parser.add_argument("--image", "-i", help="Path to input image (e.g., /path/to/paper.jpg)")
    parser.add_argument("--out", "-o", default="./outputs", help="Output directory for cutouts (PNG with alpha)")
    parser.add_argument("--weights", "-w", help="Path to SAM checkpoint (e.g., sam_vit_h_4b8939.pth)")
    parser.add_argument("--model-type", default="vit_h", choices=["vit_h", "vit_l", "vit_b"], help="SAM model type")
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
    SAM_CHECKPOINT = "cv_service/app/models/sam_vit_h_4b8939.pth"
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
    image_path = 'assets/datasets/test/drawing_0007.png'
    process_image(image_path, args.out, sam_predictor, args.top_n, args.tile_h)

    print("[Done] All selected ROIs processed.")
