mod commands;
mod fs_io;
mod recent;

use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};

const APP_NAME: &str = "MD编辑器";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // 二次启动：解析命令行传参文件路径 → 聚焦已有窗口并转发打开
            if let Some(file) = extract_file_path(&args) {
                if let Some(win) = app.get_webview_window("main") {
                    if win.is_minimized().unwrap_or(false) {
                        let _ = win.unminimize();
                    }
                    let _ = win.set_focus();
                }
                let _ = app.emit("app_open_file", file);
            } else if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            commands::dialog_open_file,
            commands::dialog_open_recent,
            commands::dialog_save_file,
            commands::dialog_save_file_as,
            commands::app_get_recent,
            commands::app_get_version,
            commands::dialog_confirm_exit,
            commands::view_toggle_devtools,
            commands::view_zoom_in,
            commands::view_zoom_out,
            commands::view_reset_zoom,
            commands::view_toggle_fullscreen,
            commands::edit_read_clipboard,
            commands::window_set_title,
            commands::win_minimize,
            commands::win_maximize,
            commands::win_close,
            commands::app_quit_approved,
            commands::app_quit_canceled,
            commands::set_default_md_assoc,
            commands::clear_default_md_assoc,
            commands::read_image_bytes,
        ])
        .setup(move |app| {
            setup_window_menu(app.handle())?;
            command_line_open(app.handle());
            Ok(())
        })
        .on_window_event(|window, event| {
            // 关闭拦截：首次征求前端批量确认未保存；已批准后放行
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if commands::quit_approved() {
                    return; // 已确认退出，放行
                }
                api.prevent_close();
                let _ = window.emit("menu:check_unsaved", serde_json::json!({ "action": "quit" }));
            }
            // 真正关闭后清除退出标记，避免下次启动误判
            if let tauri::WindowEvent::Destroyed = event {
                commands::set_quit_approved(false);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// 启动时命令行传参文件：延迟等前端 ready 后转发（全局 emit，前端 listen 可收）
fn command_line_open(app: &AppHandle) {
    let args: Vec<String> = std::env::args().collect();
    let Some(file) = extract_file_path(&args) else {
        return;
    };
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(1500));
        let _ = handle.emit("app_open_file", file.clone());
    });
}

/// 构建应原生菜单（快捷键承载；点击转发事件到前端）
fn setup_window_menu(app: &AppHandle) -> tauri::Result<()> {
    // 文件
    let new_item = MenuItem::with_id(app, "file:new", "新建", true, Some("CmdOrCtrl+N"))?;
    let open_item = MenuItem::with_id(app, "file:open", "打开…", true, Some("CmdOrCtrl+O"))?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let save_item = MenuItem::with_id(app, "file:save", "保存", true, Some("CmdOrCtrl+S"))?;
    let save_as_item = MenuItem::with_id(app, "file:save_as", "另存为…", true, Some("CmdOrCtrl+Shift+S"))?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let recent_item = MenuItem::with_id(app, "file:recent", "最近打开的文件", false, None::<&str>)?;
    let sep3 = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, "file:quit", "退出", true, Some("Alt+F4"))?;
    let file_menu = Submenu::with_items(app, "文件", true, &[
        &new_item, &open_item, &sep1, &save_item, &save_as_item,
        &sep2, &recent_item, &sep3, &quit_item,
    ])?;

    // 编辑
    let undo = PredefinedMenuItem::undo(app, Option::<&str>::None)?;
    let redo = PredefinedMenuItem::redo(app, Option::<&str>::None)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let cut = PredefinedMenuItem::cut(app, Option::<&str>::None)?;
    let copy = PredefinedMenuItem::copy(app, Option::<&str>::None)?;
    let paste = PredefinedMenuItem::paste(app, Option::<&str>::None)?;
    let select_all = PredefinedMenuItem::select_all(app, Option::<&str>::None)?;
    let edit_menu = Submenu::with_items(app, "编辑", true, &[
        &undo, &redo, &sep, &cut, &copy, &paste, &select_all,
    ])?;

    // 视图
    let reload = MenuItem::with_id(app, "view:reload", "重新加载", true, Some("CmdOrCtrl+R"))?;
    let devtools = MenuItem::with_id(app, "view:devtools", "开发者工具", true, Some("CmdOrCtrl+Shift+I"))?;
    let sepv1 = PredefinedMenuItem::separator(app)?;
    let zoom_reset = MenuItem::with_id(app, "view:zoom_reset", "实际大小", true, Some("CmdOrCtrl+0"))?;
    let zoom_in = MenuItem::with_id(app, "view:zoom_in", "放大", true, Some("Ctrl+="))?;
    let zoom_out = MenuItem::with_id(app, "view:zoom_out", "缩小", true, Some("Ctrl+-"))?;
    let sepv2 = PredefinedMenuItem::separator(app)?;
    let fullscreen = MenuItem::with_id(app, "view:fullscreen", "全屏", true, Some("F11"))?;
    let view_menu = Submenu::with_items(app, "视图", true, &[
        &reload, &devtools, &sepv1, &zoom_reset, &zoom_in, &zoom_out, &sepv2, &fullscreen,
    ])?;

    // 主题
    let theme_light = MenuItem::with_id(app, "theme:light", "浅色", true, None::<&str>)?;
    let theme_dark = MenuItem::with_id(app, "theme:dark", "深色", true, None::<&str>)?;
    let theme_menu = Submenu::with_items(app, "主题", true, &[&theme_light, &theme_dark])?;

    // 帮助
    let about = MenuItem::with_id(app, "help:about", "关于 MD编辑器", true, None::<&str>)?;
    let help_menu = Submenu::with_items(app, "帮助", true, &[&about])?;

    let builder = Menu::new(app)?;
    builder.append(&file_menu)?;
    builder.append(&edit_menu)?;
    builder.append(&view_menu)?;
    builder.append(&theme_menu)?;
    builder.append(&help_menu)?;
    app.set_menu(builder)?;

    app.on_menu_event(move |app, event| {
        let win = app.get_webview_window("main");
        match event.id().as_ref() {
            "file:new" => emit(win.as_ref(), "menu:new"),
            "file:open" => emit(win.as_ref(), "menu:open"),
            "file:save" => emit(win.as_ref(), "menu:save"),
            "file:save_as" => emit(win.as_ref(), "menu:save_as"),
            "file:quit" => emit_json(win.as_ref(), "menu:check_unsaved"),
            "view:reload" => eval(win.as_ref(), "location.reload()"),
            "view:devtools" => open_devtools(win.as_ref()),
            "view:zoom_reset" => eval(win.as_ref(), "document.body.style.zoom='1'"),
            "view:zoom_in" => eval(win.as_ref(), "document.body.style.zoom=(parseFloat(document.body.style.zoom||'1')+0.1).toFixed(2)"),
            "view:zoom_out" => eval(win.as_ref(), "document.body.style.zoom=Math.max(0.2,parseFloat(document.body.style.zoom||'1')-0.1).toFixed(2)"),
            "view:fullscreen" => toggle_fullscreen(win.as_ref()),
            "theme:light" => emit_str(win.as_ref(), "theme_set", "light"),
            "theme:dark" => emit_str(win.as_ref(), "theme_set", "dark"),
            "help:about" => about_dialog(win.as_ref()),
            _ => {}
        }
    });

    Ok(())
}

// ---------- 菜单事件辅助 ----------
fn emit(w: Option<&WebviewWindow>, event: &str) {
    if let Some(w) = w { let _ = w.emit(event, ()); }
}
fn emit_json(w: Option<&WebviewWindow>, event: &str) {
    if let Some(w) = w { let _ = w.emit(event, serde_json::json!({ "action": "quit" })); }
}
fn emit_str(w: Option<&WebviewWindow>, event: &str, val: &str) {
    if let Some(w) = w { let _ = w.emit(event, val); }
}
fn eval(w: Option<&WebviewWindow>, js: &str) {
    if let Some(w) = w { let _ = w.eval(js); }
}
fn open_devtools(w: Option<&WebviewWindow>) {
    if let Some(w) = w { #[cfg(debug_assertions)] { let _ = w.open_devtools(); } }
}
fn toggle_fullscreen(w: Option<&WebviewWindow>) {
    if let Some(w) = w {
        let is = w.is_fullscreen().unwrap_or(false);
        let _ = w.set_fullscreen(!is);
    }
}

/// about 对话框
fn about_dialog(window: Option<&WebviewWindow>) {
    use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
    if let Some(w) = window {
        let _ = w.dialog()
            .message(format!(
                "{APP_NAME} v{}\n\n本地 Markdown 编辑器：分屏实时预览、Mermaid 流程图、代码高亮、多编码支持、明暗主题。\n全程离线运行。",
                env!("CARGO_PKG_VERSION")
            ))
            .title(format!("关于 {APP_NAME}"))
            .kind(MessageDialogKind::Info)
            .blocking_show();
    }
}

/// 解析命令行参数中的待打开文件路径（对应原 extractFilePathFromArgv）
/// 注意：args[0] 是可执行文件自身，必须跳过。
fn extract_file_path(args: &[String]) -> Option<String> {
    for arg in args.iter().skip(1) {
        let a = arg.trim();
        if a.is_empty() || a.starts_with("--") || a.starts_with('-') {
            continue;
        }
        if a == "." || a == "./" || a == "\\./" {
            continue;
        }
        // 扩展名白名单优先
        let lower = a.to_lowercase();
        if lower.ends_with(".md") || lower.ends_with(".markdown") || lower.ends_with(".mdown") || lower.ends_with(".txt") {
            return to_abs_existing(a);
        }
        // 兜底：普通文件
        if let Some(p) = to_abs_existing(a) {
            return Some(p);
        }
    }
    None
}

fn to_abs_existing(path: &str) -> Option<String> {
    let pb = std::path::Path::new(path);
    let abs = if pb.is_absolute() {
        pb.to_path_buf()
    } else {
        std::env::current_dir().ok().map(|c| c.join(pb)).unwrap_or(pb.to_path_buf())
    };
    if abs.is_file() {
        Some(abs.to_string_lossy().to_string())
    } else {
        None
    }
}