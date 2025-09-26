from fastapi import APIRouter
from fastapi import HTTPException
from fastapi import Body
from pathlib import Path
import os

router = APIRouter(prefix="/assets", tags=["assets"])

def _project_base() -> Path:
    # cv_service/app/ -> ../../
    return Path(__file__).resolve().parents[2]

def _output_dir() -> Path:
    base = _project_base()
    out = Path(os.getenv("OUTPUT_DIR", base / "output"))
    out.mkdir(parents=True, exist_ok=True)
    return out

@router.get("/list")
def list_assets(pattern: str = "seg_*.png"):
    out = _output_dir()
    files = sorted(out.glob(pattern))
    return [{"name": f.name, "url": f"/files/{f.name}", "size": f.stat().st_size} for f in files]


@router.delete("/delete")
def delete_asset(name: str = Body(embed=True)):
    """删除 output 目录中的指定文件（只允许在 output 根目录下，禁止路径穿越）。"""
    out = _output_dir()
    if not name or '/' in name or '\\' in name:
        raise HTTPException(status_code=400, detail="非法文件名")
    target = out / name
    if not target.exists():
        raise HTTPException(status_code=404, detail="文件不存在")
    try:
        target.unlink()
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"删除失败: {e}")
    return {"success": True, "deleted": name}
