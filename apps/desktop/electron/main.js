const { app, BrowserWindow, screen, ipcMain } = require("electron");
const path = require("path");

let mainWindow = null;
let projectionWindow = null;

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

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 2560,
    height: 1440,
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
