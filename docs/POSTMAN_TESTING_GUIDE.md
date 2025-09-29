# Postman API 测试指南 📋

本指南说明如何使用 Postman 测试统一的 /sam*图像分割接口与 /assets 管理接口；已完全替换旧版 /upload-file 与 /sessions/* 端点。

## 🚀 准备工作

### 1. 启动后端服务

```powershell
cd apps/cv_service
$env:SAM_WEIGHTS="./app/models/sam_vit_h_4b8939.pth"
$env:OUTPUT_DIR="../../output"
python -m uvicorn app.main:app --reload --port 7001
```

### 2. 验证服务运行

访问: <http://localhost:7001/docs> (交互式 OpenAPI 文档)

### 3. Postman 基础设置

## 📋 核心接口概览

| 功能 | 方法 | 路径 | 关键字段 | 说明 |
|------|------|------|----------|------|
| 健康检查 | GET | /health | - | 服务状态 |
| 初始化会话 | POST | /sam/init | image_path 或 image_b64 | 创建并缓存编码 |
| 列出会话(调试) | GET | /sam/sessions | - | 非生产用途 |
| 生成候选掩码 | POST | /sam/segment | points, labels, box, top_n | 返回多个掩码 ID |
| 画笔润色 | POST | /sam/brush-refinement | mask_id, strokes, roi_box | 迭代精修生成新 mask_id |
| 获取掩码 PNG | GET | /sam/mask/{session_id}/{mask_id} | - | 黑白蒙版图 |
| 导出 ROI | POST | /sam/export-roi | mask_id/refined_id, roi_box, feather_px, roi_index | 生成透明 PNG 资源 |
| 资产列出 | GET | /assets/list | pattern(可选) | 默认匹配 seg_*.png |
| 资产删除 | DELETE | /assets/delete | name | 安全删除 output 下文件 |

## 🔍 详细接口测试

### 1. 健康检查 /health

示例请求（Raw）：

```http
GET /health HTTP/1.1
Host: localhost:7001
```

期望响应：

```json
{ "status": "healthy", "timestamp": "2024-xx-xxT.." }
```

验证：状态码 200 且 status=healthy。

### 2. 初始化会话 /sam/init

方式 A（服务器已有测试图）：

```json
{ "image_path": "assets/datasets/test/drawing_0006.png", "image_name": "drawing_0006.png" }
```

方式 B（摄像头拍照 base64，示例截断）：

```json
{ "image_b64": "data:image/png;base64,iVBORw0KGgo...", "image_name": "capture.png" }
```

响应示例：

```json
{
  "session_id": "c9c9c3ac-...",
  "width": 1024,
  "height": 768,
  "image_name": "drawing_0006.png"
}
```

错误示例：缺失 image_path 和 image_b64 → 400。

### 3. 列出活动会话 /sam/sessions (调试)

```http
GET /sam/sessions HTTP/1.1
Host: localhost:7001
```

用于观察是否重复创建 session；生产环境可关闭。

### 4. 生成候选掩码 /sam/segment

请求示例（点 + 框 + 多掩码）：

```json
{
  "session_id": "<session_uuid>",
  "points": [[150,180],[200,210]],
  "labels": [1,1],
  "box": [120,150,360,420],
  "multimask": true,
  "top_n": 3,
  "smooth": true
}
```

响应：

```json
{
  "masks": [
    { "mask_id": "m_0", "score": 0.95, "path": "/tmp/.../m_0.png" },
    { "mask_id": "m_1", "score": 0.90, "path": "/tmp/.../m_1.png" },
    { "mask_id": "m_2", "score": 0.82, "path": "/tmp/.../m_2.png" }
  ],
  "width": 1024,
  "height": 768
}
```

校验：掩码按 score 降序；mask_id 可用于后续润色/导出。

### 5. 画笔润色 /sam/brush-refinement

请求示例：

```json
{
  "session_id": "<session_uuid>",
  "mask_id": "m_0",
  "strokes": [
    { "x": 0.45, "y": 0.32, "brush_size": 0.02, "brush_mode": "add" },
    { "x": 0.52, "y": 0.41, "brush_size": 0.02, "brush_mode": "erase" }
  ],
  "roi_box": [120,150,240,270]
}
```

响应：

```json
{
  "refined_mask_id": "m_0_refined_1",
  "refined_mask_path": "/tmp/.../m_0_refined_1.png",
  "width": 1024,
  "height": 768
}
```

可多次迭代；前端可更新当前使用的 mask_id。

### 6. 获取掩码 PNG /sam/mask/{session_id}/{mask_id}

```http
GET /sam/mask/<session_uuid>/m_0 HTTP/1.1
Host: localhost:7001
```

期望：HTTP 200 / image/png / 黑白掩码。

### 7. 导出 ROI /sam/export-roi

最小参数：session_id + mask_id + roi_index。

可选：roi_box（未传则使用整图），feather_px（羽化，默认 0），mask_png_b64（直接提供外部自定义掩码，替代 mask_id）。

请求：

```json
{
  "session_id": "<session_uuid>",
  "mask_id": "m_0_refined_1",
  "roi_index": 1,
  "feather_px": 4,
  "roi_box": [120,150,360,420]
}
```

响应：

```json
{
  "sprite_path": "/files/seg_drawing_0006_roi_01_1695640000_a1b2.png",
  "bbox": { "xmin":120, "ymin":150, "xmax":360, "ymax":420 }
}
```

校验：output/ 下出现对应文件；命名格式 `seg_{stem}_roi_{index}_{timestamp}_{rand}.png`。

### 8. 资产列出 /assets/list

```http
GET /assets/list HTTP/1.1
Host: localhost:7001
```

响应包含 sprite 文件列表；支持 ?pattern=seg_drawing_0006* 过滤。

### 9. 资产删除 /assets/delete

```json
{ "name": "seg_drawing_0006_roi_01_1695640000_a1b2.png" }
```

成功：`{"success":true,"deleted":"...png"}`；文件名限制在 output 根，不支持路径穿越。

## 🧪 完整工作流示例

1. GET /health → 200
2. POST /sam/init （保存 session_id 环境变量）
3. POST /sam/segment （保存第一个 masks[0].mask_id 为 mask_id）
4. POST /sam/brush-refinement （可选，更新 mask_id=refined_mask_id）
5. POST /sam/export-roi （保存 sprite_path）
6. GET  /assets/list （验证导出文件存在）
7. DELETE /assets/delete （验证删除成功）

## 🚧 边界与错误测试

| 场景 | 操作 | 期望 |
|------|------|------|
| 未提供 image_path / image_b64 | POST /sam/init | 400 Bad Request |
| 无效 session_id | POST /sam/segment | 404 Session not found |
| 未初始化直接 segment | POST /sam/segment | 404 |
| 无效 mask_id 取掩码 | GET /sam/mask/{sid}/xxx | 404 |
| export 缺少 mask_id 与 mask_png_b64 | POST /sam/export-roi | 400 |
| 删除不存在文件 | DELETE /assets/delete | 404 |

## ⚙️ Postman 自动化配置

### 环境变量建议

### Tests 脚本示例（放在 /sam/init /sam/segment /sam/brush-refinement /sam/export-roi 请求里）

```javascript
if (pm.response.code === 200) {
  const data = pm.response.json();
  if (data.session_id) pm.environment.set('session_id', data.session_id);
  if (data.masks && data.masks.length > 0) pm.environment.set('mask_id', data.masks[0].mask_id);
  if (data.refined_mask_id) pm.environment.set('mask_id', data.refined_mask_id);
  if (data.sprite_path) pm.environment.set('sprite_path', data.sprite_path);
}
```

### 预请求脚本（示例）

```javascript
// 仅在非 init 请求中提醒缺失 session
if (pm.request.url.toString().includes('/sam/') && !pm.request.url.toString().endsWith('/sam/init')) {
  if (!pm.environment.get('session_id')) {
    console.warn('session_id 缺失，请先调用 /sam/init');
  }
}
```

## � 性能参考 (单机调试)

| 步骤 | 典型耗时 | 说明 |
|------|----------|------|
| /sam/init | 1-3s | 首次加载模型可能更慢 (权重冷启动) |
| /sam/segment | <400ms | 取决于 top_n / 分辨率 |
| /sam/brush-refinement | <200ms | 小掩码增量处理 |
| /sam/mask 获取 | <150ms | 读取临时文件 |
| /sam/export-roi | <300ms | ROI 裁剪 + feather |
| /assets/list | <50ms | 目录扫描 |

调优建议：

## 🐛 常见问题与排查

| 问题 | 可能原因 | 处理建议 |
|------|----------|----------|
| init 过慢 | 首次模型加载 | 观察日志，仅第一次慢属正常 |
| segment 404 | session_id 失效 | 重新 init 获取新 ID |
| 掩码锯齿 | feather_px=0 | 适当设置 feather_px (2~6) |
| ROI 导出空白 | roi_box 不含前景 | 检查 roi_box 或不用 roi_box 试整图 |
| 删除失败 | 文件名不匹配 | 确认名称来自 /assets/list 原样拷贝 |

## 📝 测试检查清单

**完成！若遇到异常请查看后端日志或提 Issue。** 🎯
