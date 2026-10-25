'use strict';

// Preload for the small "drag NextMux into the list" helper window
// (system-permissions.cjs). It can only start the drag of the app bundle and
// close itself.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nextmuxPermissionHelper', Object.freeze({
  startDrag: () => ipcRenderer.send('nextmux:permission-helper:drag'),
  close: () => ipcRenderer.send('nextmux:permission-helper:close')
}));
