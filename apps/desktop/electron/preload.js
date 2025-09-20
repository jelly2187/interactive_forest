const { contextBridge } = require("electron");

// 开发期固定后端地址；也可从环境注入
contextBridge.exposeInMainWorld("__API_BASE__", "http://localhost:7001");
