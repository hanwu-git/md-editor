'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mdAPI', {
  // 文件操作
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
  openRecent: (filePath) => ipcRenderer.invoke('dialog:openRecent', filePath),
  saveFile: (payload) => ipcRenderer.invoke('dialog:saveFile', payload),
  saveFileAs: (payload) => ipcRenderer.invoke('dialog:saveFileAs', payload),
  confirmExit: (fileName) => ipcRenderer.invoke('dialog:confirmExit', fileName),
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  getRecent: () => ipcRenderer.invoke('app:getRecent'),

  // 视图控制
  toggleDevTools: () => ipcRenderer.invoke('view:toggleDevTools'),
  zoomIn: () => ipcRenderer.invoke('view:zoomIn'),
  zoomOut: () => ipcRenderer.invoke('view:zoomOut'),
  resetZoom: () => ipcRenderer.invoke('view:resetZoom'),
  toggleFullscreen: () => ipcRenderer.invoke('view:toggleFullscreen'),

  // 剪贴板
  readClipboard: () => ipcRenderer.invoke('edit:readClipboard'),

  // 窗口标题
  setTitle: (title) => ipcRenderer.invoke('window:setTitle', title),

  // 窗口控制
  minimize: () => ipcRenderer.send('win:minimize'),
  maximize: () => ipcRenderer.send('win:maximize'),
  closeWindow: () => ipcRenderer.send('win:close'),

  // 脏状态上报与退出确认
  setDirty: (dirty) => ipcRenderer.send('state:dirty', dirty),
  quitApproved: () => ipcRenderer.send('quit:approved'),
  quitCanceled: () => ipcRenderer.send('quit:canceled'),

  // 菜单命令监听
  onMenuCommand: (callback) => {
    ipcRenderer.on('menu:new', () => callback('new'));
    ipcRenderer.on('menu:open', () => callback('open'));
    ipcRenderer.on('menu:save', () => callback('save'));
    ipcRenderer.on('menu:saveAs', () => callback('saveAs'));
    ipcRenderer.on('menu:openRecent', (_e, filePath) => callback('openRecent', filePath));
    ipcRenderer.on('menu:check-unsaved', (_e, payload) => callback('checkUnsaved', payload));
  },

  // 最近文件变化监听（主进程持久化后推送）
  onRecentUpdated: (callback) => {
    ipcRenderer.on('recent:updated', (_e, files) => callback(files));
  },

  // 外部传入文件路径监听（右键"打开方式" / 命令行启动时打开指定文件）
  onOpenFile: (callback) => {
    ipcRenderer.on('app:openFile', (_e, filePath) => callback(filePath));
  },

  // 主题命令监听
  onThemeCommand: (callback) => {
    ipcRenderer.on('theme:set', (_e, theme) => callback(theme));
  }
});