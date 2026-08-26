// 构建自缓存单文件启动器（指定架构）：makensis 编译 launcher.nsi → dist\MD编辑器-<64|32>.exe
// 用法：node scripts/build-launcher.js <x64|ia32>   （缺省 x64）
// 缓存目录按架构隔离：%LOCALAPPDATA%\MD编辑器\app-<版本>-<64|32>
// 前置：electron-builder --win dir 已生成当前架构的 dist\win-unpacked
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const arch = process.argv[2] || 'x64';
const suffix = arch === 'ia32' ? '32' : '64';
const unpackedName = arch === 'ia32' ? 'win-ia32-unpacked' : 'win-unpacked';
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;

// 定位 makensis：electron-builder 缓存目录
const cacheBase = path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache', 'nsis');
let makensis = null;
if (fs.existsSync(cacheBase)) {
  for (const d of fs.readdirSync(cacheBase)) {
    for (const p of [path.join(cacheBase, d, 'makensis.exe'), path.join(cacheBase, d, 'Bin', 'makensis.exe')]) {
      if (fs.existsSync(p)) makensis = p;
    }
  }
}
if (!makensis) {
  console.error('未找到 makensis.exe（electron-builder NSIS 缓存）。先跑一次 npx electron-builder --win 让其自动下载。');
  process.exit(1);
}

const unpacked = path.join(root, 'dist', unpackedName);
if (!fs.existsSync(path.join(unpacked, 'MD编辑器.exe'))) {
  console.error(`未找到 dist\\${unpackedName}\\MD编辑器.exe，请先执行 electron-builder --win dir`);
  process.exit(1);
}

const out = path.join(root, 'dist', `MD编辑器-${suffix}.exe`);
console.log(`makensis: ${makensis}`);
console.log(`架构: ${arch} (后缀 ${suffix}), 版本: ${version}, 源: dist\\${unpackedName}`);
const srcdir = root.replace(/\\/g, '/');
const r = spawnSync(makensis, ['-INPUTCHARSET', 'UTF8', `-DVERSION=${version}`, `-DARCH_SUFFIX=${suffix}`, `-DUNPACKED_NAME=${unpackedName}`, `-DSRCDIR=${srcdir}`, path.join('build', 'launcher.nsi')], { cwd: root, stdio: 'inherit' });
if (r.status !== 0) { console.error('makensis 编译失败'); process.exit(r.status || 1); }

const size = (fs.statSync(out).size / 1024 / 1024).toFixed(1);
console.log(`完成: dist\\MD编辑器-${suffix}.exe (${size} MB)`);