const { contextBridge, ipcRenderer } = require('electron');
const allowed = new Set(['state','settings','room','toggle','remove-room','order','login','cancel-login','logout','reconnect','send','moderate','dashboard','external','docs','modal','native-bounds','window','context','test-runtime']);
contextBridge.exposeInMainWorld('chatHub', {
  request: (name, payload) => { if (!allowed.has(name)) return Promise.reject(new Error('Unknown action')); return ipcRenderer.invoke(`hub:${name}`, payload); },
  subscribe: callback => { const listener = (_event, data) => callback(data); ipcRenderer.on('hub:event', listener); return () => ipcRenderer.removeListener('hub:event', listener); }
});
