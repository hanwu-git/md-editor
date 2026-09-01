# MD编辑器 · Tauri (Rust) 重构开发指南

> 一份「只凭本文档即可在独立环境完成开发」的完整指导。
> 目标：以现有 Electron 版 `md编辑器` 为功能基准，用 **Tauri 2.x** 重新实现一个体制同样的产品，但**安装包更小、启动更快、运行时内存更低**，并可做成**独立运行的绿色版**。
> 本文档沉淀了原版全部需求、系统架构、后端能力清单、前端对接方案、分阶段实施与验收标准。

---

## 目录
1. [项目背景与目标](#1-项目背景与目标)
2. [现状基线（必须对照的功能全部）](#2-现状基线必须对照的功能全部)
3. [技术选型与约束](#3-技术选型与约束)
4. [系统架构](#4-系统架构)
5. [项目目录结构](#5-项目目录结构)
6. [完整需求规格（后端能力映射）](#6-完整需求规格后端能力映射)
7. [前端对接方案](#7-前端对接方案)
8. [分阶段实施计划](#8-分阶段实施计划)
9. [打包与分发（绿色版 / 安装版）](#9-打包与分发绿色版--安装版)
10. [验收与对照标准](#10-验收与对照标准)
11. [风险与注意事项](#11-风险与注意事项)
12. [环境准备命令清单](#12-环境准备命令清单)

---

## 1. 项目背景与目标

- **背景**：现有 `md编辑器` 是 Electron 43 应用（安装包 96.6MB/解压 315MB，Chromium 启动 ~1.5–2s，每实例内存 200MB+）。
- **诉求**：在不降低功能与体验的前提下，把单体安装包、启动速度、运行效率三方面同时提升。
- **结论**：唯一能本质提升三者的路径是**移除 Electron 内核**、改用更轻的运行时。本文档选择 **Tauri 2.x（Rust 后端 + 系统 WebView2 渲染）**。
- **目标形态**：绿色版为「单 exe、免安装、零额外运行时依赖」；安装版可选（主要做文件关联）。
- **约束**：完全离线；界面/交互/功能与 Electron 版对齐；前端 `renderer` 可近乎原样复用。

### 1.1 为什么是 Tauri 而非 .NET WebView2（决策记录）
| 维度 | Tauri 2.x | .NET + WebView2 |
|---|---|---|
| 应用运行时依赖 | 无（Rust 静态编译单二进制） | 需 .NET（self-contained 变大 / framework 需装环境） |
| 绿色单 exe | 最干净、零依赖 | 可行但受 .NET 打包策略制约 |
| 构建环境 | Rust + MSVC | .NET SDK（本机已装亦可） |
| 体积 | ~5–10MB 级 | ~1–5MB（但仍需 .NET 取舍） |

> 本项目按 **Tauri 2.x** 落地；若目标机器长期仅 Windows 且不愿引入 Rust 工具链，可退而选择 .NET+WebView2，功能清单与本指南完全通用，仅后端实现语言与打包方式不同。

---

## 2. 现状基线（必须对照的功能全部）

> 以下功能是「等价目标」，重构后每一项都要能复现。后端能力原实现于 `electron/main.js`，IPC 桥原实现于 `electron/preload.js`。

### 2.1 后端能力（原 main.js）
| # | 能力 | 行为细节 |
|---|---|---|
| B1 | 单实例锁 | 应用已运行时再次启动（如右键"打开方式"）→ 新实例退出，把文件路径传给已运行窗口打开并聚焦 |
| B2 | 命令行/右键传参打开 | 解析启动参数：跳过 `--`/`-` 开头、`.`, `./`、Electron 内部目录；按扩展名 `.md/.markdown/.mdown/.txt` 优先识别，兜底用 `stat` 确认是普通文件 |
| B3 | 最近文件持久化 | 存 `userData/recent-files.json`，最多 8 个，去重，写入后重建菜单并广播 `recent:updated` |
| B4 | 窗口状态记忆 | 存 `window-state.json`（width/height/x/y/maximized），启动恢复；关闭拦截时也先保存 |
| B5 | 无边框窗口 | `frame:false` 自绘标题栏；minWidth 900 / minHeight 600；icon；`show:false` + `ready-to-show` 再显示 |
| B6 | 关闭拦截 | 窗口 close 时先征求前端批量确认未保存（无脏 tab 立即放行），防止未保存丢失 |
| B7 | 外部链接打开 | 页面中的外链统一用系统浏览器打开，保持离线 |
| B8 | 编码自动探测与读写 | BOM(UTF-8/UTF-16LE/BE) 优先 → UTF-16 双字节零比特征 → UTF-8 严格校验 → 兜底 GBK；读写支持 `UTF-8 / UTF-16LE / UTF-16BE / GBK`，写时可带/不带 BOM |
| B9 | 原生菜单 | 文件（新建/打开/保存/另存/最近8项/退出）、编辑（撤销重做剪贴全选）、视图（重载/DevTools/缩放/全屏）、主题（浅色/深色）、帮助（关于对话框） |
| B10 | IPC 处理器 | 见 §6「后端命令清单」 |
| B11 | 主进程广播事件 | `menu:new/open/save/saveAs/openRecent/check-unsaved`、`recent:updated`、`app:openFile`、`theme:set` |

### 2.2 前端能力（原 renderer）
| # | 能力 | 行为细节 |
|---|---|---|
| F1 | 自绘标题栏 | theme-toggle / 最小化 / 最大化 / 关闭 按钮；`document.title` 随文件变化 |
| F2 | 菜单栏（HTML 自绘） | `buildMenubar()`/`showMenu()`；支持 `checked` 勾选态、快捷键、最近文件、点击行为 |
| F3 | 多标签页 | `state.tabs`/`activeTabId`；`addOrActivateTab()` 按路径去重复用、`switchTab()`、`closeTab()`（含未保存确认）、中键关闭；欢迎页逻辑（干净则打开新文件时自动移除） |
| F4 | 分屏编辑+预览 | 左文本域+行号(`#line-nums`)、分隔条(`#divider`)、右预览(`#preview`) |
| F5 | 实时渲染管线 | custom marked Renderer.code 把 `mermaid/mmd` 块保留为 `<pre class="mermaid">`；`scheduleRender()`→`renderAll()`→`marked.parse()+annotatePreview()+highlightCodeBlocks()+renderMermaid()+渲染耗时` |
| F6 | 懒加载 | `mermaid` / `highlight.js` 仅当用到时经 `lazy-loader` 注入（本地 vendor 优先，CDN 兜底，Promise 缓存） |
| F7 | 双向跳转 | 预览双击(`data-src-pos`)→源码选中；源码光标→预览对应块高亮滚动；`jumpPreviewToSource()/jumpEditorToPreview()/annotatePreview()` |
| F8 | 查找替换 | 查找/上一个/下一个/全部替换/替换；区分大小写开关 |
| F9 | 视图开关 | 预览显示/隐藏、双向同步滚动、自动折行；持久化 `localStorage`：`md-show-preview` / `md-sync-scroll` / `md-wrap` |
| F10 | 明暗主题 | `data-theme` 切换，`localStorage` 持久化（默认浅色） |
| F11 | 状态栏 | 编码、行列字符统计、脏状态、渲染耗时 |
| F12 | 未保存确认浮层 | 保存 / 不保存 / 取消 三选，随关闭/切换 tab 触发 |
| F13 | 剪贴板中转 | 渲染进程 `execCommand('paste')` 被安全策略拦截，粘贴经后端 `readClipboard` 中转 |

### 2.3 前端依赖
- `marked`（本地同步加载，44KB）
- `mermaid`（懒加载）
- `highlight.js`（懒加载）
- 均为前端即可用库，**可直接照搬**。

### 2.4 性能基线（Electron 版实测，作为对照）
- 安装包（64 位）：96.6MB；解压后 win-unpacked 315.4MB
- 启动：安装版真身直跑主进程 1.3–2.1s、load 完成 ~1.5–1.7s
- 运行内存：Electron 每实例 200–300MB

---

## 3. 技术选型与约束

- **框架**：Tauri 2.x（`tauri` crate 2.x，`@tauri-apps/api` 前端）
- **语言**：Rust（stable，`x86_64-pc-windows-msvc` target）
- **渲染**：系统 WebView2（Windows 10/11 内置，目标机无需随包分发运行时；如需兼容极老系统，可在安装包内置 Evergreen loader）
- **前端**：原样复用现有 `renderer/`（HTML+CSS+JS+marked/mermaid/highlight）
- **关键插件（Tauri 2）**：
  - `tauri-plugin-dialog`：打开/保存对话框、消息框
  - `tauri-plugin-single-instance`：单实例 + 二次启动传参
  - `tauri-plugin-window-state`：窗口位置/大小记忆
  - `tauri-plugin-clipboard-manager`：读剪贴板
  - 编码转换：`encoding_rs` crate（GB18030 / UTF-16 / UTF-8）
- **后端语言需新增实现**（对应原 Node/iconv-lite）：文件读写、编码探测、最近文件、窗口状态、菜单、未保存确认、命令行传参、文件关联。

---

## 4. 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                        前端 (WebView2)                        │
│  renderer/ (复用)  index.html / app.js / styles.css          │
│  - 编辑器 + 预览 + 多标签 + 菜单 + 查找替换 + 双向跳转        │
│  - 通过 window.__TAURI__.core.invoke 调用后端命令              │
└───────────────▲─────────────────────────┬───────────────────┘
                │ invoke (async 命令)      │ Event（后端→前端）
                │                          │ (listen / emit)
┌───────────────┴─────────────────────────┴───────────────────┐
│                       后端 (Rust / tauri)                    │
│  main.rs        : 主入口、菜单、窗口、单实例、命令参数         │
│  lib.rs         : run() 装配插件与管理器                      │
│  fs_io.rs       : 文件读/写 + 编码探测(encoding_rs) + BOM    │
│  recent.rs      : recent-files.json 持久化                   │
│  winstate.rs    : window-state.json 持久化                   │
│  commands.rs    : 所有 #[tauri::command] 处理器              │
│  asset 读取      : app.asar/app 侧资源统一由 tauri 管理       │
└─────────────────────────────────────────────────────────────┘
```

**通信模型（Tauri 对应 Electron）**
- 命令（命令 返回 Promise）：`invoke('cmd_name', payload)` ⇔ 原 `ipcRenderer.invoke('dialog:openFile')`
- 事件（后端 emit → 前端 listen）：`emit('menu:new')` ⇔ 原 `webContents.send('menu:new')`

---

## 5. 项目目录结构

```
md-editor-tauri/                 # 独立新仓库
├── src-tauri/                   # Rust 后端
│   ├── src/
│   │   ├── main.rs              # 入口：启动、窗口、菜单、单实例、命令参数解析
│   │   ├── lib.rs               # run()：装配插件、注册命令、事件收发
│   │   ├── fs_io.rs             # 编码探测 + 读写（B1/B8 支撑）
│   │   ├── recent.rs            # 最近文件（B3）
│   │   ├── winstate.rs          # 窗口状态（B4）
│   │   └── commands.rs          # 全部 tauri command（§6 映射）
│   ├── Cargo.toml
│   ├── tauri.conf.json          # 窗口/标识/资源/文件关联/打包配置
│   ├── capabilities/default.json# 权限（core:window/event、dialog、clipboard、single-instance）
│   └── icons/                   # icon.ico 等（可从原 build/icon.ico 转换）
├── renderer/                    # 前端（从原 Electron 项目复用/拷贝）
│   ├── index.html
│   ├── app.js
│   ├── styles.css
│   ├── lazy-loader.js
│   └── vendor/{marked.umd.js, mermaid.min.js, highlight.min.js}
├── package.json                 # 可选：用 @tauri-apps/cli 驱动构建
└── README.md
```

---

## 6. 完整需求规格（后端能力映射）

> 把原 `preload.js` 暴露的 `window.mdAPI` 与 `main.js` 的 IPC 逐一映射为 Tauri 命令。**命令名保持原通道名**，便于前端最小改动替换。

### 6.1 命令清单（前端调用）
| 原 IPC 通道 | 类型 | Tauri 命令名 | 参数 | 返回值 | 说明 |
|---|---|---|---|---|---|
| `dialog:openFile` | invoke | `dialog_open_file` | 无 | {canceled, path, content, encoding, bom, fileName} \| {error} | 打开对话框→读文件→写最近文件 |
| `dialog:openRecent` | invoke | `dialog_open_recent` | path | 同上 | 读指定文件→写最近文件，失败返回 error |
| `dialog:saveFile` | invoke | `dialog_save_file` | {path?, content, encoding, bom} | {canceled, path, saved} \| {error} | 无 path 时弹保存框；按编码写盘 |
| `dialog:saveFileAs` | invoke | `dialog_save_file_as` | {content, encoding, bom} | 同上 | 总是弹另存为框 |
| `app:getRecent` | invoke | `app_get_recent` | 无 | string[] | 最近文件列表 |
| `app:getVersion` | invoke | `app_get_version` | 无 | string | 版本号 |
| `dialog:confirmExit` | invoke | `dialog_confirm_exit` | fileName | 0/1/2（取消/不保存/保存） | 未保存确认消息框 |
| `view:toggleDevTools` | invoke | `view_toggle_devtools` | 无 | — | 开发用 |
| `view:zoomIn/Out/reset/toggleFullscreen` | invoke | 同名 | 无 | — | 缩放/全屏 |
| `edit:readClipboard` | invoke | `edit_read_clipboard` | 无 | string | 剪贴板文本（粘贴中转） |
| `window:setTitle` | invoke | `window_set_title` | title | — | 改窗口/文档标题 |
| `win:minimize` | send | `win_minimize` | 无 | — | |
| `win:maximize` | send | `win_maximize` | 无 | — | 最大化/还原切换 |
| `win:close` | send | `win_close` | 无 | — | 触发窗口关闭（走 B6 拦截） |

### 6.2 后端事件（后端 → 前端）
> 事件名一律用下划线 `_` 风格，与 §7 `frontend-bridge.js` 的 `listen()` 保持一致，避免歧义。原通道的冒号名对齐到下表「事件名」列。
| 原通道 | 事件名 | 载荷 | 触发 |
|---|---|---|---|
| `menu:new/open/save/saveAs` | `menu:new` `menu:open` `menu:save` `menu:save_as` | 无 | 菜单点击 |
| `menu:openRecent` | `menu:open_recent` | filePath | 菜单·最近文件点击 |
| `menu:check-unsaved` | `menu:check_unsaved` | {action} | 关窗/切换 tab 前 |
| `recent:updated` | `recent_updated` | string[] | 最近文件变更 |
| `app:openFile` | `app_open_file` | filePath | 二次启动/命令行传参 |
| `theme:set` | `theme_set` | 'light'\|'dark' | 原生菜单主题切换 |

### 6.3 单实例与命令行传参（B2）
- 用 `tauri-plugin-single-instance`（`app_detection` 自带）；二次启动回调里取参、`extract_file_path` 解析、若窗口最小化则还原聚焦、`emit('app_open_file', path)`。
- `extract_file_path` 移植 B2 规则：过滤 `--`/`-` 前缀与 `.`/`./`，扩展名白名单优先，兜底 `std::fs::metadata().is_file()`，返回绝对路径。

### 6.4 编码探测与读写（B8）
- `encoding_rs`：`GBK` → `GB18030`，`UTF-16LE/BE`，`UTF-8`。
- 探测顺序移植：
  1. BOM：`EF BB BF`=UTF-8；`FF FE`=UTF-16LE；`FE FF`=UTF-16BE
  2. 无 BOM：采样前 1024 字节双字节 `\x00` 占比 → UTF-16LE/BE
  3. UTF-8 严格校验器（可用 `encoding_rs` 的直接校验或复刻原 `isValidUtf8`）
  4. 兜底 `GB18030`
- 写盘：按选中的编码 + BOM 选项拼接 BOM 后写出。
- 返回值 encoding 字符串与现版一致（`UTF-8/UTF-16LE/UTF-16BE/GBK`）。

### 6.5 持久化位置
- 最近文件：`{app_config_dir}/recent-files.json`
- 窗口状态：全部交给 `tauri-plugin-window-state`（等价于 window-state.json）。
- 前端偏好：继续用 `localStorage`（WebView2 自动持久化，key 不变）。

### 6.6 菜单、窗口、未保存确认
- **无边框自绘标题栏（B5）**：`tauri.conf.json` `app.windows[0].decorations=false`、`minWidth=900`、`minHeight=600`；让 `index.html` 标题栏可拖拽：给标题栏加 `data-tauri-drag-region`。最小/最大/关闭调用命令 6.1。
- **原生菜单**：用 `tauri::menu::{Menu, Submenu, MenuItem, PredefinedMenuItem}` 在 `main.rs` 构建，`ContextMenu`/菜单栏均按 B9 结构；`checked` 同步到原生菜单项（对应视图开关的勾选态）；主题菜单 emit `theme:set`，关于菜单弹 dialog。
- **未保存确认（B6/12）**：窗口 close 事件 → `emit('menu:check-unsaved', {action:'quit'})`；前端弹浮层后据选择：保存→invoke save→`app.quit()`；不保存→`app.quit()`；取消→`invalidate/destroy` 前阻止。多 tab 批量确认由前端循环逐个发起（沿用现成为逻辑）。
- **外链处理（B7）**：前端对 `target=_blank`/`http(s)` 链接拦截后调用 `tauri-plugin-opener` 或 `opener` crate 用系统浏览器打开，保持离线。

---

## 7. 前端对接方案

前端基本原样复用，**只改「通信接入层」**，把 `preload.js` 的 `mdAPI` 等价成一个 `frontend-bridge.js`：

```js
// frontend-bridge.js（替换 preload.js 的角色，注入 window.mdAPI）
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

window.mdAPI = {
  openFile:           () => invoke('dialog_open_file'),
  openRecent:         (p) => invoke('dialog_open_recent', { path: p }),
  saveFile:           (d) => invoke('dialog_save_file', { ...d }),
  saveFileAs:         (d) => invoke('dialog_save_file_as', { ...d }),
  confirmExit:        (name) => invoke('dialog_confirm_exit', { fileName: name }),
  getVersion:         () => invoke('app_get_version'),
  getRecent:          () => invoke('app_get_recent'),
  toggleDevTools:     () => invoke('view_toggle_devtools'),
  zoomIn:             () => invoke('view_zoom_in'),
  zoomOut:            () => invoke('view_zoom_out'),
  resetZoom:          () => invoke('view_reset_zoom'),
  toggleFullscreen:   () => invoke('view_toggle_fullscreen'),
  readClipboard:      () => invoke('edit_read_clipboard'),
  setTitle:           (t) => invoke('window_set_title', { title: t }),
  minimize:           () => invoke('win_minimize'),
  maximize:           () => invoke('win_maximize'),
  closeWindow:        () => invoke('win_close'),
  setDirty:           () => {},                 // WebView2 无 __dirty 上报必要时可省略或由后端状态替代
  quitApproved:       () => invoke('app_quit_approved'),
  quitCanceled:       () => invoke('app_quit_canceled'),
  onMenuCommand:      (cb) => { for (const [k,e] of [['new','menu:new'],['open','menu:open'],['save','menu:save'],['saveAs','menu:save_as']]) listen(e, ()=>cb(k)); listen('menu:open_recent', (x)=>cb('openRecent', x.payload)); listen('menu:check_unsaved', (x)=>cb('checkUnsaved', x.payload)); },
  onRecentUpdated:    (cb) => listen('recent_updated', (x)=>cb(x.payload)),
  onOpenFile:         (cb) => listen('app_open_file', (x)=>cb(x.payload)),
  onThemeCommand:     (cb) => listen('theme_set', (x)=>cb(x.payload)),
};
```

**改动点与不变点**
- **不变**：`app.js`/`styles.css`/`index.html` 的业务逻辑、多标签、双向跳转、查找替换、渲染管线、视图开关全部照搬。
- **变**：`index.html` 引入方式（Tauri 通过 `build.beforeDevCommand` 或直接把 renderer 放入 `src-tauri` 资源），替换 preload 为 frontend-bridge；标题栏加 `data-tauri-drag-region`；菜单栏点击改为走新命令/事件。
- **CSP**：在 `main.rs` 用 `WindowBuilder` 动态设置 CSP，或页面 `<meta>` 适配 Tauri（去掉/调整 CDN 兜底即可，本地 vendor 加载无需外联）。
- **懒加载**：`mermaid`/`highlight.js` 的本地 vendor 路径在 Tauri 资源根下解析；CDN 兜底可移除（Tauri 打包资源走自身协议，`asset:`/相对路径优先）。

---

## 8. 分阶段实施计划

> 每阶段有明确验收，未通过不进入下一阶段（小步迭代、逐项自测）。

### 阶段 0 · 脚手架与最小可运行
- 用 `npm create tauri-app@latest`（或 `cargo create-tauri-app`）建 `md-editor-tauri`，选 vanilla JS 模板。
- 放入 `renderer/` 文件；`dev` 命令起窗口并加载 `index.html`。
- **验收**：窗口出现、中文正常渲染；`marked` 对一段含标题/列表/Mermaid 的测试文本能正确预览（Mermaid 可暂不渲染）。

### 阶段 1 · 后端能力迁移（每项一测）
按序实现并自测：编码探测与读写(6.4)→对话框(open/save/confirmExit)→最近文件(6.5)→命令参数与单实例(6.3)→窗口状态(6.5)→剪贴板→窗口/缩放/主题/关于。
- **验收**：用 PowerShell/手工逐项验证 6.1 每个命令返回与异常；编码读写用 UTF-8/GBK/UTF-16 + BOM 各建样例通过。

### 阶段 2 · 前端对接与特性整合
- 接入 `frontend-bridge.js`；打通多标签、打开/保存/最近、未保存确认全链路；移植 `F1–F13` 全部能力。
- **验收**：对照 §2.2 的 F1–F13 逐条走通；原生菜单快捷键（Ctrl+O/S/N、缩放、全屏、主题）可用。

### 阶段 3 · 打包与对照验收
- 配置 `tauri.conf.json` 打包为绿色单 exe；可选安装版（含文件关联）。
- **验收**：执行 §10 对照矩阵，全部达标后视为重构完成。

---

## 9. 打包与分发（绿色版 / 安装版）

- **绿色版**：`tauri build` 默认产出 `target/release/{productName}.exe`（+ 可含所有资源）→ 直接单文件分发（本质：自解压/Rust 静态，免安装、免运行时）。
- **文件关联 / 多实例**：绿色版如需双击 `.md` 打开，配合 `tauri-plugin-single-instance` + 注册表写入（可选）。更推荐用**安装版**统一做文件关联与右键"打开方式"。
- **安装版**：`tauri build --bundles nsis`（Tauri 自带 NSIS WebView2 bootstrap 选项）；`tauri.conf.json` 的 `bundle.fileAssociations=[]` 声明 `.md/.markdown/.mdown/.txt`。
- 独立绿色版天然**不写注册表/不装环境**；如需极老系统兜底 WebView2，安装版勾选 WebView2 bootstrapper（一次性引导，体积仍远小于 Electron）。

---

## 10. 验收与对照标准

> 同一台机器、同样的测试文件，分别跑 Electron 版与新 Tauri 版，填写对比表（新版本达标项标记 ✓）。

| 指标 | Electron 基线 | Tauri 目标 | 是否达标 |
|---|---|---|---|
| 安装包体积（64 位） | 96.6MB | **≤15MB** | |
| 解压后占用 | 315.4MB | **≤40MB** | |
| 冷启动到窗口可交互 | 1.5–2s | **≤1s** | |
| 二次启动 | ~1.5s | **≤0.8s** | |
| 运行内存峰值（空文档） | 200–300MB | **≤150MB** | |
| 满载预览（长文档+mermaid+高亮）卡顿 | 参照实测 | **明显优于或持平** | |

**功能验收**：§2.1 B1–B11 与 §2.2 F1–F13 逐项人工回归，全部通过。

---

## 11. 风险与注意事项

1. **渲染内核差异**（最高关注）：WebView2 的 Chromium 版本与 Electron 内置可能不同，`CSS` 细节、`font`、`::-webkit-*`、`mermaid` 渲染结果会有细微差异，需逐版比对渲染像素。
2. **编码库差异**：`encoding_rs` 的 GB18030 是 GBK 超集，读普通 GBK 文件无碍；UTF-16 字节序探测按原算法移植，边界用例需覆盖（空文件、极短文件、纯 ASCII）。
3. **无边框窗口拖拽**：原 Electron 用 `frame:false` + JS 控制；Tauri 需 `data-tauri-drag-region`，注意与按钮点击区域冲突时的 `user-select:none`/事件穿透处理。
4. **剪贴板粘贴**：WebView2 的安全限制同样存在，`execCommand('paste')` 需走后端 `clipboard-manager` 中转（已纳入 B13/6.1）。
5. **CSP/权限**：Tauri 需在 `capabilities` 显式授权 `core:window`、`core:event`、`dialog:default`、`clipboard:default`、`single-instance:default`，遗漏会静默失败——逐一对照 6.1 各命令运行时报错排查。
6. **懒加载路径**：`lazy-loader` 里 vendor 的相对路径在 Tauri 资源根下要正确；建议以资源根相对路径引用，去掉 CDN 兜底避免离线计数违规。
7. **菜单勾选态驱动**：Tauri 原生菜单的 `checked` 需在切换视图开关时反向 `set_checked`，与前端 `showMenu` 的勾选保持一致（双向）。
8. **迭代策略**：在独立仓库开发，不与 Electron 版同仓；效果不达标可整体弃用，原版零损失。

---

## 12. 环境准备命令清单

> 目标环境为 Windows + 已有的 WebView2 运行时（Win10/11 一般内置）。

```bash
# 1) 安装 Rust 工具链（含 MSVC linker 会提示安装 VS Build Tools C++）
winget install --id Rustlang.Rustup -e
#    若链接 MSVC 失败，装：
winget install --id Microsoft.VisualStudio.2022.BuildTools -e \
  --override "--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"

# 2) 校验
rustc -V && cargo -V

# 3) 安装 Tauri CLI（任选其一）
npm install -g @tauri-apps/cli        # 推荐（同时给前端工具链）
# 或  cargo install tauri-cli --locked

# 4) 创建独立项目（选 vanilla，可离线改）
npm create tauri-app@latest

# 5) 在 src-tauri/Cargo.toml 引入本指南 §6 依赖：
#    tauri = { version = "2", features = [] }
#    tauri-plugin-dialog = "2"
#    tauri-plugin-single-instance = "2"
#    tauri-plugin-window-state = "2"
#    tauri-plugin-clipboard-manager = "2"
#    encoding_rs = "0.8"

# 6) 开发运行
cargo tauri dev

# 7) 绿色版打包
cargo tauri build          # → target/release/
#    安装版（含 NSIS + WebView2 bootstrap）
cargo tauri build --bundles nsis
```

> 首次 `cargo build` 会拉取并编译全部依赖，耗时较长属正常；可 `npx tauri info` 检查环境健康度。

---

## 附：前端依赖版本参考
- marked ^18
- mermaid ^11（懒加载）
- highlight.js ^11（懒加载）

（均为纯前端库，无 Node 原生依赖，可直接复用现有 `renderer/vendor/` 文件。）