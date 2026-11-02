//! WORDO 桌面壳：Tauri 命令只是「核心能力的薄封装」——逻辑全部在 wordo-core。

#[tauri::command]
fn list_packs(packs_dir: String) -> Result<serde_json::Value, String> {
    Ok(wordo_core::load::discover_packs(std::path::Path::new(&packs_dir)))
}

#[tauri::command]
fn load_pack(pack_path: String) -> Result<serde_json::Value, String> {
    wordo_core::load::load_pack(std::path::Path::new(&pack_path))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![list_packs, load_pack])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
