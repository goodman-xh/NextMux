'use strict';
const {ipcRenderer,contextBridge}=require('electron');
contextBridge.exposeInMainWorld('comicVisualHost',{onCommand(callback){ipcRenderer.on('comic-visual-command',(_event,meta,bytes)=>callback(meta,bytes));},result(bytes,error){ipcRenderer.send('comic-visual-result',bytes,error);},ready(){ipcRenderer.send('comic-visual-ready');}});
