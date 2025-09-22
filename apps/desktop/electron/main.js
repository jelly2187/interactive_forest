const { app, BrowserWindow } = require("electron");
const path = require("path");

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: "#000000",
    autoHideMenuBar: true,
    // fullscreen: true,  // 暂时注释掉全屏模式，便于调试
    webPreferences: {
      contextIsolation: true,
      enableRemoteModule: false,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js")
    }
  });

  // 添加调试信息
  console.log("Environment variables:");
  console.log("VITE_DEV_URL:", process.env.VITE_DEV_URL);
  console.log("NODE_ENV:", process.env.NODE_ENV);

  const devUrl = process.env.VITE_DEV_URL || "http://localhost:5173";
  console.log("Loading URL:", devUrl);

  if (devUrl) {
    win.loadURL(devUrl);
    // 开发模式下打开DevTools
    win.webContents.openDevTools();
  } else {
    const indexPath = path.join(__dirname, "../renderer/dist/index.html");
    console.log("Loading file:", indexPath);
    win.loadFile(indexPath);
  }

  // 添加错误处理
  win.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('Failed to load:', validatedURL, errorCode, errorDescription);
  });

  win.webContents.on('dom-ready', () => {
    console.log('DOM ready');
  });
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
