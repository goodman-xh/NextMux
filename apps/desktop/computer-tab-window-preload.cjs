'use strict';

// The torn-off tab window's only bridge (computer-tab-window.cjs): its own tab's live view and switches.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nextmuxTab', {
  start: () => ipcRenderer.invoke('nextmux:tab-window:start'),
  pointer: input => ipcRenderer.invoke('nextmux:tab-window:pointer', input),
  setSound: on => ipcRenderer.invoke('nextmux:tab-window:sound', on),
  userInput: on => ipcRenderer.invoke('nextmux:tab-window:user-input', typeof on === 'boolean' ? on : null),
  keys: input => ipcRenderer.invoke('nextmux:tab-window:keys', input),
  place: placement => ipcRenderer.invoke('nextmux:tab-window:place', placement),
  closeTab: () => ipcRenderer.invoke('nextmux:tab-window:close-tab'),
  identity: () => ipcRenderer.invoke('nextmux:tab-window:identity')
});
