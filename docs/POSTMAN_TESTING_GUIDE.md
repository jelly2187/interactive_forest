# Postman API 测试指南 📋

本指南详细说明如何使用Postman测试Interactive Forest项目的后端API。

## 🚀 准备工作

### 1. 启动后端服务

```powershell
cd apps/cv_service
$env:SAM_WEIGHTS="./app/models/sam_vit_h_4b8939.pth"
$env:OUTPUT_DIR="../../output"
python -m uvicorn app.main:app --reload --port 7001
```

### 2. 验证服务运行

访问 <http://localhost:7001/docs> 查看API文档

### 3. 导入Postman集合

创建新的Postman集合，配置以下基础设置：

- **Base URL**: `http://localhost:7001`
- **Content-Type**: `application/json`

## 📋 API端点测试

### 1. 健康检查接口

**GET** `/health`

**用途**: 验证服务状态

**请求示例**:

```
GET http://localhost:7001/health
```

**预期响应**:

```json
{
  "status": "healthy",
  "timestamp": "2024-01-XX XX:XX:XX"
}
```

**测试验证**:

- ✅ 状态码: 200
- ✅ 响应包含 `status: "healthy"`

---

### 2. 文件上传接口

**POST** `/upload-file`

**用途**: 上传图片文件并获取会话ID

**请求配置**:

- 方法: POST
- Body类型: form-data
- 字段: `file` (选择图片文件)

**测试步骤**:

1. 在Body选项卡选择 `form-data`
2. 添加key: `file`, type: `File`
3. 选择测试图片 (建议使用 `assets/datasets/test/drawing_0006.png`)

**预期响应**:

```json
{
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "message": "文件上传成功",
  "filename": "drawing_0006.png"
}
```

**测试验证**:

- ✅ 状态码: 200
- ✅ 返回有效的session_id (UUID格式)
- ✅ 文件保存到临时目录

---

### 3. 获取原始图片

**GET** `/sessions/{session_id}/original`

**用途**: 获取上传的原始图片

**路径参数**:

- `session_id`: 从上传接口获得的会话ID

**请求示例**:

```
GET http://localhost:7001/sessions/550e8400-e29b-41d4-a716-446655440000/original
```

**预期响应**:

- Content-Type: `image/png`
- 图片二进制数据

**测试验证**:

- ✅ 状态码: 200
- ✅ 响应类型为图片
- ✅ 能正常显示图片内容

---

### 4. SAM编码器处理

**POST** `/sessions/{session_id}/encode`

**用途**: 使用SAM编码器处理图片

**路径参数**:

- `session_id`: 会话ID

**请求体**: 空 (无需body)

**请求示例**:

```
POST http://localhost:7001/sessions/550e8400-e29b-41d4-a716-446655440000/encode
```

**预期响应**:

```json
{
  "message": "编码完成",
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "encoding_time": 2.45
}
```

**测试验证**:

- ✅ 状态码: 200
- ✅ 编码时间 < 10秒
- ✅ 返回相同的session_id

---

### 5. 框选分割

**POST** `/sessions/{session_id}/segment-box`

**用途**: 通过矩形框选进行图像分割

**路径参数**:

- `session_id`: 会话ID

**请求体**:

```json
{
  "input_box": [100, 100, 300, 250]
}
```

**字段说明**:

- `input_box`: 矩形框坐标 [x1, y1, x2, y2]
- 坐标系: 左上角为原点 (0,0)

**请求示例**:

```
POST http://localhost:7001/sessions/550e8400-e29b-41d4-a716-446655440000/segment-box
Content-Type: application/json

{
  "input_box": [100, 100, 300, 250]
}
```

**预期响应**:

```json
{
  "masks": [
    {
      "mask_id": 0,
      "score": 0.95,
      "area": 15234
    },
    {
      "mask_id": 1,
      "score": 0.88,
      "area": 12456
    }
  ],
  "segment_time": 0.15
}
```

**测试验证**:

- ✅ 状态码: 200
- ✅ 返回多个候选掩码
- ✅ 掩码按分数排序 (高到低)
- ✅ 分割时间 < 1秒

---

### 6. 点击分割

**POST** `/sessions/{session_id}/segment-point`

**用途**: 通过点击进行图像分割

**请求体**:

```json
{
  "input_point": [200, 150],
  "input_label": 1
}
```

**字段说明**:

- `input_point`: 点击坐标 [x, y]
- `input_label`: 1=前景点, 0=背景点

**测试用例**:

**用例1: 前景点**

```json
{
  "input_point": [200, 150],
  "input_label": 1
}
```

**用例2: 背景点**

```json
{
  "input_point": [50, 50],
  "input_label": 0
}
```

**预期响应**: 同框选分割接口

---

### 7. 多点分割

**POST** `/sessions/{session_id}/segment-points`

**用途**: 通过多个点进行精确分割

**请求体**:

```json
{
  "input_points": [[200, 150], [250, 180], [180, 200]],
  "input_labels": [1, 1, 1]
}
```

**高级测试用例**:

```json
{
  "input_points": [[200, 150], [250, 180], [50, 50], [400, 50]],
  "input_labels": [1, 1, 0, 0]
}
```

**预期响应**: 同框选分割接口

---

### 8. 获取掩码图片

**GET** `/sessions/{session_id}/mask/{mask_id}`

**用途**: 获取指定掩码的可视化图片

**路径参数**:

- `session_id`: 会话ID
- `mask_id`: 掩码ID (从分割接口获得)

**请求示例**:

```
GET http://localhost:7001/sessions/550e8400-e29b-41d4-a716-446655440000/mask/0
```

**预期响应**:

- Content-Type: `image/png`
- 黑白掩码图片 (白色=选中区域, 黑色=背景)

---

### 9. 导出ROI (抠图结果)

**GET** `/sessions/{session_id}/export-roi/{mask_id}`

**用途**: 导出透明背景的PNG抠图结果

**请求示例**:

```
GET http://localhost:7001/sessions/550e8400-e29b-41d4-a716-446655440000/export-roi/0
```

**预期响应**:

- Content-Type: `image/png`
- 透明背景PNG图片
- 只包含选中区域的内容

**测试验证**:

- ✅ 状态码: 200
- ✅ 图片格式为PNG
- ✅ 背景透明
- ✅ 前景清晰完整

---

### 10. Base64导出

**GET** `/sessions/{session_id}/export-roi-b64/{mask_id}`

**用途**: 获取Base64编码的抠图结果

**预期响应**:

```json
{
  "image_b64": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAA...",
  "mask_id": 0,
  "format": "png"
}
```

---

## 🧪 完整测试流程

### 标准工作流测试

1. **健康检查**

   ```
   GET /health
   ```

2. **上传文件**

   ```
   POST /upload-file
   (获取session_id)
   ```

3. **编码处理**

   ```
   POST /sessions/{session_id}/encode
   ```

4. **分割测试**

   ```
   POST /sessions/{session_id}/segment-box
   (获取mask列表)
   ```

5. **结果验证**

   ```
   GET /sessions/{session_id}/mask/0
   GET /sessions/{session_id}/export-roi/0
   ```

### 边界条件测试

**无效会话ID**:

```
GET /sessions/invalid-uuid/original
预期: 404 Not Found
```

**无效掩码ID**:

```
GET /sessions/{valid_session_id}/mask/999
预期: 404 Not Found
```

**空文件上传**:

```
POST /upload-file
(不选择文件)
预期: 422 Unprocessable Entity
```

**未编码直接分割**:

```
POST /sessions/{session_id}/segment-box
(跳过encode步骤)
预期: 400 Bad Request
```

## 📊 性能基准

### 预期响应时间

- 文件上传: < 1秒
- SAM编码: 3-8秒 (首次较慢)
- 图像分割: < 500ms
- 图片获取: < 200ms

### 内存使用

- 空闲状态: ~2GB
- 处理1080p图片: ~4GB
- 多会话并发: 每会话+1GB

## 🔧 Postman配置

### 环境变量设置

```javascript
// 在Tests标签中添加自动化脚本
if (pm.response.code === 200) {
    var jsonData = pm.response.json();
    if (jsonData.session_id) {
        pm.environment.set("session_id", jsonData.session_id);
    }
}
```

### 集合变量

- `base_url`: `http://localhost:7001`
- `session_id`: 动态获取
- `mask_id`: 动态获取

### 预请求脚本

```javascript
// 检查必需的环境变量
if (!pm.environment.get("session_id")) {
    console.log("Warning: session_id not set, please run upload-file first");
}
```

## 🐛 常见问题

### 1. 连接被拒绝

**原因**: 后端服务未启动
**解决**: 检查服务状态，重启服务

### 2. 编码超时

**原因**: SAM模型加载时间长
**解决**: 设置更长的请求超时时间 (30秒)

### 3. 内存不足

**原因**: 图片过大或并发过多
**解决**: 压缩图片或减少并发数

### 4. 掩码质量差

**原因**: 输入点/框不准确
**解决**: 调整输入坐标，尝试多种组合

## 📝 测试检查清单

- [ ] 所有API端点正常响应
- [ ] 文件上传成功
- [ ] SAM编码完成
- [ ] 分割结果质量良好
- [ ] 图片导出正确
- [ ] 错误处理恰当
- [ ] 性能满足要求
- [ ] 内存使用正常

---

**祝测试愉快！如有问题请查看服务器日志或联系技术支持。** 🎯
