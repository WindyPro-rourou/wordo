//! WORDO 桌面壳：Tauri 命令是「核心能力的薄封装」——逻辑全部在 wordo-core。

use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use tauri::Manager;

fn config_path(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_config_dir()
        .map(|p| p.join("config.json"))
        .unwrap_or_else(|_| PathBuf::from("wordo-config.json"))
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

/// 调用模型：装配提示词 → 请求 → 抽取 JSON → 按 output-schema/1 校验
#[tauri::command]
async fn ask_model(app: tauri::AppHandle, req: Value) -> Result<Value, String> {
    let task = req.get("task").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let pack = req.get("packPath").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let payload = req.get("payload").cloned().unwrap_or(Value::Null);
    let pack_path = Path::new(&pack);

    let cfg = wordo_core::config::load(&config_path(&app));
    let prov = wordo_core::config::active_provider(&cfg)
        .ok_or_else(|| "未配置模型提供方：请在「设置」里选择提供方并填入 API Key".to_string())?;
    if prov.base_url.trim().is_empty() || prov.api_key.trim().is_empty() || prov.model.trim().is_empty() {
        return Err("模型配置不完整：需要 baseURL / API Key / 模型名".to_string());
    }

    let prompt = wordo_core::prompt::build(&task, pack_path, &payload)?;
    let sys = prompt.get("system").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let usr = prompt.get("user").and_then(|v| v.as_str()).unwrap_or("").to_string();

    let temperature = match cfg.thinking.as_str() {
        "fast" => 0.6,
        "deep" => 0.2,
        _ => 0.35,
    };
    let body = json!({
        "model": prov.model,
        "messages": [
            { "role": "system", "content": sys },
            { "role": "user", "content": usr }
        ],
        "temperature": temperature,
        "max_tokens": 2048,
        "stream": false
    });

    let url = format!("{}/chat/completions", prov.base_url.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(150))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .post(&url)
        .bearer_auth(prov.api_key.trim())
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("请求失败: {e}"))?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        let brief: String = text.chars().take(500).collect();
        return Err(format!("HTTP {status}：{brief}"));
    }

    let rv: Value = serde_json::from_str(&text).map_err(|e| format!("响应不是 JSON: {e}"))?;
    let content = rv
        .pointer("/choices/0/message/content")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let data = extract_json(&content);
    let kc_ids = wordo_core::prompt::kc_id_set(pack_path);
    let issues = match &data {
        Some(v) => wordo_core::outcheck::check(&task, v, &kc_ids),
        None => vec!["模型输出不是合法 JSON".to_string()],
    };

    Ok(json!({
        "ok": data.is_some() && issues.is_empty(),
        "data": data,
        "issues": issues,
        "raw": content,
        "model": prov.model,
    }))
}

/// 从模型输出里抽取 JSON（容忍 ```json 围栏与前后废话）
fn extract_json(s: &str) -> Option<Value> {
    let t = s.trim();
    if let Ok(v) = serde_json::from_str::<Value>(t) {
        return Some(v);
    }
    let t2 = t
        .strip_prefix("```json")
        .or_else(|| t.strip_prefix("```"))
        .unwrap_or(t);
    let t2 = t2.strip_suffix("```").unwrap_or(t2).trim();
    if let Ok(v) = serde_json::from_str::<Value>(t2) {
        return Some(v);
    }
    let start = t.find('{')?;
    let end = t.rfind('}')?;
    if end > start {
        if let Ok(v) = serde_json::from_str::<Value>(&t[start..=end]) {
            return Some(v);
        }
    }
    None
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
