// 一键产出 64 位与 32 位两个单文件安装包：
//   x64  → dist\MD编辑器-64.exe  （electronDist=.electron-dist，x64）
//   ia32 → dist\MD编辑器-32.exe  （electronDist=.electron-dist-ia32，x86）
// 流程：electron-builder --win dir（产出 dist\win-unpacked）→ build-launcher.js <arch>（makensis 打单文件）
// 因 32/64 需不同的 electron 二进制目录，用临时 config（内嵌 electronDist）分别驱动。
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

const ebBin = path.join(root, 'node_modules', '.bin', 'electron-builder.cmd');
if (!fs.existsSync(ebBin)) { console.error('未找到 electron-builder，请先 npm install'); process.exit(1); }

const base = {
  productName: 'MD编辑器',
  files: ['main.js', 'preload.js', 'renderer/**/*', 'node_modules/iconv-lite/**/*', 'node_modules/safer-buffer/**/*'],
  win: { target: ['dir'], icon: 'build/icon.ico' }
};
const archs = [
  { name: 'x64',  suffix: '64', electronDist: '.electron-dist' },
  { name: 'ia32', suffix: '32', electronDist: '.electron-dist-ia32' }
];

function run(cmd, args, desc, useShell) {
  console.log(`\n== ${desc} ==`);
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: !!useShell });
  if (r.status !== 0) { console.error(`${desc} 失败`); process.exit(r.status || 1); }
}

for (const a of archs) {
  const cfgPath = path.join(root, 'cache', `bcfg-${a.name}.json`);
  fs.writeFileSync(cfgPath, JSON.stringify({ ...base, electronDist: a.electronDist }, null, 2));
  if (!fs.existsSync(path.join(root, a.electronDist, 'electron.exe'))) {
    console.error(`缺少 electron 目录: ${a.electronDist}，请先准备对应架构的 Electron`);
    process.exit(1);
  }
  run(ebBin, ['--win', 'dir', `--${a.name}`, '--config', cfgPath], `electron-builder ${a.name}`, true);
  run(process.execPath, [path.join('scripts', 'build-launcher.js'), a.name], `makensis ${a.name}`, false);
}
console.log('\n全部完成：dist\\MD编辑器-64.exe 与 dist\\MD编辑器-32.exe');