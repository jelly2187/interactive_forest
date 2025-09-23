const { contextBridge, ipcRenderer } = require("electron");

// 开发期固定后端地址；也可从环境注入
contextBridge.exposeInMainWorld("__API_BASE__", "http://localhost:7001");

// 暴露IPC通信API
contextBridge.exposeInMainWorld("electronAPI", {
    sendToProjection: (data) => ipcRenderer.send('send-to-projection', data),
    sendToMain: (data) => ipcRenderer.send('send-to-main', data),
    onProjectionMessage: (callback) => ipcRenderer.on('projection-message', callback),
    onMainMessage: (callback) => ipcRenderer.on('main-message', callback),
    removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
});
