const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  render: (url, token) => ipcRenderer.invoke('render', { url, token }),
});
