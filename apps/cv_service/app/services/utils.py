'''
Related functions used for cv2.imshow() display during debugging
Author: Jelly
Date: 2025-09-20
'''

import cv2
import numpy as np
from matplotlib import pyplot as plt


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