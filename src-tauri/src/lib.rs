mod commands;
mod fs_io;
mod recent;

use tauri::{AppHandle, Emitter, Manager};
use std::sync::Mutex;

/// 启动命令行待打开文件：前端初始化时通过 app_take_pending_file 取走（启动握手）
pub static PENDING_FILE: Mutex<Option<String>> = Mutex::new(None);

/// 启动性能打点：设置 MD_EDIT_BOOT_LOG=1 时写入 %TEMP%\mdedit-boot.log（毫秒时间戳）
pub static BOOT_T0: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();
pub fn boot_log(msg: &str) {
    if std::env::var("MD_EDIT_BOOT_LOG").is_err() {
        return;
    }
    let t = BOOT_T0.get_or_init(std::time::Instant::now).elapsed().as_millis();
    let line = format!("[boot {:>6}ms] {}\r\n", t, msg);
    let p = std::env::temp_dir().join("mdedit-boot.log");
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&p) {
        use std::io::Write;
        let _ = f.write_all(line.as_bytes());
    }
}

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
        .plugin(tauri_plugin_window_state::Builder::default()
            // 排除 VISIBLE：否则会把上次保存的"可见"状态在创建时恢复，
            // 打穿 tauri.conf visible:false（窗口先于内容显示 → 白框/欢迎页闪现）
            .with_state_flags(tauri_plugin_window_state::StateFlags::all()
                & !tauri_plugin_window_state::StateFlags::VISIBLE)
            .build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::dialog_open_file,
            commands::dialog_open_recent,
            commands::dialog_save_file,
            commands::dialog_save_file_as,
            commands::app_get_recent,
            commands::app_get_version,
            commands::app_take_pending_file,
            commands::app_boot_mark,
            commands::app_show_window,
            commands::dialog_confirm_exit,
            commands::view_toggle_devtools,
            commands::view_zoom_in,
            commands::view_zoom_out,
            commands::view_reset_zoom,
            commands::view_sync_zoom,
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
            commands::open_external,
        ])
        .setup(move |app| {
            BOOT_T0.get_or_init(std::time::Instant::now);
            command_line_open(app.handle());
            // 兜底：显式隐藏（防插件/配置回归导致窗口先于内容显示），
            // 且若前端初始化失败未显示窗口，5 秒后强制显示避免"永远无窗口"
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.hide();
                boot_log("setup: 窗口已创建并强制隐藏");
            }
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(5));
                if let Some(win) = handle.get_webview_window("main") {
                    if !win.is_visible().unwrap_or(true) {
                        boot_log("fallback: 5s 兜底显示窗口（前端未调用 show）");
                        let _ = win.show();
                    }
                }
            });
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

/// 启动时命令行传参文件：存入 PENDING_FILE，由前端初始化时主动取走（消除 1.5s 延迟与欢迎页闪现）
fn command_line_open(app: &AppHandle) {
    let args: Vec<String> = std::env::args().collect();
    if let Some(file) = extract_file_path(&args) {
        if let Ok(mut g) = PENDING_FILE.lock() {
            *g = Some(file);
        }
    }
}

// ---------- 事件辅助 ----------
// 原生菜单已整体移除（decorations:false 下不可见，网页菜单 buildMenubar 才是用户可见菜单，
// 快捷键由前端 keydown 接管）。退出确认事件由 on_window_event 直接 emit。

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