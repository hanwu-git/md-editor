# MD编辑器 v6.0.1

本地 Markdown 编辑器桌面应用，分屏实时预览、Mermaid 流程图、代码高亮、查找替换、多编码支持、明暗主题、视图开关、多标签页、双向跳转、外链系统浏览器打开。**完全本地运行，无需联网。**

> 基于 **Tauri 2** 重构（v5.0.0 起），替代原 Electron 方案，体积更小、启动更快。

## 快速开始

### 使用已编译的程序

在 `src-tauri/target/debug/` 下双击 **`md-editor.exe`** 即可运行（debug 版）。

正式构建产物（NSIS 安装包）位于 `src-tauri/target/release/bundle/nsis/`。

> 运行需 WebView2 Runtime（Win10/11 通常已自带）。

### 开发运行

```bash
npm install              # 安装前端依赖（首次）
npm run dev              # 开发调试模式
npm run build            # 正式构建（生成 exe + NSIS 安装包）
npm run build:nsis       # 仅生成 NSIS 安装包
```

> Rust 工具链需预先安装：`rustup default stable`。详见 [docs/github-push-setup.md](docs/github-push-setup.md) 第 1A 节。

## 功能特性

| 功能 | 说明 |
|---|---|
| 基础编辑 | 新建 / 打开 / 保存 / 另存为 / 最近打开（持久化，跨会话保留）；支持 `.md`/`.txt` 文件关联打开 |
| 多标签页 | 多文档多标签切换，每标签独立内容/编码/未保存状态；打开同路径自动去重；Ctrl+W 关闭当前标签 |
| Markdown 实时预览 | 分屏布局，左侧源码、右侧实时渲染，约 250ms 防抖自动刷新 |
| 双向跳转 | 预览区**双击任意元素** → 左栏源码跳转到对应行并高亮；左侧光标移动 → 预览区同步高亮对应块 |
| 视图开关 | 可开关右侧预览窗口（关闭时编辑区占满全宽）；可开关双栏同步滚动 |
| Mermaid 流程图 | ` ```mermaid ` 代码块自动渲染为 SVG 流程图，语法错误时显示源码与错误信息；引擎懒加载 |
| 代码语法高亮 | 非 Mermaid 代码块使用 highlight.js 高亮，本地内置，离线可用 |
| 查找替换 | Ctrl+F 查找（匹配计数、上/下一个、区分大小写开关）、Ctrl+H 替换（单次/全部替换） |
| 明暗主题 | 标题栏一键切换，localStorage 持久化，Mermaid 主题联动 |
| 多编码支持 | UTF-8（含 BOM）/ GBK / UTF-16LE / UTF-16BE 自动检测；状态栏点击编码可转码另存 |
| **外链系统浏览器打开** | 预览区点击 `http(s)` 链接时，通过系统默认浏览器打开，不在应用内导航（v6.0.1 修复） |
| 单实例锁 | 应用已运行时再次打开文件，自动聚焦原窗口并载入新文件（命令行参数转发） |
| 窗口体验 | 自定义无边框标题栏，可拖拽移动；窗口尺寸/位置/最大化状态记忆 |
| 快捷键 | Ctrl+F 查找、Ctrl+H 替换、Ctrl+S 保存、Ctrl+Shift+S 另存为、Ctrl+N 新建、Ctrl+O 打开、Ctrl+W 关闭标签 |

## 版本信息

| 位置 | 值 |
|---|---|
| 可执行文件名 | `md-editor.exe` |
| 应用标识 | `com.hanwu.mdeditor` |
| 应用窗口标题栏 | `未命名 - MD编辑器 v6.0.1` |
| 版本号（4 处需同步） | `package.json` / `src-tauri/Cargo.toml` / `src-tauri/tauri.conf.json` / `Cargo.lock` |

### 版本号规则

每次更新必改版本号：大更新 → 首位（major）；修复超过 3 个问题 → 中间位（minor）；其他 → 末尾位（patch）。

## 版本历史

| 版本 | 要点 |
|---|---|
| 1.0.0 | 初始版本（源码自 app.asar 提取恢复） |
| 1.1.0 | 落地 9 项未完成功能：首次保存不落盘修复、BOM 保留、最近文件持久化、视图菜单 5 项、编码选择器转码、查找区分大小写、粘贴修复、窗口状态记忆、死代码清理 |
| 1.1.1 | 启动性能优化：自缓存单文件启动器（日常启动 25.6s → ~1.7s）+ 放开 GPU 硬件加速 |
| 1.1.2 | 启动器缓存三重校验（版本错配/损坏/半截解压自动重建）+ 视图菜单新增预览开关、同步滚动开关 |
| 1.1.3 | 支持右键"打开方式"打开 .md/.txt 文件（命令行传参打开）；Windows 单实例锁：应用已运行时再次打开文件会聚焦原窗口并载入新文件 |
| 2.0.x | 多标签页（tab 独立内容/编码/未保存状态、同路径去重、Ctrl+W 关闭、关闭窗口批量确认脏 tab）；自动折行开关；欢迎页作初始页随打开内容自动关闭 |
| 3.0.0 | 双架构打包：同时产出 64 位与 32 位绿色版+安装版安装包 |
| 4.0.0 | 双向精确跳转：预览区双击元素 → 左栏源码对应行聚焦高亮；左栏光标移动 → 预览对应块高亮；修复安装版卸载 nsProcess 进程结束（Unicode 插件）；帮助/关于文案补充新功能；全量重新打包 |
| 5.0.0 | **Tauri 2 重构**：从 Electron 迁移至 Tauri 2 + Rust 后端 + WebView2 渲染；自定义无边框标题栏；单实例锁迁移至 tauri-plugin-single-instance；窗口状态记忆迁移至 tauri-plugin-window-state；保留全部编辑/预览/查找/编码功能 |
| 6.0.1 | **修复外链打开问题**：预览区 `http(s)` 链接点击后不再在 WebView 内导航，改为通过 `tauri-plugin-opener` 调用系统默认浏览器打开；前端事件委托拦截 `<a>` 标签点击，后端 `open_external` 命令校验协议后调 opener 插件 |

## v6.0.1 外链修复详情

**问题**：点击预览区中的外部链接（如 `https://example.com`），WebView2 在应用内直接导航，导致编辑器界面被替换为链接内容，用户无法返回。

**根因**：前端未拦截 `<a>` 标签默认行为，Tauri 默认允许 WebView 导航。

**修复方案**（三层联动）：

1. **前端拦截**（[renderer/app.js](renderer/app.js)）：事件委托监听 `click` 事件，检测 `<a[href]>` 且 `href` 匹配 `http(s)://`，调用 `e.preventDefault()` 阻止默认导航，转调 `mdAPI.openExternal(href)`。
2. **桥接层**（[renderer/frontend-bridge.js](renderer/frontend-bridge.js)）：`openExternal` 方法调用 Tauri 后端 `open_external` 命令。
3. **后端命令**（[src-tauri/src/commands.rs](src-tauri/src/commands.rs)）：`open_external` 命令校验 URL 协议为 `http`/`https`，通过 `tauri-plugin-opener` 调用系统默认浏览器打开。

**验证结果**（自动化测试通过）：
- 预览区点击链接 → 系统默认浏览器（本机为夸克）新增对应标签页
- 应用内 WebView 地址保持 `tauri.localhost` 不变，界面未被替换

## 技术栈

- **Tauri 2**（Rust 后端 + WebView2 渲染，替代 Electron）
- marked 18（Markdown 解析，内置）
- mermaid 11（流程图渲染，懒加载，内置 `renderer/vendor/`）
- highlight.js 11（语法高亮，懒加载，内置 `renderer/vendor/`）
- encoding_rs（多编码读写，Rust 原生）
- NSIS（安装包打包，Tauri 内置 bundle）

### Tauri 插件

| 插件 | 用途 |
|---|---|
| tauri-plugin-dialog | 文件打开/保存对话框 |
| tauri-plugin-single-instance | 单实例锁 + 命令行参数转发 |
| tauri-plugin-window-state | 窗口位置/大小记忆 |
| tauri-plugin-clipboard-manager | 剪贴板操作 |
| tauri-plugin-opener | 通过系统默认浏览器打开外链（v6.0.1 新增） |

## 目录结构

```
md-editor/
├── renderer/              # 前端（HTML/CSS/JS，无框架）
│   ├── index.html         # 主页面
│   ├── app.js             # 应用主逻辑（编辑/预览/查找/外链拦截）
│   ├── frontend-bridge.js # 前后端桥接（Tauri invoke 封装）
│   ├── styles.css         # 明暗双主题样式
│   ├── lazy-loader.js     # 按需懒加载器
│   └── vendor/            # 内置第三方库（marked / mermaid / highlight）
├── src-tauri/             # Rust 后端
│   ├── src/
│   │   ├── main.rs        # 入口
│   │   ├── lib.rs         # 插件注册、窗口管理、单实例处理
│   │   ├── commands.rs    # Tauri 命令（文件IO、外链打开等）
│   │   ├── fs_io.rs       # 文件读写、编码处理
│   │   └── recent.rs      # 最近文件记录
│   ├── Cargo.toml         # Rust 依赖与版本号
│   ├── Cargo.lock         # 依赖锁定（需提交）
│   ├── tauri.conf.json    # Tauri 配置（窗口/图标/安装包/文件关联）
│   ├── build.rs           # 构建脚本
│   ├── bundle/            # NSIS 安装包自定义配置
│   └── icons/             # 应用图标（多尺寸）
├── build/                 # 安装包构建资源
│   ├── installer.nsi      # NSIS 安装脚本
│   ├── launcher.nsi       # 启动器脚本
│   └── plugins/nsProcess.dll
├── scripts/               # 构建辅助脚本
├── docs/                  # 文档
│   ├── github-push-setup.md           # GitHub 推送配置说明
│   ├── TAURI重构开发指南.md           # Tauri 重构开发指南
│   └── 启动优化与缓存校验技术方案.md   # 启动优化技术方案
├── .gitignore
├── package.json
├── main.js                # Electron 旧版入口（保留兼容）
├── preload.js             # Electron 旧版预加载（保留兼容）
└── dev.js                 # 开发辅助
```

## 构建说明

### 前提条件

- **Rust 工具链**：`rustup default stable`（推荐 MSVC 工具链 `stable-x86_64-pc-windows-msvc`）
- **Node.js**：用于安装 `@tauri-apps/cli`
- **WebView2 Runtime**：运行时依赖（Win10/11 通常已自带）

### 构建命令

```bash
npm install              # 安装前端依赖
npm run build            # 生成 release exe + NSIS 安装包
npm run build:nsis       # 仅生成 NSIS 安装包
```

构建产物：
- `src-tauri/target/release/md-editor.exe`（可执行文件）
- `src-tauri/target/release/bundle/nsis/`（NSIS 安装包）

> **已知限制**：若项目目录含中文路径，GNU ld 链接器可能失败。解决方案：将源码拷贝到纯 ASCII 路径下构建，或使用 MSVC 工具链。

## 常见问题

### SmartScreen / 杀毒软件拦截

exe 未做代码签名，Windows SmartScreen 或杀软首次运行可能提示"未知发布者"。
点击"更多信息 → 仍要运行"即可，或加入杀软信任区。

### 数据存放位置

| 数据 | 位置 |
|---|---|
| 文档本身 | 你打开/保存的路径 |
| 最近文件列表、窗口状态 | `%APPDATA%\com.hanwu.mdeditor\` |
| 主题/视图偏好 | 应用 localStorage |

### 外链打开没反应

确认 `tauri-plugin-opener` 已在 `Cargo.toml` 和 `lib.rs` 中注册（v6.0.1 已内置）。

## 许可

MIT © hanwu
