from fastapi import APIRouter
from fastapi import HTTPException
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
