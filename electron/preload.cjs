/* Sandboxed Electron preload scripts use the limited CommonJS loader provided by Electron. */
/* eslint-disable @typescript-eslint/no-require-imports */
const { contextBridge, ipcRenderer } = require('electron');

  contextBridge.exposeInMainWorld('yosh', {
    request(path, options) { return ipcRenderer.invoke('yosh:request', path, options); },
});
