# Interactive Forest 使用指南 🎮

## 🚀 快速启动

### 1. 启动后端服务

```powershell
cd apps/cv_service
$env:SAM_WEIGHTS="./app/models/sam_vit_h_4b8939.pth"
$env:OUTPUT_DIR="../../output"
python -m uvicorn app.main:app --reload --port 7001
```

### 2. 启动前端应用  

```powershell
cd apps/desktop
npm install
npm run dev
```

### 3. 准备媒体文件

- 视频文件: `apps/desktop/renderer/public/video/forest.mp4`
- 音效文件: `apps/desktop/renderer/public/audio/` (可选)

## 🎨 分割与采集（新版多阶段）

### 步骤1: 获取输入

1. 方式 A：点击“选择文件”上传（PNG/JPG 建议单边 < 4096）
2. 方式 B：启用摄像头 → 若画面灰阶系统自动尝试“强制彩色”
3. 拍照后自动调用 /sam/init（base64）并进入 ROI 阶段

### 步骤2: ROI 框选

1. 在图像上拖拽创建一个或多个 ROI
2. 选中 ROI 自动进入“点标注”
3. 可删除或切换到其它 ROI 继续处理

### 步骤3: 点标注 & 候选

1. 左键前景（绿点）/ 右键背景（红点）
2. 点数 ≥ 1 后触发 /sam/segment 生成 top_n 掩码
3. 切换查看候选；进入“画笔润色”可增/删局部
4. 确认掩码 → 导出（裁剪 ROI + feather）到 output/ 唯一命名

## 🌲 舞台元素（可见性模型）

### 进入舞台

1. 点击顶部"森林舞台"标签
2. 点击"🎬 进入沉浸模式"开启全屏体验

### 互动机制

- 新导出元素进入“列表（未上墙）”
- 上墙：visible=true，开始动画 / 音效
- 下墙：visible=false，暂停音效但保留状态
- 删除：列表移除 + 调用 /assets/delete 删除 seg_ 文件
- 启动恢复：扫描历史 seg_*.png 重新加入（未自动上墙）
- 拖拽：直接改变舞台位置；后续可扩展关键帧轨迹

### 动画类型（当前实现）

- sway：正弦摆动 + 轻微旋转扰动
- fly：波浪式路径（y=sin 时间函数）
- move：关键帧（pos/scale/rotation/alpha）插值
- idle：不更新位移

## 🎵 音效系统（防重复播放）

### 音效配置

在 `public/audio/` 目录下放置音效文件:

- `bird.mp3` - 鸟类音效
- `dog.mp3` - 动物音效
- `wind.mp3` - 风声音效

### 触发机制

- 上墙时可自动播放（或手动点击）
- 内部去重：避免 canplay 与超时双触发
- 下墙时自动暂停（可选重置进度）

## 🔧 自定义配置

### 动画参数

```typescript
animation: {
  type: 'sway',      // 动画类型
  speed: 1.0,        // 速度倍数  
  amplitude: 10,     // 摇摆幅度
  phase: 0           // 初始相位
}
```

### 音效设置

```typescript
sound: {
  audio: new Audio('/audio/bird.mp3'),
  loop: true,        // 循环播放
  volume: 0.3        // 音量 (0.0-1.0)
}
```

## 🚨 常见问题

### Q: 黑屏无法显示？

**A**: 检查是否已安装React类型定义并存在视频文件

```powershell
npm install @types/react @types/react-dom
```

### Q: SAM服务连接失败？

**A**: 验证后端服务状态

```bash
curl http://localhost:7001/health
```

### Q: 音效重复播放？

**A**: 使用新版（已移除旧定时器回退）。若仍复现，检查是否多实例窗口。

### Q: 音效无法播放？

**A**: 确保音频文件存在且格式正确 (MP3/WAV)，并在用户交互后触发（浏览器策略）。

### Q: 分割结果不理想？

**A**:

- 调整 ROI 边界贴紧主体
- 添加少量高信息量前景点（边界 / 细节）
- 添加背景点分离相邻干扰
- 使用画笔微调细枝/孔洞

## 📋 系统要求

### 硬件要求

- **CPU**: Intel i5 或同等性能
- **内存**: 16GB+ RAM
- **显卡**: 支持WebGL 2.0
- **存储**: 5GB+ 可用空间

### 软件环境  

- **操作系统**: Windows 10/11, macOS 10.15+, Linux
- **Node.js**: 16.0+
- **Python**: 3.8+
- **浏览器**: Chrome 80+, Firefox 75+

## 🎯 最佳实践

### 图片处理建议

- 选择清晰、高对比度的儿童画作
- 确保要抠图的元素边界清晰
- 避免过于复杂的背景

### 性能优化（新版）

- 限制点标注数量（过多收益递减）
- 图片过大先等比压缩再处理
- 避免一次性上墙过多元素（>30 建议分批）
- 定期删除不再需要的 seg_* 文件

### 创意展示

- 组合不同动画类型的元素
- 利用音效增强沉浸感
- 创建主题化的森林场景

## 🎪 展示效果

### 教育应用

- **儿童美术展**: 让静态画作"活"起来
- **互动教学**: 增强孩子的创作兴趣
- **艺术治疗**: 通过互动提升参与度

### 商业价值

- **数字画廊**: 创新的艺术展示方式
- **儿童乐园**: 沉浸式娱乐体验
- **教育机构**: 现代化教学工具

---

**立即体验新版多阶段分割与可见性上墙流程！** ✨🌲
