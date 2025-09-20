import os
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from dotenv import load_dotenv
load_dotenv(dotenv_path=Path(__file__).resolve().parents[1] / ".env")

from .routers import segment
from .routers import assets as assets_router

# ---- 目录推断：<repo-root>/cv_service/app/main.py -> repo_root ----
APP_DIR = Path(__file__).resolve().parent
CV_DIR = APP_DIR.parent
REPO_ROOT = CV_DIR.parent

# ---- 输出目录（前端会读这里的 PNG）----
OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR", REPO_ROOT / "output")).resolve()
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# 给其它模块用
os.environ.setdefault("PROJECT_BASE", str(REPO_ROOT))
os.environ.setdefault("OUTPUT_DIR", str(OUTPUT_DIR))

app = FastAPI(title="Kids Art CV/ML Service (SAM)", version="1.1.0")

# 开发阶段放开 CORS（前端：Electron/React/Pixi）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # 上线可收紧
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 路由
app.include_router(segment.router)
app.include_router(assets_router.router)

# 静态托管 output/ 到 /files
app.mount("/files", StaticFiles(directory=str(OUTPUT_DIR)), name="files")

@app.get("/health")
def health():
    return {"ok": True, "service": "kids-art-cv-sam", "version": "1.1.0"}


# todo: 后端待完整调试，目前加载图片等功能仍然未完善