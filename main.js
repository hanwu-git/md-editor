'use strict';

const { app, BrowserWindow, Menu, ipcMain, dialog, shell, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const iconv = require('iconv-lite');

const APP_NAME = 'MD编辑器';
const APP_VERSION = app.getVersion();

// no-sandbox 兼容受限环境；GPU 不再禁用（无 GPU 时 Chromium 自动回退软件渲染）
app.commandLine.appendSwitch('no-sandbox');

// Windows：单实例锁。当用户用"打开方式"打开 .md 文件时，若应用已在运行，
// 新实例将把文件路径传给原实例后退出，避免打开多个窗口。
let pendingOpenFilePath = null;
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  return;
}

app.on('second-instance', (_event, argv) => {
  const filePath = extractFilePathFromArgv(argv);
  if (filePath && mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    mainWindow.webContents.send('app:openFile', filePath);
  }
});

// 解析命令行参数中的待打开文件路径
// Electron 启动参数结构：[, <exe>] 后可能跟目标文件路径；portable 启动器 ExecWait 透传用户参数
function extractFilePathFromArgv(argv) {
  if (!Array.isArray(argv)) return null;
  // 跳过可执行文件自身（或第一个位置）
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg || arg.startsWith('--') || arg.startsWith('-')) continue;
    // 开发模式常见干扰项：'.'（当前目录）或 Electron 内部目录参数
    if (arg === '.' || arg === './' || arg === '\\.') continue;
    const ext = path.extname(arg).toLowerCase();
    // 优先识别常见文本/Markdown 扩展名
    if (['.md', '.markdown', '.mdown', '.txt'].includes(ext)) {
      return path.resolve(arg);
    }
    // 兜底：存在且是普通文件（排除目录）
    try {
      const p = path.resolve(arg);
      const st = fs.statSync(p);
      if (st.isFile()) return p;
    } catch (e) { /* 不存在/无法访问 → 忽略 */ }
  }
  return null;
}

let mainWindow = null;

// 最近打开文件（持久化到 userData/recent-files.json，跨会话保留）
let recentFiles = [];

function recentFileStore() {
  return path.join(app.getPath('userData'), 'recent-files.json');
}
function loadRecentFiles() {
  try {
    const arr = JSON.parse(fs.readFileSync(recentFileStore(), 'utf8'));
    if (Array.isArray(arr)) return arr.filter((x) => typeof x === 'string').slice(0, 8);
  } catch (e) { /* 文件不存在或损坏 → 忽略 */ }
  return [];
}
function addRecentFile(filePath) {
  if (!filePath) return;
  recentFiles = [filePath, ...recentFiles.filter((f) => f !== filePath)].slice(0, 8);
  try { fs.writeFileSync(recentFileStore(), JSON.stringify(recentFiles)); } catch (e) { /* 持久化失败不影响会话内功能 */ }
  buildMenu();
  if (mainWindow) mainWindow.webContents.send('recent:updated', recentFiles);
}

// ---------- 窗口创建 ----------
function createWindow() {
  const ws = loadWindowState();
  mainWindow = new BrowserWindow({
    width: ws.width,
    height: ws.height,
    ...(Number.isFinite(ws.x) && Number.isFinite(ws.y) ? { x: ws.x, y: ws.y } : {}),
    minWidth: 900,
    minHeight: 600,
    title: `${APP_NAME} v${APP_VERSION}`,
    icon: path.join(__dirname, 'build', 'icon.ico'),
    show: false,
    frame: false,              // 无边框：自绘标题栏
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  });

  // 未保存跟踪
  mainWindow.__dirty = false;
  mainWindow.__closingApproved = false;

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (ws.maximized) mainWindow.maximize();
  });

  // 关闭拦截：多标签下各 tab 的未保存状态由渲染进程统一管理，
  // 因此无论主进程是否记录 dirty 都先征求渲染进程批量确认（无脏 tab 时立即放行）。
  mainWindow.on('close', (e) => {
    saveWindowState(); // 记忆窗口尺寸/位置（被拦截时也存，无副作用）
    if (mainWindow && !mainWindow.__closingApproved) {
      e.preventDefault();
      mainWindow.webContents.send('menu:check-unsaved', { action: 'quit' });
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 外部链接用系统浏览器打开（保持离线）
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ---------- 编码探测 ----------
function detectEncoding(buffer) {
  // BOM 优先
  if (buffer.length >= 2) {
    if (buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) return { encoding: 'utf-8', bom: true };
    if (buffer[0] === 0xFF && buffer[1] === 0xFE) return { encoding: 'utf-16le', bom: true };
    if (buffer[0] === 0xFE && buffer[1] === 0xFF) return { encoding: 'utf-16be', bom: true };
  }
  // 无 BOM：检测 UTF-16 特征（双字节中含大量 \x00）
  if (buffer.length >= 4) {
    let zerosLe = 0, zerosBe = 0;
    const samples = Math.min(buffer.length, 1024);
    for (let i = 0; i + 1 < samples; i += 2) {
      if (buffer[i + 1] === 0) zerosLe++;
      if (buffer[i] === 0) zerosBe++;
    }
    const half = Math.floor(samples / 2);
    if (zerosLe > half * 0.5) return { encoding: 'utf-16le', bom: false };
    if (zerosBe > half * 0.5) return { encoding: 'utf-16be', bom: false };
  }
  // 无 BOM：优先尝试 UTF-8（严格校验），失败则按 GBK 处理（Windows 中文常见编码）
  if (isValidUtf8(buffer)) return { encoding: 'utf-8', bom: false };
  return { encoding: 'gbk', bom: false };
}

function isValidUtf8(buf) {
  let i = 0;
  const len = buf.length;
  while (i < len) {
    const b = buf[i];
    if (b < 0x80) { i++; continue; }
    let n;
    if ((b & 0xE0) === 0xC0) n = 1;
    else if ((b & 0xF0) === 0xE0) n = 2;
    else if ((b & 0xF8) === 0xF0) n = 3;
    else return false;
    if (i + n >= len) return false;
    for (let j = 1; j <= n; j++) {
      if ((buf[i + j] & 0xC0) !== 0x80) return false;
    }
    i += n + 1;
  }
  return true;
}

// ---------- 读取文件（自动探测编码）----------
function readFileWithEncoding(filePath) {
  const buffer = fs.readFileSync(filePath);
  const { encoding, bom } = detectEncoding(buffer);
  // BOM 剥离：UTF-8 为 3 字节，UTF-16 为 2 字节
  const bomLen = bom ? (encoding === 'utf-8' ? 3 : 2) : 0;
  const stripBom = bomLen ? buffer.subarray(bomLen) : buffer;
  const iconvEnc = encoding === 'utf-8' ? 'utf8' : encoding === 'utf-16be' ? 'utf-16be' : encoding;
  const content = iconv.decode(stripBom, iconvEnc);
  const label = encoding === 'utf-8' ? 'UTF-8' : encoding === 'utf-16le' ? 'UTF-16LE' : encoding === 'utf-16be' ? 'UTF-16BE' : encoding.toUpperCase();
  return { content, encoding: label, bom };
}

// ---------- 写入文件（按编码）----------
function normalizeEnc(encoding) {
  return String(encoding).toLowerCase().replace(/[-\s_]/g, '');
}
function writeFileWithEncoding(filePath, content, encoding = 'UTF-8', bom = false) {
  const enc = normalizeEnc(encoding);
  const iconvEnc = enc === 'utf8' ? 'utf8' : enc === 'utf16le' ? 'utf16le' : enc === 'utf16be' ? 'utf16-be' : enc;
  let buf = iconv.encode(content, iconvEnc);
  if (bom) {
    const bomBuf =
      enc === 'utf8' ? Buffer.from([0xEF, 0xBB, 0xBF]) :
      enc === 'utf16le' ? Buffer.from([0xFF, 0xFE]) :
      enc === 'utf16be' ? Buffer.from([0xFE, 0xFF]) :
      Buffer.from([0xEF, 0xBB, 0xBF]);
    buf = Buffer.concat([bomBuf, buf]);
  }
  fs.writeFileSync(filePath, buf);
}

// ---------- 未保存确认 ----------
function checkUnsavedBeforeAction(action) {
  if (!mainWindow) return;
  mainWindow.webContents.send('menu:check-unsaved', { action });
}

// ---------- 应用菜单 ----------
function buildMenu() {
  const isMac = process.platform === 'darwin';
  const send = (channel) => {
    if (mainWindow) mainWindow.webContents.send(channel);
  };
  const sendAsync = (channel, payload) => {
    if (mainWindow) mainWindow.webContents.send(channel, payload);
  };

  const template = [
    {
      label: '文件',
      submenu: [
        { label: '新建', accelerator: 'CmdOrCtrl+N', click: () => send('menu:new') },
        { label: '打开…', accelerator: 'CmdOrCtrl+O', click: () => send('menu:open') },
        { type: 'separator' },
        { label: '保存', accelerator: 'CmdOrCtrl+S', click: () => send('menu:save') },
        { label: '另存为…', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('menu:saveAs') },
        { type: 'separator' },
        {
          label: '最近打开的文件',
          submenu: recentFiles.length
            ? recentFiles.map((f) => ({
                label: f,
                click: () => sendAsync('menu:openRecent', f)
              }))
            : [{ label: '（无）', enabled: false }]
        },
        { type: 'separator' },
        isMac ? { role: 'close', label: '关闭窗口' } : { label: '退出', accelerator: 'Alt+F4', click: () => app.quit() }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' }
      ]
    },
    {
      label: '主题',
      submenu: [
        { label: '浅色', click: () => sendAsync('theme:set', 'light') },
        { label: '深色', click: () => sendAsync('theme:set', 'dark') }
      ]
    },
    {
      label: '帮助',
      submenu: [
        {
          label: `关于 ${APP_NAME}`,
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: `关于 ${APP_NAME}`,
              message: `${APP_NAME} v${APP_VERSION}`,
              detail: '本地 Markdown 编辑器\n· 分屏实时预览\n· Mermaid 流程图\n· 代码语法高亮\n· 多编码支持（UTF-8 / GBK / UTF-16）\n· 完全离线运行',
              buttons: ['确定'],
              noLink: true
            });
          }
        }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- IPC ----------
ipcMain.handle('dialog:openFile', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: '打开文件',
    filters: [
      { name: 'Markdown 文档', extensions: ['md', 'markdown', 'mdown', 'txt'] },
      { name: '所有文件', extensions: ['*'] }
    ],
    properties: ['openFile']
  });
  if (res.canceled || !res.filePaths.length) return { canceled: true };
  const filePath = res.filePaths[0];
  const { content, encoding, bom } = readFileWithEncoding(filePath);
  addRecentFile(filePath);
  return { canceled: false, path: filePath, content, encoding, bom, fileName: path.basename(filePath) };
});

ipcMain.handle('dialog:openRecent', async (_e, filePath) => {
  try {
    const { content, encoding, bom } = readFileWithEncoding(filePath);
    addRecentFile(filePath);
    return { canceled: false, path: filePath, content, encoding, bom, fileName: path.basename(filePath) };
  } catch (err) {
    return { canceled: false, error: `无法打开文件：${err.message}`, path: filePath };
  }
});

ipcMain.handle('app:getRecent', () => recentFiles);

ipcMain.handle('dialog:saveFile', async (_e, payload) => {
  const { path: filePath, content, encoding, bom } = payload;
  try {
    let target = filePath;
    if (!target) {
      const res = await dialog.showSaveDialog(mainWindow, {
        title: '保存文件',
        defaultPath: '未命名.md',
        filters: [
          { name: 'Markdown 文档', extensions: ['md'] },
          { name: '文本文件', extensions: ['txt'] },
          { name: '所有文件', extensions: ['*'] }
        ]
      });
      if (res.canceled || !res.filePath) return { canceled: true };
      target = res.filePath;
    }
    writeFileWithEncoding(target, content, encoding, bom); // 无路径时也必须实际写入（修复首次保存不落盘）
    addRecentFile(target);
    return { canceled: false, path: target, saved: true };
  } catch (err) {
    return { canceled: false, saved: false, error: err.message };
  }
});

ipcMain.handle('dialog:saveFileAs', async (_e, payload) => {
  const { content, encoding, bom } = payload;
  const res = await dialog.showSaveDialog(mainWindow, {
    title: '另存为',
    defaultPath: '未命名.md',
    filters: [
      { name: 'Markdown 文档', extensions: ['md'] },
      { name: '文本文件', extensions: ['txt'] },
      { name: '所有文件', extensions: ['*'] }
    ]
  });
  if (res.canceled || !res.filePath) return { canceled: true };
  try {
    writeFileWithEncoding(res.filePath, content, encoding, bom);
    addRecentFile(res.filePath);
    return { canceled: false, path: res.filePath, saved: true };
  } catch (err) {
    return { canceled: false, saved: false, error: err.message };
  }
});

ipcMain.handle('window:setTitle', (_e, title) => {
  if (mainWindow) mainWindow.setTitle(title);
});

ipcMain.handle('app:getVersion', () => APP_VERSION);
ipcMain.handle('dialog:confirmExit', async (_e, fileName) => {
  const res = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: '确认退出',
    message: `是否保存对 ${fileName || '未命名'} 的更改？`,
    detail: '您的更改将丢失，如果选择"不保存"。',
    buttons: ['取消', '不保存', '保存'],
    defaultId: 2,
    cancelId: 0,
    noLink: true
  });
  return res.response; // 2=保存 1=不保存 0=取消
});

// ---------- 视图控制（HTML 菜单栏使用；原生菜单快捷键由 role 自带） ----------
ipcMain.handle('view:toggleDevTools', () => { if (mainWindow) mainWindow.webContents.toggleDevTools(); });
ipcMain.handle('view:zoomIn', () => {
  if (mainWindow) mainWindow.webContents.setZoomLevel(Math.min(mainWindow.webContents.getZoomLevel() + 0.5, 8));
});
ipcMain.handle('view:zoomOut', () => {
  if (mainWindow) mainWindow.webContents.setZoomLevel(Math.max(mainWindow.webContents.getZoomLevel() - 0.5, -8));
});
ipcMain.handle('view:resetZoom', () => { if (mainWindow) mainWindow.webContents.setZoomLevel(0); });
ipcMain.handle('view:toggleFullscreen', () => {
  if (mainWindow) mainWindow.setFullScreen(!mainWindow.isFullScreen());
});

// ---------- 剪贴板（渲染进程 execCommand('paste') 被安全策略拦截，经主进程中转） ----------
ipcMain.handle('edit:readClipboard', () => clipboard.readText());

// ---------- 窗口控制 ----------
ipcMain.on('win:minimize', () => { if (mainWindow) mainWindow.minimize(); });
ipcMain.on('win:maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('win:close', () => { if (mainWindow) mainWindow.close(); });

// 渲染进程上报脏状态 & 退出确认结果
ipcMain.on('state:dirty', (_e, dirty) => {
  if (mainWindow) mainWindow.__dirty = dirty;
});
ipcMain.on('quit:approved', () => {
  if (mainWindow) mainWindow.__closingApproved = true;
  app.quit();
});
ipcMain.on('quit:canceled', () => {
  if (mainWindow) mainWindow.__closingApproved = false;
});

// ---------- 窗口尺寸/位置记忆 ----------
function windowStateStore() {
  return path.join(app.getPath('userData'), 'window-state.json');
}
function loadWindowState() {
  try {
    const s = JSON.parse(fs.readFileSync(windowStateStore(), 'utf8'));
    if (s && Number.isFinite(s.width) && Number.isFinite(s.height)) return s;
  } catch (e) { /* 无记录 → 默认尺寸 */ }
  return { width: 1280, height: 800, maximized: false };
}
function saveWindowState() {
  if (!mainWindow) return;
  try {
    const bounds = mainWindow.getNormalBounds(); // 最大化时取还原尺寸
    const s = { ...bounds, maximized: mainWindow.isMaximized() };
    fs.writeFileSync(windowStateStore(), JSON.stringify(s));
  } catch (e) { /* 持久化失败不影响退出 */ }
}

// ---------- 主流程 ----------
app.whenReady().then(() => {
  recentFiles = loadRecentFiles();

  // 启动时可能携带文件路径（右键→打开方式 / 命令行传参）
  pendingOpenFilePath = extractFilePathFromArgv(process.argv);

  createWindow();
  buildMenu();

  // 窗口 ready 后，若启动参数包含文件路径则通知渲染进程打开
  if (pendingOpenFilePath) {
    mainWindow.webContents.once('dom-ready', () => {
      mainWindow.webContents.send('app:openFile', pendingOpenFilePath);
      pendingOpenFilePath = null;
    });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});