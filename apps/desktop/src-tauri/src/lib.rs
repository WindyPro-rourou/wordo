//! WORDO 桌面壳：Tauri 命令是「核心能力的薄封装」——逻辑全部在 wordo-core。
//! 模型调用一律走 wordo_core::llm（与 CLI 同一条代码路径，含校验重试）。

use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use tauri::Manager;

fn config_path(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_config_dir()
        .map(|p| p.join("config.json"))
        .unwrap_or_else(|_| wordo_core::config::default_path())
}

#[tauri::command]
fn list_packs(packs_dir: String) -> Result<serde_json::Value, String> {
    Ok(wordo_core::load::discover_packs(std::path::Path::new(&packs_dir)))
}

#[tauri::command]
fn load_pack(pack_path: String) -> Result<serde_json::Value, String> {
    wordo_core::load::load_pack(std::path::Path::new(&pack_path))
}

#[tauri::command]
fn get_config(app: tauri::AppHandle) -> Value {
    let p = config_path(&app);
    json!({
        "config": wordo_core::config::load(&p),
        "presets": wordo_core::config::presets(),
        "path": p.display().to_string(),
    })
}

#[tauri::command]
fn set_config(app: tauri::AppHandle, config: Value) -> Result<Value, String> {
    let cfg: wordo_core::config::AppConfig =
        serde_json::from_value(config).map_err(|e| format!("配置格式错误: {e}"))?;
    let p = config_path(&app);
    wordo_core::config::save(&p, &cfg)?;
    Ok(json!({ "saved": true, "path": p.display().to_string() }))
}

#[tauri::command]
fn build_prompt(task: String, pack_path: String, payload: Value) -> Result<Value, String> {
    wordo_core::prompt::build(&task, Path::new(&pack_path), &payload)
}

/// 调用模型：委托给 core（装配提示词 → 请求 → 校验 → 最多 2 次重试）。
/// HTTP 是阻塞式的，放到阻塞线程池，别卡住 UI 线程。
#[tauri::command]
async fn ask_model(app: tauri::AppHandle, req: Value) -> Result<Value, String> {
    let task = req
        .get("task")
        .and_then(|v| v.as_str())
        .unwrap_or("explain")
        .to_string();
    let pack = req
        .get("packPath")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let payload = req.get("payload").cloned().unwrap_or(Value::Null);

    if !Path::new(&pack).is_dir() {
        return Err(format!("学科包目录不存在：{pack}"));
    }
    let cfg = wordo_core::config::load(&config_path(&app));

    tauri::async_runtime::spawn_blocking(move || {
        let r = wordo_core::llm::ask_retry(&cfg, &task, Path::new(&pack), &payload, 2)?;
        Ok::<Value, String>(r.to_json())
    })
    .await
    .map_err(|e| format!("调用任务异常终止：{e}"))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            list_packs,
            load_pack,
            get_config,
            set_config,
            build_prompt,
            ask_model
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
