# 后端安装与运行

## 1) 安装
```bash
cd cv_service
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
pip install git+https://github.com/facebookresearch/segment-anything.git
```
## 2) 配置

复制 .env.example 为 .env，至少设置：
- SAM_WEIGHTS 指向你的权重
- SAM_MODEL_TYPE / SAM_DEVICE
- OUTPUT_DIR 默认为 <repo-root>/output

## 3) 启动
```bash
python -m uvicorn app.main:app --reload --port 7001
```

## 4) 自检
- http://localhost:7001/health
- http://localhost:7001/assets/list
- 访问静态文件： http://localhost:7001/files/<任一 PNG>