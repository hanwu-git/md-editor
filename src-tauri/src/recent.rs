//! 最近文件持久化（对应指南 §6.5 / 原 main.js recent-files.json）

use std::fs;
use std::path::Path;
use tauri::Manager;

const MAX_RECENT: usize = 8;

fn recent_path(app: &tauri::AppHandle) -> std::path::PathBuf {
    app.path().app_config_dir().unwrap_or_else(|_| {
        std::path::PathBuf::from(".")
    })
}

/// 读取最近文件列表
pub fn load(app: &tauri::AppHandle) -> Vec<String> {
    let dir = recent_path(app);
    if let Err(e) = fs::create_dir_all(&dir) {
        eprintln!("[recent] create dir failed: {e}");
        return Vec::new();
    }
    let file = dir.join("recent-files.json");
    if !file.exists() {
        return Vec::new();
    }
    fs::read_to_string(&file)
        .ok()
        .and_then(|s| serde_json::from_str::<Vec<String>>(s.as_str()).ok())
        .unwrap_or_default()
}

/// 加入一个文件到最近列表（去重、最多 8 个），持久化并返回新列表
pub fn push(app: &tauri::AppHandle, path: &str) -> Vec<String> {
    let mut list = load(app);
    list.retain(|x| x != path && !x.is_empty());
    list.insert(0, path.to_string());
    if list.len() > MAX_RECENT {
        list.truncate(MAX_RECENT);
    }
    save(app, &list);
    list
}

/// 写入磁盘
pub fn save(app: &tauri::AppHandle, list: &[String]) -> bool {
    let dir = recent_path(app);
    if let Err(e) = fs::create_dir_all(&dir) {
        eprintln!("[recent] create dir failed: {e}");
        return false;
    }
    let file = dir.join("recent-files.json");
    match serde_json::to_string_pretty(list) {
        Ok(json) => fs::write(file, json).map_err(|e| {
            eprintln!("[recent] write failed: {e}");
        }).is_ok(),
        Err(e) => {
            eprintln!("[recent] serialize failed: {e}");
            false
        }
    }
}

/// 校验路径是否为存在的普通文件
pub fn is_existing_file(path: &str) -> bool {
    Path::new(path).is_file()
}