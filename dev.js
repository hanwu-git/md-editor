'use strict';
/**
 * 开发启动器
 * 宿主环境可能注入 ELECTRON_RUN_AS_NODE=1 / NODE_OPTIONS=...，
 * 会使 Electron 以纯 Node 模式运行导致桌面应用失效。
 * 本启动器在进程级清除这些变量，再以正确方式启动 Electron。
 */
const { spawn } = require('child_process');
const path = require('path');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_OPTIONS;
env.ELECTRON_OVERRIDE_DIST_PATH = path.join(__dirname, '.electron-dist');

// 在 Node 模式下 require('electron') 返回 electron.exe 的路径字符串
const electronPath = require('electron');

const child = spawn(electronPath, [path.join(__dirname, '.')], {
  stdio: 'inherit',
  env
});

child.on('close', (code, signal) => {
  if (code === null) {
    console.error('[dev] electron exited with signal', signal);
    process.exit(1);
  }
  process.exit(code);
});
child.on('error', (err) => {
  console.error('[dev] failed to start electron:', err.message);
  process.exit(1);
});