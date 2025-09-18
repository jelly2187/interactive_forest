import cv2
import numpy as np
import torch
from PIL import Image
from segment_anything import sam_model_registry, SamPredictor
from transformers import U2netForPortraitMatting, U2netForPortraitMattingProcessor

# --- 1. 初始化模型 ---
# 可以根据你的设备选择 SAM 模型的 checkpoint
# 请从 https://github.com/facebookresearch/segment-anything/blob/main/notebooks/predictor_example.ipynb 下载相应的 .pth 文件
# 例如：sam_vit_h_4b8939.pth
SAM_CHECKPOINT = "path/to/sam_vit_h_4b8939.pth"
MODEL_TYPE = "vit_h"
device = "cuda" if torch.cuda.is_available() else "cpu"

sam = sam_model_registry[MODEL_TYPE](checkpoint=SAM_CHECKPOINT)
sam.to(device=device)
sam_predictor = SamPredictor(sam)

# 初始化抠图模型
# 可以使用 Hugging Face 的 U-2-Net
matting_processor = U2netForPortraitMattingProcessor.from_pretrained("hysts/U-2-Net")
matting_model = U2netForPortraitMatting.from_pretrained("hysts/U-2-Net")
matting_model.to(device)


def get_roi_from_sam(image_path: str):
    """
    使用 SAM 模型进行交互式 ROI 框选。
    用户需要点击图像来选择区域。按 's' 键保存，'q' 键退出。
    """
    image_bgr = cv2.imread(image_path)
    if image_bgr is None:
        print(f"Error: Unable to read image from {image_path}")
        return None, None

    image_rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)

    # 将图像传递给 SAM predictor
    sam_predictor.set_image(image_rgb)

    # 交互式选择点
    input_points = []

    def on_mouse_click(event, x, y, flags, param):
        if event == cv2.EVENT_LBUTTONDOWN:
            input_points.append([x, y])
            # 在图像上画出点击的点
            cv2.circle(image_display, (x, y), 5, (0, 255, 0), -1)
            cv2.imshow("Select ROI (Press 's' to save)", image_display)

    image_display = image_bgr.copy()
    cv2.imshow("Select ROI (Press 's' to save)", image_display)
    cv2.setMouseCallback("Select ROI (Press 's' to save)", on_mouse_click)

    # 等待用户操作
    key = cv2.waitKey(0)
    cv2.destroyAllWindows()

    if key == ord('s') and input_points:
        input_points_np = np.array(input_points)
        input_labels = np.ones(len(input_points_np))  # 1代表前景点

        # 使用 SAM 生成掩码
        masks, scores, _ = sam_predictor.predict(
            point_coords=input_points_np,
            point_labels=input_labels,
            multimask_output=False,  # 只输出一个掩码
        )

        # 找到得分最高的掩码
        best_mask = masks[np.argmax(scores)][0]

        # 找到掩码的最小包围框作为 ROI
        y_coords, x_coords = np.where(best_mask)
        if y_coords.size > 0 and x_coords.size > 0:
            ymin, ymax = np.min(y_coords), np.max(y_coords)
            xmin, xmax = np.min(x_coords), np.max(x_coords)
            roi_box = (xmin, ymin, xmax, ymax)
            return roi_box, best_mask
        else:
            print("No mask found, please try again.")
            return None, None

    return None, None


def extract_elements(image: np.ndarray, mask: np.ndarray):
    """
    使用深度学习抠图模型，从 ROI 中提取元素。
    """
    # 裁剪 ROI 区域
    ymin, ymax = np.min(np.where(mask)[0]), np.max(np.where(mask)[0])
    xmin, xmax = np.min(np.where(mask)[1]), np.max(np.where(mask)[1])

    roi_image = image[ymin:ymax, xmin:xmax]
    roi_mask = mask[ymin:ymax, xmin:xmax]

    # 转换为 PIL Image
    pil_image = Image.fromarray(cv2.cvtColor(roi_image, cv2.COLOR_BGR2RGB))

    # 转换为灰度图
    # U-2-Net 接受单通道的灰度图作为输入
    pil_image_gray = pil_image.convert("L")

    # 使用抠图模型进行处理
    inputs = matting_processor(images=pil_image, return_tensors="pt").to(device)
    with torch.no_grad():
        outputs = matting_model(**inputs)

    alpha_channel = outputs.alphas
    # 将 alpha 通道从张量转换为 numpy 数组并调整大小
    alpha_channel_np = alpha_channel.squeeze().cpu().numpy()
    alpha_channel_np = (alpha_channel_np * 255).astype(np.uint8)

    # 创建一个 4 通道的图像 (RGB + Alpha)
    extracted_element = cv2.cvtColor(roi_image, cv2.COLOR_BGR2BGRA)
    extracted_element[:, :, 3] = alpha_channel_np

    return extracted_element


def process_image(image_path: str, output_path: str = "output.png"):
    """
    主处理函数。
    """
    print("Step 1: Selecting ROI using SAM...")
    roi_box, mask = get_roi_from_sam(image_path)

    if roi_box and mask is not None:
        print("ROI selected.")
        image = cv2.imread(image_path)

        print("Step 2: Extracting elements using deep learning matting model...")
        extracted_element = extract_elements(image, mask)

        if extracted_element is not None:
            # 保存抠出的元素为 PNG 格式，以支持透明度
            cv2.imwrite(output_path, extracted_element)
            print(f"Successfully extracted and saved to {output_path}")

            # 可视化结果
            cv2.imshow("Extracted Element", extracted_element)
            cv2.waitKey(0)
            cv2.destroyAllWindows()
    else:
        print("ROI selection failed or was cancelled.")


if __name__ == "__main__":
    # 使用示例
    # 请将 'path/to/your/drawing.jpg' 替换为你自己的图像路径
    process_image('path/to/your/drawing.jpg')