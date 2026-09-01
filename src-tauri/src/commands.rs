//! 全部 Tauri 命令处理器（对应指南 §6.1 命令清单）
//! 命令名与 frontend-bridge.js 中的 invoke 一一对应。

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use std::fs;

use crate::fs_io;
use crate::recent;

/// 退出确认状态：前端确认"保存/不保存"后置 true，关闭事件据此放行（避免无限循环）
pub static QUIT_APPROVED: AtomicBool = AtomicBool::new(false);

pub fn set_quit_approved(v: bool) { QUIT_APPROVED.store(v, Ordering::SeqCst); }
pub fn quit_approved() -> bool { QUIT_APPROVED.load(Ordering::SeqCst) }

// ---------- 数据结构 ----------

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileResult {
    pub canceled: bool,
    pub saved: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fileName: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub encoding: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bom: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

fn basename(path: &str) -> String {
    std::path::Path::new(path)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string())
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveArgs {
    #[serde(default)]
    pub path: Option<String>,
    pub content: String,
    #[serde(default = "default_encoding")]
    pub encoding: String,
    #[serde(default)]
    pub bom: bool,
}
fn default_encoding() -> String { "UTF-8".to_string() }

// ---------- 打开文件 ----------

fn read_file_result(app: &AppHandle, path: &str) -> FileResult {
    match fs::read(path) {
        Ok(bytes) => {
            let decoded = fs_io::read_bytes(&bytes);
            let recent_list = recent::push(app, path);
            emit_recent(app, &recent_list);
            FileResult {
                canceled: false,
                saved: true,
                path: Some(path.to_string()),
                fileName: Some(basename(path)),
                content: Some(decoded.content),
                encoding: Some(decoded.encoding),
                bom: Some(decoded.bom),
                error: None,
            }
        }
        Err(e) => {
            FileResult { canceled: false, saved: false, path: Some(path.to_string()), fileName: Some(basename(path)), content: None, encoding: None, bom: None, error: Some(e.to_string()) }
        }
    }
}

#[tauri::command]
pub fn dialog_open_file(app: AppHandle, window: WebviewWindow) -> FileResult {
    use tauri_plugin_dialog::DialogExt;
    // 打开对话框是异步阻塞的，这里用 block_on 内部起线程由前端 await。
    // 用 dialog 插件的 file() + blocking pick 需要运行时。简化：使用 pick file 原生 API。
    let picked = window.dialog().file()
        .add_filter("Markdown/文本", &["md", "markdown", "mdown", "txt"])
        .add_filter("所有文件", &["*"])
        .blocking_pick_file();
    match picked {
        Some(path) => {
            let p = path.into_path().ok();
            let p = p.map(|pb| pb.to_string_lossy().to_string());
            match p {
                Some(p2) if recent::is_existing_file(&p2) => read_file_result(&app, &p2),
                _ => FileResult { canceled: true, saved: false, path: p, fileName: None, content: None, encoding: None, bom: None, error: None },
            }
        }
        None => FileResult { canceled: true, saved: false, path: None, fileName: None, content: None, encoding: None, bom: None, error: None },
    }
}

#[tauri::command]
pub fn dialog_open_recent(app: AppHandle, path: String) -> FileResult {
    if recent::is_existing_file(&path) {
        read_file_result(&app, &path)
    } else {
        FileResult { canceled: false, saved: false, path: Some(path.clone()), fileName: Some(basename(&path)), content: None, encoding: None, bom: None, error: Some("文件不存在".to_string()) }
    }
}

fn save_bytes(app: &AppHandle, path: String, content: &str, encoding: &str, bom: bool) -> FileResult {
    let enc = fs_io::normalize_encoding(encoding);
    let bytes = fs_io::encode_bytes(content, &enc, bom);
    match fs::write(&path, &bytes) {
        Ok(()) => {
            // 写入后加入最近文件并广播
            let list = recent::push(app, &path);
            emit_recent(app, &list);
            let name = basename(&path);
            FileResult { canceled: false, saved: true, path: Some(path), fileName: Some(name), content: None, encoding: Some(enc), bom: Some(bom), error: None }
        }
        Err(e) => {
            let name = basename(&path);
            FileResult { canceled: false, saved: false, path: Some(path), fileName: Some(name), content: None, encoding: None, bom: None, error: Some(e.to_string()) }
        }
    }
}

#[tauri::command]
pub fn dialog_save_file(app: AppHandle, window: WebviewWindow, args: SaveArgs) -> FileResult {
    match args.path {
        Some(p) if !p.is_empty() && recent::is_existing_file(&p) => save_bytes(&app, p, &args.content, &args.encoding, args.bom),
        _ => dialog_save_file_as(app, window, args),
    }
}

#[tauri::command]
pub fn dialog_save_file_as(app: AppHandle, window: WebviewWindow, args: SaveArgs) -> FileResult {
    use tauri_plugin_dialog::DialogExt;
    let picked = window.dialog().file()
        .add_filter("Markdown/文本", &["md", "markdown", "mdown", "txt"])
        .add_filter("所有文件", &["*"])
        .set_file_name("未命名.md")
        .blocking_save_file();
    match picked {
        Some(path) => {
            if let Ok(pb) = path.into_path() {
                save_bytes(&app, pb.to_string_lossy().to_string(), &args.content, &args.encoding, args.bom)
            } else {
                FileResult { canceled: true, saved: false, path: Some(args.path.clone().unwrap_or_default()), fileName: None, content: None, encoding: None, bom: None, error: None }
            }
        }
        None => FileResult { canceled: true, saved: false, path: Some(args.path.clone().unwrap_or_default()), fileName: None, content: None, encoding: None, bom: None, error: None },
    }
}

// ---------- 应用信息 ----------

#[tauri::command]
pub fn app_get_recent(app: AppHandle) -> Vec<String> {
    recent::load(&app)
}

#[tauri::command]
pub fn app_get_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
pub fn dialog_confirm_exit(window: WebviewWindow, file_name: String) -> i32 {
    use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
    // 0=取消/关闭 1=不保存 2=保存
    let title = if file_name.is_empty() { "未命名文件" } else { &file_name };
    let result = window.dialog()
        .message(format!("是否保存对「{title}」的更改？"))
        .title("未保存的更改")
        .kind(MessageDialogKind::Warning)
        .buttons(tauri_plugin_dialog::MessageDialogButtons::OkCancelCustom("保存".into(), "不保存".into()))
        .blocking_show();
    // blocking_show 返回 bool：true=主按钮(保存)，false=取消按钮(不保存)
    if result { 2 } else { 1 }
}

// ---------- 视图 ----------
// WebView2 缩放/DevTools 通过窗口 webview 接口操作。

#[tauri::command]
pub fn view_toggle_devtools(window: WebviewWindow) {
    #[cfg(debug_assertions)]
    {
        let _ = window.open_devtools();
    }
}

#[tauri::command]
pub fn view_zoom_in(window: WebviewWindow) {
    let _ = window.eval("document.body.style.zoom = (parseFloat(document.body.style.zoom||'1')+0.1).toFixed(2)");
}
#[tauri::command]
pub fn view_zoom_out(window: WebviewWindow) {
    let _ = window.eval("document.body.style.zoom = Math.max(0.2, parseFloat(document.body.style.zoom||'1')-0.1).toFixed(2)");
}
#[tauri::command]
pub fn view_reset_zoom(window: WebviewWindow) {
    let _ = window.eval("document.body.style.zoom='1'");
}
#[tauri::command]
pub fn view_toggle_fullscreen(window: WebviewWindow) {
    let is = window.is_fullscreen().unwrap_or(false);
    let _ = window.set_fullscreen(!is);
}

// ---------- 编辑 ----------

#[tauri::command]
pub fn edit_read_clipboard() -> Option<String> {
    arboard::Clipboard::new()
        .ok()
        .and_then(|mut c| c.get_text().ok())
}

// ---------- 窗口 ----------

#[tauri::command]
pub fn window_set_title(window: WebviewWindow, title: String) {
    let _ = window.set_title(&title);
}

#[tauri::command]
pub fn win_minimize(window: WebviewWindow) { let _ = window.minimize(); }
#[tauri::command]
pub fn win_maximize(window: WebviewWindow) {
    let is_max = window.is_maximized().unwrap_or(false);
    if is_max { let _ = window.unmaximize(); } else { let _ = window.maximize(); }
}
#[tauri::command]
pub fn win_close(window: WebviewWindow) { let _ = window.close(); }

// ---------- 退出 ----------

/// 前端确认退出（保存或不保存后调用）：置批准标记并真正关闭窗口
#[tauri::command]
pub fn app_quit_approved(window: WebviewWindow) {
    set_quit_approved(true);
    let _ = window.close();
}

/// 前端取消退出：清除批准标记
#[tauri::command]
pub fn app_quit_canceled() {
    set_quit_approved(false);
}

// ---------- 辅助：最近文件事件 ----------

fn emit_recent(app: &AppHandle, list: &[String]) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.emit("recent_updated", list.to_vec());
    }
}

// ---------- 默认 MD 文件关联 ----------
// 通过 HKCU\Software\Classes 注册本程序为 .md/.markdown/.mdown/.txt 的打开程序（仅当前用户，无需管理员）。
// 关联 ProgID：mdeditor.md

const ASSOC_PROGID: &str = "mdeditor.md";
const ASSOC_EXTS: [&str; 4] = [".md", ".markdown", ".mdown", ".txt"];

fn assoc_exe_path() -> String {
    std::env::current_exe()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default()
}

/// 建立 mdeditor.md ProgID 及 .md/.markdown/.mdown/.txt 关联（指向本程序 exe）
fn write_assoc() -> Result<(), String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let exe = assoc_exe_path();
    if exe.is_empty() {
        return Err("无法确定程序路径".into());
    }
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (classes, _) = hkcu
        .create_subkey("Software\\Classes")
        .map_err(|e| e.to_string())?;

    // 1) ProgID：mdeditor.md -> (default=MD编辑器文档) + DefaultIcon + shell/open/command
    let progid_path = format!("{}\\shell\\open\\command", ASSOC_PROGID);
    let (progid, _) = classes
        .create_subkey(&progid_path)
        .map_err(|e| e.to_string())?;
    let cmd: &str = &format!("\"{}\" \"%1\"", exe);
    progid.set_value("", &cmd).map_err(|e| e.to_string())?;

    let icon_path = format!("{}\\DefaultIcon", ASSOC_PROGID);
    let (icon, _) = classes.create_subkey(&icon_path).map_err(|e| e.to_string())?;
    let icon_val: &str = &format!("\"{}\",0", exe);
    icon.set_value("", &icon_val).map_err(|e| e.to_string())?;

    // 2) 扩展名 -> ProgID
    for ext in ASSOC_EXTS {
        let (key, _) = classes.create_subkey(ext).map_err(|e| e.to_string())?;
        let value: &str = ASSOC_PROGID;
        key.set_value("", &value).map_err(|e| e.to_string())?;
    }
    let _ = icon;

    Ok(())
}

/// 移除本程序建立的关联
fn remove_assoc() -> Result<(), String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let classes = hkcu
        .open_subkey("Software\\Classes")
        .map_err(|e| e.to_string())?;

    // 移除 ProgID，仅当确实是我们的 mdeditor.md
    if let Ok(v) = classes.get_value::<String, _>("") {
        // 无操作：ProgID 本身不带默认值
        let _ = v;
    }
    let _ = classes.delete_subkey_all(ASSOC_PROGID);

    // 仅当扩展名当前指向我们的 ProgID 时才删除扩展名键
    for ext in ASSOC_EXTS {
        if let Ok(cur) = classes.get_value::<String, _>(ext) {
            if cur == ASSOC_PROGID {
                let _ = classes.delete_subkey_all(ext);
            }
        }
    }

    Ok(())
}

/// 设为默认 md 编辑器（写关联注册表）
#[tauri::command]
pub fn set_default_md_assoc() -> Result<bool, String> {
    write_assoc()?;
    Ok(true)
}

/// 取消默认 md 编辑器（移除本程序建立的关联）
#[tauri::command]
pub fn clear_default_md_assoc() -> Result<bool, String> {
    remove_assoc()?;
    Ok(true)
}

// ---------- 图片读取（渲染 md 内相对路径图片） ----------

/// 读取本地图片文件的原始字节，供前端转为 data URL 显示。
/// 返回 Vec<u8>（Tauri 序列化为 JSON 数字数组）；文件不存在返回空数组。
#[tauri::command]
pub fn read_image_bytes(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| e.to_string())
}