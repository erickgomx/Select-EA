const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cullingAPI', {
  openDirectory: () => ipcRenderer.invoke('dialog:open-directory'),
  scanDirectory: (dirPath) => ipcRenderer.invoke('fs:scan-directory', dirPath),
  saveXmp: (data) => ipcRenderer.invoke('fs:save-xmp', data),
  revealInFolder: (filePath) => ipcRenderer.invoke('shell:show-item-in-folder', filePath),
  exportSelected: (data) => ipcRenderer.invoke('fs:export-selected', data),
  runAIAnalysis: (dirPath) => ipcRenderer.invoke('ai:run-analysis', dirPath),
  onAIProgress: (callback) => {
    const handler = (_, progress) => callback(progress);
    ipcRenderer.on('ai:progress', handler);
    return () => ipcRenderer.removeListener('ai:progress', handler);
  }
});
