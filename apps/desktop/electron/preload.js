const { contextBridge, ipcRenderer } = require("electron");

// 开发期固定后端地址；也可从环境注入
contextBridge.exposeInMainWorld("__API_BASE__", "http://localhost:7001");

// 暴露IPC通信API
contextBridge.exposeInMainWorld("electronAPI", {
    sendToProjection: (data) => ipcRenderer.send('send-to-projection', data),
    sendToMain: (data) => ipcRenderer.send('send-to-main', data),
    onProjectionMessage: (callback) => ipcRenderer.on('projection-message', callback),
    onMainMessage: (callback) => ipcRenderer.on('main-message', callback),
    // 背景快照相关（IPC 通道）
    requestBackground: () => ipcRenderer.send('request-background'),
    onBackgroundSnapshot: (callback) => ipcRenderer.on('background-snapshot', (event, dataUrl) => callback(event, dataUrl)),
    onRequestBackground: (callback) => ipcRenderer.on('request-background', callback),
    replyBackground: (dataUrl) => ipcRenderer.send('reply-background', dataUrl),
    removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
    saveCameraImage: (dataUrl, name) => ipcRenderer.invoke('save-camera-image', { dataUrl, name }),
    saveElementPreset: (name, data) => ipcRenderer.invoke('save-element-preset', { name, data }),
    loadElementPresets: () => ipcRenderer.invoke('load-element-presets')
});
