# MD编辑器 v1.0.0

本地 Markdown 编辑器桌面应用，分屏实时预览、Mermaid 流程图、代码高亮、查找替换、多编码支持、明暗主题。**完全本地运行，无需联网。**

## 快速开始

在 `dist` 目录下双击 **`MD编辑器-1.0.0.exe`** 即可使用，免安装、绿色便携。

### 开发运行

```bash
npm install          # 安装依赖（首次）
npm start            # 开发模式启动
npm run dist         # 重新打包为单文件 exe（产物在 dist/ 目录）
```

## 功能特性

| 功能 | 说明 |
|---|---|
| 基础编辑 | 仿 Windows 记事本：新建 / 打开 / 保存 / 另存为 / 最近打开，未保存关闭有确认提示 |
| Markdown 实时预览 | 分屏布局，左侧源码、右侧实时渲染，约 250ms 防抖自动刷新 |
| Mermaid 流程图 | ` ```mermaid ` 代码块自动渲染为 SVG 流程图，语法错误时显示源码与错误信息；3.4MB 引擎**首用懒加载**，不拖慢启动 |
| 代码语法高亮 | 非 Mermaid 代码块使用 highlight.js 高亮，**本地内置**，离线可用 |
| 查找替换 | Ctrl+F 查找（匹配计数、上/下一个、Enter/Shift+Enter 循环）、Ctrl+H 替换（单次替换 / 全部替换） |
| 明暗主题 | 标题栏一键切换，localStorage 持久化，Mermaid 主题联动 |
| 多编码支持 | UTF-8（含 BOM）/ GBK / UTF-16LE / UTF-16BE 自动检测与保存 |
| 快捷键 | Ctrl+F 查找、Ctrl+H 替换、Ctrl+S 保存、Ctrl+Shift+S 另存为、Ctrl+N 新建、Ctrl+O 打开、Ctrl+W 关闭窗口；Esc 关闭查找栏 |

## 版本信息

| 位置 | 值 |
|---|---|
| 可执行文件名 | `MD编辑器-1.0.0.exe` |
| 文件属性 FileVersion | 1.0.0 |
| 文件属性 ProductVersion | 1.0.0 |
| 应用窗口标题栏 | 未命名 - MD编辑器 v1.0.0 |

## 技术栈

- Electron 43.4.1（Chromium 150，Node 22）
- marked 18（Markdown 解析，44KB 同步内置）
- mermaid 11（流程图渲染，3.4MB 懒加载，内置 `renderer/vendor/`）
- highlight.js 11（语法高亮，126KB 懒加载，内置 `renderer/vendor/`）
- iconv-lite（多编码）
- electron-builder 26（单文件便携式打包，NSIS 压缩）

## 体积与启动优化

| 项目 | 优化前 | 优化后 |
|---|---|---|
| app.asar | 136MB | **4.2MB** |
| 单文件 exe | 103MB | **86.4MB** |
| 启动加载 | 同步加载 marked + mermaid + hljs | 仅同步加载 marked（44KB），mermaid / hljs 按需懒加载 |

优化手段：`build.files` 白名单只打包 `main.js` + `renderer/` + `iconv-lite`；运行期不用的第三方库全部移入 `devDependencies`（避免 electron-builder 全量收集依赖进 asar）；按需懒加载替代同步加载，**首屏不再加载 3.4MB 的 mermaid**。

## 离线打包说明

本项目打包已配置为**完全离线**（`electronDist` 指向本地解压的 `.electron-dist`），
构建过程不访问 GitHub。若在新机器上重新打包，需先手动从
`https://registry.npmmirror.com/-/binary/electron-builder-binaries/` 下载以下组件到
`%LOCALAPPDATA%\electron-builder\Cache\` 对应目录（否则构建会尝试联网）：

- `nsis-3.0.4.1/nsis-3.0.4.1.7z`
- `nsis-resources-3.4.1/nsis-resources-3.4.1.7z`
- `winCodeSign-2.6.0/winCodeSign-2.6.0.7z`

## 常见问题

### SmartScreen / 杀毒软件拦截

exe 未做代码签名（`signAndEditExecutable: false`，本地自用免签名证书开销），
Windows SmartScreen 或杀软首次运行可能提示"未知发布者"。
点击"更多信息 → 仍要运行"即可，或加入杀软信任区。

### 便携模式数据存放

Portable 模式运行时，应用临时解压到系统 Temp 目录；
文档本身保存在你打开/保存的路径，不产生应用内数据目录，卸载即删除临时文件，无残留。

## 目录结构

```
E:\md编辑器\
├── main.js                # Electron 主进程（窗口/文件对话框/编码读写/脏状态）
├── preload.js             # 预加载脚本（contextBridge 安全桥接）
├── renderer/
│   ├── index.html         # 渲染进程页面
│   ├── app.js             # 渲染逻辑（marked/mermaid/highlight 集成 + 查找替换）
│   ├── lazy-loader.js     # 按需懒加载器（本地 vendor → CDN 三级兜底）
│   ├── vendor/            # 内置静态资源：marked.umd.js / mermaid.min.js / highlight.min.js
│   └── styles.css         # 明暗双主题样式
├── dev.js                 # 开发启动器（规避宿主环境变量干扰）
├── dist/
│   └── MD编辑器-1.0.0.exe  # ★ 最终交付产物
└── package.json
```

## 许可

MIT © hanwu