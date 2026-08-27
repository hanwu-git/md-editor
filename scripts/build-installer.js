// 构建安装版单文件安装包（指定架构）：makensis 编译 installer.nsi → dist\MD编辑器Setup-<64|32>.exe
// 用法：node scripts/build-installer.js <x64|ia32>   （缺省 x64）
// 前置：electron-builder --win dir 已生成当前架构的 dist\win-<unpacked>
// 区别于 build-launcher.js（绿色版）：本脚本产出真正的安装向导（目录/关联/快捷方式/卸载）。
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const arch = process.argv[2] || 'x64';
const suffix = arch === 'ia32' ? '32' : '64';
const unpackedName = arch === 'ia32' ? 'win-ia32-unpacked' : 'win-unpacked';
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
// 输出主目录：与 build-all.js 保持一致（隔离构建时经 MD_DIST 注入）
const DIST_DIR = process.env.MD_DIST || 'dist';

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

const unpacked = path.join(root, DIST_DIR, unpackedName);
if (!fs.existsSync(path.join(unpacked, 'MD编辑器.exe'))) {
  console.error(`未找到 ${DIST_DIR}\\${unpackedName}\\MD编辑器.exe，请先执行 electron-builder --win dir`);
  process.exit(1);
}

// 默认安装目录：64→Program Files（$PROGRAMFILES64，规避 32 位 NSIS stub 的 WOW64 重定向到 x86），32→Program Files (x86)
const installDir = arch === 'x64'
  ? '$PROGRAMFILES64\\MD编辑器'
  : '$PROGRAMFILES32\\MD编辑器';

const out = path.join(root, DIST_DIR, `MD编辑器Setup-${suffix}.exe`);
console.log(`makensis: ${makensis}`);
console.log(`架构: ${arch} (后缀 ${suffix}), 版本: ${version}, 源: ${DIST_DIR}\\${unpackedName}`);
const srcdir = root.replace(/\\/g, '/');
// 插件目录：项目自带 nsProcess.dll（用于卸载时结束运行中的程序）
// makensis 在 <nsisRoot>/Plugins/x86-unicode 查找插件；makensis 位于 <nsisRoot>/Bin/
const nsisRoot = path.dirname(path.dirname(makensis));
const nsisPluginsDir = path.join(nsisRoot, 'Plugins', 'x86-unicode');
const plugin = path.join(root, 'build', 'plugins', 'nsProcess.dll');
if (fs.existsSync(plugin) && fs.existsSync(nsisPluginsDir)) {
  fs.copyFileSync(plugin, path.join(nsisPluginsDir, 'nsProcess.dll'));
}
const extraDefines = ['-DIS_64'];
const r = spawnSync(makensis, [
  '-INPUTCHARSET', 'UTF8',
  `-DVERSION=${version}`,
  `-DARCH_SUFFIX=${suffix}`,
  `-DUNPACKED_NAME=${unpackedName}`,
  `-DDIST_DIR=${DIST_DIR}`,
  `-DINSTALL_DIR=${installDir}`,
  `-DSRCDIR=${srcdir}`,
  ...(arch === 'x64' ? extraDefines : []),
  path.join('build', 'installer.nsi')
], { cwd: root, stdio: 'inherit' });
if (r.status !== 0) { console.error('makensis 编译失败'); process.exit(r.status || 1); }

const size = (fs.statSync(out).size / 1024 / 1024).toFixed(1);
console.log(`完成: ${DIST_DIR}\\MD编辑器Setup-${suffix}.exe (${size} MB)`);