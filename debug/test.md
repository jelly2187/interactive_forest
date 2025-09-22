# Interactive Forest 项目架构分析与测试指南

## 🏗️ 项目整体架构

这是一个基于**Interactive Forest**概念的儿童画作数字化项目，采用**前后端分离**架构：

### 技术栈组成

- **后端**: FastAPI + SAM (Segment Anything Model) + OpenCV
- **前端**: Electron + React + TypeScript + PIXI.js
- **AI核心**: Meta's Segment Anything Model (SAM) 图像分割

### 📁 项目目录结构与职责

```
interactive_forest/
├── apps/
│   ├── cv_service/          # 后端API服务 (FastAPI)
│   │   ├── app/
│   │   │   ├── main.py      # FastAPI应用入口
│   │   │   ├── schemas.py   # 数据模型定义  
│   │   │   ├── routers/     # API路由
│   │   │   │   ├── segment.py  # SAM分割API
│   │   │   │   └── assets.py   # 静态资源API
│   │   │   └── services/    # 核心业务逻辑
│   │   │       ├── sam_engine.py  # SAM引擎封装
│   │   │       ├── splitter.py   # 图像切割服务
│   │   │       └── postprocess.py # 后处理服务
│   │   └── assets/tmp/      # 临时文件存储
│   └── desktop/             # 前端应用 (Electron)
│       ├── electron/        # Electron主进程
│       └── renderer/        # React渲染进程
├── assets/                  # 静态资源
│   └── datasets/test/       # 测试图片数据集
└── output/                  # 处理结果输出
```

### 🔄 核心业务流程

#### SAM图像分割工作流

1. **初始化会话** (`/sam/init`)
   - 上传图片（路径或base64）
   - SAM模型加载图像并预处理
   - 创建session返回session_id

2. **交互式分割** (`/sam/segment`)
   - 用户在前端标记点击点/框选区域
   - 发送坐标到后端SAM引擎
   - 返回多个候选分割掩码

3. **掩码预览** (`/sam/mask/{session_id}/{mask_id}`)
   - 获取特定掩码的PNG图像
   - 前端叠加显示分割效果

4. **导出ROI** (`/sam/export-roi`)
   - 选择最终掩码并导出
   - 生成透明背景的PNG精灵图
   - 保存到output目录供前端使用

### 🔌 API接口详细说明

#### 1. 健康检查

```http
GET /health
```

#### 2. SAM分割服务

**初始化会话**

```http
POST /sam/init
Content-Type: application/json

{
  "image_path": "path/to/image.png",  // 或使用image_b64
  "image_b64": "data:image/png;base64,xxx",
  "image_name": "drawing_001.png"
}
```

**执行分割**

```http
POST /sam/segment
Content-Type: application/json

{
  "session_id": "uuid-string",
  "points": [[100, 150], [200, 250]], // 点击坐标
  "labels": [1, 0],                   // 1=前景，0=背景
  "box": [50, 50, 300, 300],         // 边界框 [x1,y1,x2,y2]
  "multimask": true,
  "top_n": 3,
  "smooth": true
}
```

**导出ROI**

```http
POST /sam/export-roi
Content-Type: application/json

{
  "session_id": "uuid-string",
  "mask_id": "candidate-mask-id",     // 或使用mask_png_b64
  "roi_index": 1,
  "feather_px": 2
}
```

#### 3. 资源管理

**列出输出文件**

```http
GET /assets/list?pattern=seg_*.png
```

**获取静态文件**

```http
GET /files/{filename}
```

## 🧪 Postman测试完整指南

### 准备工作

1. **启动后端服务**

```powershell
cd e:\Desktop\workplace\xbotpark\interactive_forest\apps\cv_service
pip install -r requirements.txt

# 设置环境变量
$env:SAM_WEIGHTS="e:\Desktop\workplace\xbotpark\interactive_forest\apps\cv_service\app\models\sam_vit_h_4b8939.pth"
$env:OUTPUT_DIR="e:\Desktop\workplace\xbotpark\interactive_forest\output"

# 启动服务
python -m uvicorn app.main:app --reload --port 7001
```

### Postman Collection 测试流程

**Collection: Interactive Forest API Tests**

⚠️ **重要提示**: SAM会话存储在内存中，服务重启后会丢失所有session。如果遇到"Session not found"错误，需要重新调用`/sam/init`创建新会话。

**0. 检查活动会话（调试用）**

```http
GET http://localhost:7001/sam/sessions
```

用于查看当前活动的session列表，排查session丢失问题。

**1. Health Check**

```http
GET http://localhost:7001/health
```

预期响应: `{"ok": true, "service": "kids-art-cv-sam", "version": "1.1.0"}`

**2. 初始化SAM会话（使用测试图片）**

```http
POST http://localhost:7001/sam/init
Content-Type: application/json

{
    "image_path": "../../assets/datasets/test/drawing_0006.png",
    "image_name": "drawing_0006.png"
}
```

**3. 执行图像分割**

```http
POST http://localhost:7001/sam/segment
Content-Type: application/json

{
  "session_id": "session_id",  // 从上一步响应中获取
  "points": [[280, 302], [335, 627]],
  "labels": [1, 1],
  "box": [488, 135, 712, 762],
  "multimask": true,
  "top_n": 3,
  "smooth": true
}
```

**4. 预览分割掩码**

```http
GET http://localhost:7001/sam/mask/{{session_id}}/{{mask_id}}
```

**5. 导出最终ROI**

```http
POST http://localhost:7001/sam/export-roi
Content-Type: application/json

{
  "session_id": "{{session_id}}",
  "mask_id": "{{best_mask_id}}",
  "roi_index": 1,
  "feather_px": 2
}
```

**6. 查看输出文件列表**

```http
GET http://localhost:7001/assets/list?pattern=seg_*.png
```

**7. 下载生成的精灵图**

```http
GET http://localhost:7001/files/seg_drawing_0001_roi_01.png
```

### Postman环境变量设置

创建Environment: `Interactive Forest Local`

```json
{
  "base_url": "http://localhost:7001",
  "session_id": "",
  "mask_id": "",
  "best_mask_id": ""
}
```

### 自动化测试脚本

在每个请求的**Tests**标签页添加：

**Init Request Tests:**

```javascript
pm.test("Status code is 200", function () {
    pm.response.to.have.status(200);
});

pm.test("Response has session_id", function () {
    const jsonData = pm.response.json();
    pm.expect(jsonData).to.have.property('session_id');
    pm.environment.set("session_id", jsonData.session_id);
});
```

**Segment Request Tests:**

```javascript
pm.test("Status code is 200", function () {
    pm.response.to.have.status(200);
});

pm.test("Response has masks", function () {
    const jsonData = pm.response.json();
    pm.expect(jsonData.masks).to.be.an('array');
    if (jsonData.masks.length > 0) {
        pm.environment.set("mask_id", jsonData.masks[0].mask_id);
        pm.environment.set("best_mask_id", jsonData.masks[0].mask_id);
    }
});
```

## 🚀 前后端联调测试

### 1. 完整环境启动

**后端启动:**

```powershell
cd apps/cv_service
$env:SAM_WEIGHTS="./app/models/sam_vit_h_4b8939.pth"
uvicorn app.main:app --host 0.0.0.0 --port 7001 --reload
```

**前端启动:**

```powershell
cd apps/desktop
npm install
npm run dev  # 启动Vite开发服务器和Electron应用
```

### 2. 端到端测试流程

1. **验证后端服务**: 访问 `http://localhost:7001/health`
2. **验证前端应用**: Electron窗口应该正常打开
3. **测试API连通性**: 前端加载图片应该能调用后端API
4. **测试分割功能**: 在前端界面进行点击分割操作
5. **验证输出**: 检查`output/`目录是否生成正确的分割结果

### 3. 调试技巧

- **后端日志**: 查看uvicorn控制台输出
- **前端调试**: 使用Electron DevTools (Ctrl+Shift+I)
- **网络监控**: 在DevTools Network面板查看API调用
- **文件监控**: 监视`assets/tmp/`和`output/`目录文件变化

## ⚠️ 注意事项

1. **SAM模型依赖**: 确保`sam_vit_h_4b8939.pth`模型文件存在
2. **CUDA支持**: 如需GPU加速，确保CUDA环境正确安装
3. **端口冲突**: 确保7001端口未被占用
4. **路径配置**: 注意Windows路径格式和权限问题
5. **内存要求**: SAM模型较大，建议16GB+内存
6. **Session管理**: 会话存储在内存中，服务重启后丢失

## 🐛 常见问题排查

### "Session not found" 错误

**原因**:

- 服务重启导致内存中的session丢失
- 使用了错误的session_id
- 在Postman中使用了未更新的环境变量

**解决方法**:

1. 检查服务是否重启过
2. 调用 `GET /sam/sessions` 查看活动会话
3. 重新调用 `POST /sam/init` 创建新会话
4. 确保Postman环境变量正确更新

**排查步骤**:

```http
# 1. 检查服务状态
GET http://localhost:7001/health

# 2. 查看活动会话
GET http://localhost:7001/sam/sessions

# 3. 如果没有活动会话，重新初始化
POST http://localhost:7001/sam/init
```

### Postman变量更新问题

确保在每个请求的Tests标签页中添加变量更新脚本：

```javascript
// 在 /sam/init 请求的 Tests 中
pm.test("Save session_id", function () {
    const jsonData = pm.response.json();
    pm.environment.set("session_id", jsonData.session_id);
    console.log("Session ID saved:", jsonData.session_id);
});
```

### Electron窗口显示全黑的问题

**症状**: Electron窗口打开但显示全黑屏幕，没有任何内容

**原因分析**:

1. Vite开发服务器未正常启动或配置错误
2. React组件编译失败或JSX语法错误
3. 环境变量未正确传递到Electron
4. 缺少必要的Vite配置文件

**解决步骤**:

1. **检查Vite服务状态**:

   ```powershell
   # 在浏览器中访问
   http://localhost:5173
   
   # 检查端口占用
   netstat -ano | findstr :5173
   ```

2. **确认Vite配置文件存在**:
   创建 `apps/desktop/renderer/vite.config.ts`:

   ```typescript
   import { defineConfig } from 'vite'
   
   export default defineConfig({
     server: {
       port: 5173,
       host: 'localhost'
     },
     base: './',
     build: {
       outDir: 'dist',
       assetsDir: 'assets'
     },
     esbuild: {
       jsx: 'automatic'
     }
   })
   ```

3. **修改Electron主进程加载逻辑**:
   在 `electron/main.js` 中添加调试信息和错误处理

4. **重启开发服务**:

   ```powershell
   cd apps/desktop
   
   # 终止现有进程
   taskkill /F /IM electron.exe
   
   # 重新启动
   npm run dev
   ```

5. **查看开发者工具**:
   - Electron窗口会自动打开DevTools
   - 检查Console面板的错误信息
   - 查看Network面板确认资源加载

**验证修复**:

- Electron窗口应显示顶部导航栏（Editor/Stage标签）
- 背景为深色主题
- DevTools Console无关键错误
- 能看到"DOM ready"日志

## 🔗 快速测试链接

### Health Check

GET <http://localhost:7001/health>
