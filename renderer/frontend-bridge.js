'use strict';

// ---------- MD编辑器 · Tauri 前端桥 ----------
// 替代原 Electron preload.js 的角色：注入 window.mdAPI。
// 依赖 Tauri 的 withGlobalTauri 全局对象 window.__TAURI__（core.invoke / event.listen）。
// 全部命令名与后端 Rust #[tauri::command] 一一对应（见指南 §6.1）。

(function () {
  const T = window.__TAURI__;
  const invoke = T && T.core ? T.core.invoke : null;

  // 命令通道映射（前端方法 → Tauri 命令名 + 参数构造）
  function call(cmd, args) {
    if (!invoke) {
      return Promise.reject(new Error('__TAURI__ 不可用'));
    }
    return invoke(cmd, args || {});
  }

  window.mdAPI = {
    openFile:        () => call('dialog_open_file'),
    openRecent:      (filePath) => call('dialog_open_recent', { path: filePath }),
    saveFile:        (payload) => call('dialog_save_file', { args: { content: payload.content, encoding: payload.encoding, bom: payload.bom, path: payload.path || null } }),
    saveFileAs:      (payload) => call('dialog_save_file_as', { args: { content: payload.content, encoding: payload.encoding, bom: payload.bom } }),
    confirmExit:     (fileName) => call('dialog_confirm_exit', { fileName: fileName || '' }),
    getVersion:      () => call('app_get_version'),
    getRecent:       () => call('app_get_recent'),

    toggleDevTools:  () => call('view_toggle_devtools'),
    zoomIn:          () => call('view_zoom_in'),
    zoomOut:         () => call('view_zoom_out'),
    resetZoom:       () => call('view_reset_zoom'),
    toggleFullscreen:() => call('view_toggle_fullscreen'),

    readClipboard:   () => call('edit_read_clipboard'),
    setTitle:        (title) => call('window_set_title', { title }),
    minimize:        () => call('win_minimize'),
    maximize:        () => call('win_maximize'),
    closeWindow:     () => call('win_close'),

    // WebView2 无主进程脏标记需求，空实现保持接口兼容
    setDirty:        () => Promise.resolve(),
    quitApproved:    () => call('app_quit_approved'),
    quitCanceled:    () => call('app_quit_canceled'),

    setDefaultMdAssoc:  () => call('set_default_md_assoc'),
    clearDefaultMdAssoc: () => call('clear_default_md_assoc'),
    readImageBytes:   (path) => call('read_image_bytes', { path }),

    // 外链通过系统默认浏览器打开（v6.0.1）：避免 WebView2 应用内导航
    openExternal:     (url) => call('open_external', { url }),

    onMenuCommand:   (cb) => {
      if (!T || !T.event) return;
      const on = (evt, k) => T.event.listen(evt, () => cb(k));
      on('menu:new', 'new');
      on('menu:open', 'open');
      on('menu:save', 'save');
      on('menu:save_as', 'saveAs');
      T.event.listen('menu:open_recent', (x) => cb('openRecent', x.payload));
      T.event.listen('menu:check_unsaved', (x) => cb('checkUnsaved', x.payload));
    },
    onRecentUpdated: (cb) => { if (T && T.event) T.event.listen('recent_updated', (x) => cb(x.payload)); },
    onOpenFile:      (cb) => { if (T && T.event) T.event.listen('app_open_file', (x) => cb(x.payload)); },
    onThemeCommand:  (cb) => { if (T && T.event) T.event.listen('theme_set', (x) => cb(x.payload)); },
  };
})();