/* Sandboxed Electron preload scripts use the limited CommonJS loader provided by Electron. */
/* eslint-disable @typescript-eslint/no-require-imports */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('app2049', {
  request(path, options) { return ipcRenderer.invoke('app2049:request', path, options); },
});
