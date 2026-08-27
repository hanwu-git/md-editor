# MD编辑器 v4.0.0

本地 Markdown 编辑器桌面应用，分屏实时预览、Mermaid 流程图、代码高亮、查找替换、多编码支持、明暗主题、视图开关、多标签页、双向跳转。**完全本地运行，无需联网。**

## 快速开始

在 `dist` 目录下双击 **`MD编辑器.exe`** 即可使用，免安装、绿色便携。

> 首次启动需一次性解压（约 25~40s），之后每次启动约 **1~2 秒**（自缓存启动器，详见下文"启动性能优化"）。

### 开发运行

```bash
npm install          # 安装依赖（首次）
npm start            # 开发模式启动
npm run dist         # 重新打包为单文件 exe（产物在 dist/ 目录）
```

## 功能特性

| 功能 | 说明 |
|---|---|
| 基础编辑 | 仿 Windows 记事本：新建 / 打开 / 保存 / 另存为 / 最近打开（持久化，跨会话保留），未保存关闭有确认提示；**支持右键“打开方式”打开 .md/.txt 文件** |
| 多标签页 | 多个文档多标签切换，每标签独立内容/编码/未保存状态；打开同一路径自动去重；Ctrl+W 关闭当前标签（仅剩一个时关窗口） |
| Markdown 实时预览 | 分屏布局，左侧源码、右侧实时渲染，约 250ms 防抖自动刷新 |
| 双向跳转 | 预览区**双击任意元素** → 左栏源码跳转到对应行并高亮；左侧光标移动 → 预览区同步高亮对应块 |
| 视图开关 | 视图菜单可开关**右侧预览窗口**（关闭时编辑区占满全宽）；可开关**双栏同步滚动**（按比例双向同步），状态 localStorage 持久化 |
| Mermaid 流程图 | ` ```mermaid ` 代码块自动渲染为 SVG 流程图，语法错误时显示源码与错误信息；3.4MB 引擎**首用懒加载**，不拖慢启动 |
| 代码语法高亮 | 非 Mermaid 代码块使用 highlight.js 高亮，**本地内置**，离线可用 |
| 查找替换 | Ctrl+F 查找（匹配计数、上/下一个、Enter/Shift+Enter 循环、**区分大小写开关**）、Ctrl+H 替换（单次替换 / 全部替换） |
| 明暗主题 | 标题栏一键切换，localStorage 持久化，Mermaid 主题联动 |
| 多编码支持 | UTF-8（含 BOM）/ GBK / UTF-16LE / UTF-16BE 自动检测；**状态栏点击编码可弹出菜单转码另存**；保存时保留原 BOM |
| 窗口体验 | 窗口尺寸/位置/最大化状态记忆；视图菜单支持缩放（Ctrl+0/+/−）、全屏（F11）、开发者工具（Ctrl+Shift+I） |
| 快捷键 | Ctrl+F 查找、Ctrl+H 替换、Ctrl+S 保存、Ctrl+Shift+S 另存为、Ctrl+N 新建、Ctrl+O 打开、Ctrl+W 关闭窗口；Esc 关闭查找栏 |

## 版本信息

| 位置 | 值 |
|---|---|
| 可执行文件名 | `MD编辑器.exe`（文件名不含版本号） |
| 文件属性 FileVersion / ProductVersion | 4.0.0 |
| 应用窗口标题栏 | 未命名 - MD编辑器 v4.0.0 |
| 缓存目录名 | `%LOCALAPPDATA%\MD编辑器\app-4.0.0-64` |

### 版本号规则

每次更新必改版本号：大更新 → 首位（major）；修复超过 3 个问题 → 中间位（minor）；其他 → 末尾位（patch）。详见提交历史中各版本的说明。

## 版本历史

| 版本 | 要点 |
|---|---|
| 1.0.0 | 初始版本（源码自 app.asar 提取恢复） |
| 1.1.0 | 落地 9 项未完成功能：首次保存不落盘修复、BOM 保留、最近文件持久化、视图菜单 5 项、编码选择器转码、查找区分大小写、粘贴修复、窗口状态记忆、死代码清理 |
| 1.1.1 | 启动性能优化：自缓存单文件启动器（日常启动 25.6s → ~1.7s）+ 放开 GPU 硬件加速 |
| 1.1.2 | 启动器缓存三重校验（版本错配/损坏/半截解压自动重建）+ 视图菜单新增预览开关、同步滚动开关 |
| 1.1.3 | 支持右键“打开方式”打开 .md/.txt 文件（命令行传参打开）；Windows 单实例锁：应用已运行时再次打开文件会聚焦原窗口并载入新文件 |
| 2.0.x | 多标签页（tab 独立内容/编码/未保存状态、同路径去重、Ctrl+W 关闭、关闭窗口批量确认脏 tab）；自动折行开关；欢迎页作初始页随打开内容自动关闭 |
| 3.0.0 | 双架构打包：同时产出 64 位与 32 位绿色版+安装版安装包 |
| 4.0.0 | 双向精确跳转：预览区双击元素 → 左栏源码对应行聚焦高亮；左栏光标移动 → 预览对应块高亮；修复安装版卸载 nsProcess 进程结束（Unicode 插件）；帮助/关于文案补充新功能；全量重新打包 |

## 技术栈

- Electron 43.4.1（Chromium 150，Node 22）
- marked 18（Markdown 解析，44KB 同步内置）
- mermaid 11（流程图渲染，3.4MB 懒加载，内置 `renderer/vendor/`）
- highlight.js 11（语法高亮，126KB 懒加载，内置 `renderer/vendor/`）
- iconv-lite（多编码）
- electron-builder 26（`--win dir` 产出目录）+ NSIS makensis（自研自缓存单文件启动器）

## 体积与启动优化

| 项目 | 优化前 | 优化后 |
|---|---|---|
| app.asar | 136MB | **4.0MB** |
| 单文件 exe | 103MB | **104.5MB**（内含完整 Electron 运行时） |
| 启动加载 | 同步加载 marked + mermaid + hljs | 仅同步加载 marked（44KB），mermaid / hljs 按需懒加载 |
| **日常启动耗时** | **~25.6s**（官方 portable 每次全量重解压） | **~1.1-1.7s**（自缓存启动器） |

优化手段：`build.files` 白名单只打包 `main.js` + `renderer/` + `iconv-lite`；运行期不用的第三方库全部移入 `devDependencies`；按需懒加载替代同步加载，**首屏不再加载 3.4MB 的 mermaid**。

## 启动性能优化（自缓存单文件启动器）

**问题**：electron-builder 官方 portable 单文件每次启动都要把 361MB 内容全量解压到临时目录（约 25 秒），且退出即删、无缓存机制。

**方案**：自研 NSIS 启动器（`build/launcher.nsi`）：

```
双击 MD编辑器.exe
 ├─ 三重校验缓存目录 %LOCALAPPDATA%\MD编辑器\app-<版本>
 │    ① 主程序存在  ② app.asar 存在  ③ 版本标记 .cache-ok-<版本> 存在
 ├─ 全部通过 → 跳过解压直接启动（~1.5s）
 └─ 任一失败（首次/升级/解压中断/缓存损坏/版本错配）
      → 清理全部旧缓存 → 按当前版本重新解压 → 启动
```

- 版本标记在解压**完成后最后创建**（原子性）：解压被中断的半截缓存不会带标记，下次启动自动重建，杜绝缓存问题导致程序运行失败
- 版本升级时自动清理所有 `app-*` 旧缓存目录，收敛到当前版本
- 命令行参数透传，退出码回传（与官方 portable 语义一致）

完整分析、实测数据与 NSIS 踩坑记录见 **[docs/启动优化与缓存校验技术方案.md](docs/启动优化与缓存校验技术方案.md)**。

## 离线打包说明

本项目打包已配置为**完全离线**（`electronDist` 指向本地解压的 `.electron-dist`），
构建过程不访问 GitHub。若在新机器上重新打包，需先手动从
`https://registry.npmmirror.com/-/binary/electron-builder-binaries/` 下载以下组件到
`%LOCALAPPDATA%\electron-builder\Cache\` 对应目录（否则构建会尝试联网）：

- `nsis-3.0.4.1/nsis-3.0.4.1.7z`
- `nsis-resources-3.4.1/nsis-resources-3.4.1.7z`
- `winCodeSign-2.6.0/winCodeSign-2.6.0.7z`

`npm run dist` = `electron-builder --win dir`（产出 `dist\win-unpacked`）+ `node scripts/build-launcher.js`（makensis 编译启动器，复用上述 NSIS 缓存，无需额外安装）。

## 常见问题

### SmartScreen / 杀毒软件拦截

exe 未做代码签名（`signAndEditExecutable: false`，本地自用免签名证书开销），
Windows SmartScreen 或杀软首次运行可能提示"未知发布者"。
点击"更多信息 → 仍要运行"即可，或加入杀软信任区。

### 数据存放位置

| 数据 | 位置 |
|---|---|
| 文档本身 | 你打开/保存的路径 |
| 最近文件列表、窗口状态 | `%APPDATA%\MD编辑器\`（recent-files.json、window-state.json） |
| 主题/视图偏好（预览开关、同步滚动） | 应用 localStorage |
| 程序运行时缓存（自解压） | `%LOCALAPPDATA%\MD编辑器\app-<版本>\` |

卸载/清理：删除 exe 与上述两个目录即完全清除，无残留、无注册表项。

## 目录结构

```
md编辑器\
├── main.js                # Electron 主进程（窗口/文件对话框/编码读写/脏状态/最近文件）
├── preload.js             # 预加载脚本（contextBridge 安全桥接）
├── renderer/
│   ├── index.html         # 渲染进程页面
│   ├── app.js             # 渲染逻辑（渲染管线/查找替换/视图开关/编码选择器）
│   ├── lazy-loader.js     # 按需懒加载器（本地 vendor → CDN 三级兜底）
│   ├── vendor/            # 内置静态资源：marked.umd.js / mermaid.min.js / highlight.min.js
│   └── styles.css         # 明暗双主题样式
├── build/
│   ├── icon.ico           # 应用图标
│   └── launcher.nsi       # ★ 自缓存单文件启动器（NSIS 脚本）
├── scripts/
│   └── build-launcher.js  # 启动器编译脚本（读版本号 → 调 makensis）
├── docs/
│   └── 启动优化与缓存校验技术方案.md   # 技术文档
├── dev.js                 # 开发启动器（规避宿主环境变量干扰）
├── dist/
│   ├── MD编辑器.exe       # ★ 最终交付产物（单文件）
│   └── win-unpacked\      # 解压版（electron-builder 中间产物）
└── package.json
```

## 许可

MIT © hanwu
