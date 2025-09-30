const { app, BrowserWindow, screen, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");

// 允许视频/音频自动播放（含声音）——修复背景视频自带音乐不出声问题
try {
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
} catch (e) {
  console.warn('设置 autoplay-policy 失败(可忽略):', e.message);
}

let mainWindow = null;
let projectionWindow = null;

// 轨迹/音效预设目录（存放元素名称.json）
const presetsDir = path.join(__dirname, '..', 'presets');
function ensurePresetsDir() {
  try { if (!fs.existsSync(presetsDir)) fs.mkdirSync(presetsDir, { recursive: true }); } catch (e) { console.warn('创建预设目录失败:', e.message); }
}
ensurePresetsDir();

// IPC通信处理
ipcMain.on('send-to-projection', (event, data) => {
  if (projectionWindow) {
    projectionWindow.webContents.send('projection-message', data);
  }
});

ipcMain.on('send-to-main', (event, data) => {
  if (mainWindow) {
    mainWindow.webContents.send('main-message', data);
  }
});

// 退出程序请求
ipcMain.on('app-quit', () => {
  try { app.quit(); } catch (e) { console.warn('app quit failed', e.message); }
});

// 背景快照请求：从主窗口请求，转发给投影窗口
ipcMain.on('request-background', () => {
  if (projectionWindow) {
    projectionWindow.webContents.send('request-background');
  }
});

// 背景快照回复：从投影窗口返回，转发给主窗口
ipcMain.on('reply-background', (event, dataUrl) => {
  if (mainWindow) {
    mainWindow.webContents.send('background-snapshot', dataUrl);
  }
});

// 保存摄像头图片到本地并返回路径（供后端 image_path 使用）
ipcMain.handle('save-camera-image', async (_event, { dataUrl, name }) => {
  try {
    if (!dataUrl || !dataUrl.startsWith('data:image')) throw new Error('invalid dataUrl');
    const ext = dataUrl.includes('image/png') ? '.png' : '.jpg';
    const base64 = dataUrl.split(',')[1];
    const buf = Buffer.from(base64, 'base64');
    // 保存到项目内 apps/camera/photos 目录（若不存在则创建）
    const dir = path.join(__dirname, '..', '..', 'camera', 'photos');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const timeSuffix = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    // 若传入 name 已含扩展或时间戳，这里仍统一追加格式化时间，保证可读与唯一
    const base = (name || 'camera');
    const fileName = `${base}_${timeSuffix}${ext}`;
    const filePath = path.join(dir, fileName);
    fs.writeFileSync(filePath, buf);
    return { success: true, path: filePath };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// 保存元素预设（轨迹 + 音效）
ipcMain.handle('save-element-preset', async (_event, { name, data }) => {
  try {
    if (!name) throw new Error('missing name');
    ensurePresetsDir();
    // 规范化：去掉可能的图片扩展（例如 .png/.jpg）
    const base = name.replace(/\.[^.]+$/, '');
    const filePath = path.join(presetsDir, `${base}.json`);
    fs.writeFileSync(filePath, JSON.stringify({ updatedAt: Date.now(), name: base, ...data }, null, 2), 'utf-8');
    return { success: true, path: filePath };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// 读取全部元素预设
ipcMain.handle('load-element-presets', async () => {
  try {
    ensurePresetsDir();
    const files = fs.readdirSync(presetsDir).filter(f => f.endsWith('.json'));
    const presets = [];
    for (const f of files) {
      try {
        const raw = fs.readFileSync(path.join(presetsDir, f), 'utf-8');
        const obj = JSON.parse(raw);
        presets.push(obj);
      } catch (e) {
        console.warn('读取预设失败:', f, e.message);
      }
    }
    return { success: true, presets };
  } catch (e) {
    return { success: false, error: e.message, presets: [] };
  }
});

// 删除元素对应的预设文件（若存在）
ipcMain.handle('delete-element-preset', async (_event, { name }) => {
  try {
    if (!name) throw new Error('missing name');
    ensurePresetsDir();
    const base = name.replace(/\.[^.]+$/, '');
    const filePath = path.join(presetsDir, `${base}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return { success: true, removed: true };
    }
    return { success: true, removed: false };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    backgroundColor: "#000000",
    autoHideMenuBar: true,
    // fullscreen: true,  // 暂时注释掉全屏模式，便于调试
    webPreferences: {
      contextIsolation: true,
      enableRemoteModule: false,
      nodeIntegration: false,
      webSecurity: false,
      allowRunningInsecureContent: true,
      experimentalFeatures: true,
      preload: path.join(__dirname, "preload.js")
    }
  });

  // 添加调试信息
  // console.log("Environment variables:");
  console.log("VITE_DEV_URL:", process.env.VITE_DEV_URL);
  // console.log("NODE_ENV:", process.env.NODE_ENV);

  const devUrl = process.env.VITE_DEV_URL || "http://localhost:5173";
  console.log("Loading main window URL:", devUrl);

  if (devUrl) {
    mainWindow.loadURL(devUrl);
    // 开发模式下打开DevTools，快捷键 Ctrl+Shift+I
    mainWindow.webContents.openDevTools();
  } else {
    const indexPath = path.join(__dirname, "../renderer/dist/index.html");
    console.log("Loading file:", indexPath);
    mainWindow.loadFile(indexPath);
  }

  // 在主窗口完成首次加载后创建投影窗口（替代固定延迟）
  mainWindow.webContents.once('did-finish-load', () => {
    console.log('Main window did-finish-load, creating projection window');
    if (!projectionWindow) {
      createProjectionWindow();
    }
  });

  // 添加错误处理
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('Failed to load main window:', validatedURL, errorCode, errorDescription);
  });

  mainWindow.webContents.on('dom-ready', () => {
    console.log('Main window DOM ready');
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createProjectionWindow() {
  const displays = screen.getAllDisplays();
  console.log('Available displays:', displays.length);

  // 如果有多个显示器，在第二个显示器上创建投影窗口
  let targetDisplay = displays[0]; // 默认主显示器
  // TODO: 正式使用的时候切换为大屏
  if (displays.length > 1) {
    targetDisplay = displays[1]; // 使用第二个显示器
    console.log('Using secondary display for projection window');
  } else {
    console.log('Only one display available, creating projection window on main display');
  }

  projectionWindow = new BrowserWindow({
    x: targetDisplay.bounds.x,
    y: targetDisplay.bounds.y,
    width: targetDisplay.bounds.width,
    height: targetDisplay.bounds.height,
    backgroundColor: "#000000",
    autoHideMenuBar: true,
    fullscreen: true,
    frame: false,  // 无边框窗口
    webPreferences: {
      contextIsolation: true,
      enableRemoteModule: false,
      nodeIntegration: false,
      webSecurity: false,
      allowRunningInsecureContent: true,
      experimentalFeatures: true,
      preload: path.join(__dirname, "preload.js")
    }
  });

  const devUrl = process.env.VITE_DEV_URL || "http://localhost:5173";
  const projectionUrl = `${devUrl}/projection`;
  console.log("Loading projection window URL:", projectionUrl);

  if (devUrl) {
    projectionWindow.loadURL(projectionUrl);
  } else {
    const indexPath = path.join(__dirname, "../renderer/dist/index.html");
    projectionWindow.loadFile(indexPath);
    // 在生产环境中，需要通过其他方式导航到projection路由
  }

  projectionWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('Failed to load projection window:', validatedURL, errorCode, errorDescription);
  });

  projectionWindow.webContents.on('dom-ready', () => {
    console.log('Projection window DOM ready');
  });

  projectionWindow.on('closed', () => {
    projectionWindow = null;
  });
}

function createWindows() {
  createMainWindow();
  // 移除固定延迟，投影窗口将在主窗口 did-finish-load 后创建
}

app.whenReady().then(createWindows);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createMainWindow();
  } else if (projectionWindow === null) {
    // 如果主窗口已加载完成，直接创建；否则等加载完成后创建
    if (mainWindow && !mainWindow.webContents.isLoading()) {
      createProjectionWindow();
    } else if (mainWindow) {
      mainWindow.webContents.once('did-finish-load', () => {
        if (!projectionWindow) createProjectionWindow();
      });
    }
  }
});
