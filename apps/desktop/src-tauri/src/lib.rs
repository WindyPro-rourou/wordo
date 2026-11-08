//! WORDO 桌面壳：Tauri 命令是「薄封装」——全部逻辑在 wordo_core::api（GUI / CLI / 无头预览共用）。

use serde_json::Value;
use std::path::PathBuf;
use tauri::Manager;

use wordo_core::api;

fn config_path(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_config_dir()
        .map(|p| p.join("config.json"))
        .unwrap_or_else(|_| wordo_core::config::default_path())
}

/* ══════════ 学科包 ══════════ */

#[tauri::command]
fn list_packs(packs_dir: String) -> Value {
    api::list_packs(&packs_dir)
}

#[tauri::command]
fn load_pack(pack_path: String) -> Result<Value, String> {
    api::load_pack(&pack_path)
}

/// 新建学科：在 packs 目录下生成符合 subject-pack/1 的最小骨架（落实「允许用户新建学科」）
#[tauri::command]
fn scaffold_pack(
    packs_dir: String,
    id: String,
    name: String,
    description: Option<String>,
    author: Option<String>,
    license: Option<String>,
) -> Result<Value, String> {
    api::scaffold_pack(
        &packs_dir,
        &id,
        &name,
        description.as_deref(),
        author.as_deref(),
        license.as_deref(),
    )
}

/* ══════════ 配置 ══════════ */

#[tauri::command]
fn get_config(app: tauri::AppHandle) -> Value {
    api::get_config(&config_path(&app))
}

/// 参数名必须是 `config`（前端 invoke 的键名）
#[tauri::command]
fn set_config(app: tauri::AppHandle, config: Value) -> Result<Value, String> {
    api::set_config(&config_path(&app), config)
}

#[tauri::command]
fn build_prompt(task: String, pack_path: String, payload: Value) -> Result<Value, String> {
    api::build_prompt(&task, &pack_path, &payload)
}

/* ══════════ 模型 ══════════ */

#[tauri::command]
async fn ask_model(app: tauri::AppHandle, req: Value) -> Result<Value, String> {
    let p = config_path(&app);
    tauri::async_runtime::spawn_blocking(move || api::ask_model(&p, &req))
        .await
        .map_err(|e| format!("调用任务异常终止：{e}"))?
}

/* ══════════ 学习环路 ══════════ */

#[tauri::command]
fn learn_state(domain: String, packs_dir: String) -> Result<Value, String> {
    api::learn_state(&domain, &packs_dir)
}

#[tauri::command]
fn learn_due(domain: String, packs_dir: String) -> Result<Value, String> {
    api::learn_due(&domain, &packs_dir)
}

#[tauri::command]
fn learn_queue(domain: String, packs_dir: String, kc_id: String, n: Option<usize>) -> Result<Value, String> {
    api::learn_queue(&domain, &packs_dir, &kc_id, n)
}

#[tauri::command]
fn record_answer(
    domain: String,
    packs_dir: String,
    pack: String,
    item_id: String,
    answered: String,
    source: Option<String>,
    error_type: Option<String>,
    confidence: Option<String>,
) -> Result<Value, String> {
    api::record_answer(&domain, &packs_dir, &pack, &item_id, &answered, source.as_deref(), error_type.as_deref(), confidence.as_deref())
}

#[tauri::command]
fn learn_sync(domain: String, packs_dir: String) -> Result<Value, String> {
    api::learn_sync(&domain, &packs_dir)
}

#[tauri::command]
fn learn_delegate(domain: String, packs_dir: String) -> Result<Value, String> {
    api::learn_delegate(&domain, &packs_dir)
}

#[tauri::command]
async fn learn_review(
    app: tauri::AppHandle,
    domain: String,
    packs_dir: String,
    limit: Option<usize>,
) -> Result<Value, String> {
    let p = config_path(&app);
    tauri::async_runtime::spawn_blocking(move || api::learn_review(&p, &domain, &packs_dir, limit))
        .await
        .map_err(|e| format!("处理委托异常终止：{e}"))?
}

#[tauri::command]
fn learn_plan(
    domain: String,
    action: String,
    text: Option<String>,
    task_id: Option<String>,
) -> Result<Value, String> {
    api::learn_plan(&domain, &action, text.as_deref(), task_id.as_deref())
}

/* ══════════ 会话（chat-first） ══════════ */

#[tauri::command]
fn chat_list(domain: String) -> Result<Value, String> {
    api::chat_list(&domain)
}

#[tauri::command]
fn chat_get(domain: String, id: String) -> Result<Value, String> {
    api::chat_get(&domain, &id)
}

#[tauri::command]
fn chat_new(domain: String, title: String) -> Result<Value, String> {
    api::chat_new(&domain, &title)
}

#[tauri::command]
fn chat_append(domain: String, id: String, msg: Value) -> Result<Value, String> {
    api::chat_append(&domain, &id, &msg)
}

#[tauri::command]
fn chat_rename(domain: String, id: String, title: String) -> Result<Value, String> {
    api::chat_rename(&domain, &id, &title)
}

#[tauri::command]
fn chat_delete(domain: String, id: String) -> Result<Value, String> {
    api::chat_delete(&domain, &id)
}

#[tauri::command]
fn detect_subject(domain: String, text: String, packs_dir: String) -> Result<Value, String> {
    api::detect_subject(&domain, &text, &packs_dir)
}


/* ══════════ 判分即落账 ══════════ */

#[tauri::command]
fn record_judged(
    domain: String,
    packs_dir: String,
    pack: String,
    kc_id: String,
    synthetic_id: String,
    answered: String,
    ok: bool,
    source: Option<String>,
    error_type: Option<String>,
    confidence: Option<String>,
) -> Result<Value, String> {
    api::record_judged(
        &domain,
        &packs_dir,
        &pack,
        &kc_id,
        &synthetic_id,
        &answered,
        ok,
        source.as_deref().unwrap_or("followup"),
        error_type.as_deref(),
        confidence.as_deref(),
    )
}

#[tauri::command]
fn record_explain(domain: String, pack: String, kc_id: String, model: String, source: Option<String>) -> Result<Value, String> {
    api::record_explain(&domain, &pack, &kc_id, &model, source.as_deref().unwrap_or("ai"))
}

#[tauri::command]
fn verify_ledger(domain: String, packs_dir: String) -> Result<Value, String> {
    api::verify_ledger(&domain, &packs_dir)
}

#[tauri::command]
fn export_report(domain: String, packs_dir: String) -> Result<Value, String> {
    api::export_report(&domain, &packs_dir)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            list_packs,
            load_pack,
            scaffold_pack,
            get_config,
            set_config,
            build_prompt,
            ask_model,
            learn_state,
            learn_due,
            learn_queue,
            record_answer,
            learn_sync,
            learn_delegate,
            learn_review,
            learn_plan,
            chat_list,
            chat_get,
            chat_new,
            chat_append,
            chat_rename,
            chat_delete,
            detect_subject,
            record_judged,
            record_explain,
            verify_ledger,
            export_report
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/* ══════════ 契约测试（不弹窗） ══════════ */

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_domain() -> String {
        let d = std::env::temp_dir().join(format!("wordo-contract-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().subsec_nanos()));
        let _ = std::fs::remove_dir_all(&d);
        d.to_string_lossy().to_string()
    }

    #[test]
    fn commands_contract() {
        let d = tmp_domain();
        let packs = "../../../packs".to_string();

        let due = api::learn_due(&d, &packs).expect("learn_due");
        for k in ["weak", "due", "today_answers", "today_wrong", "nodes", "events_total", "domain"] {
            assert!(due.get(k).is_some(), "learn_due 缺字段 {k}");
        }

        let q = api::learn_queue(&d, &packs, "kc_eng_0002", Some(1)).expect("queue");
        let items = q.get("items").and_then(|v| v.as_array()).expect("items");
        assert_eq!(items.len(), 1);
        let item_id = items[0].get("id").and_then(|v| v.as_str()).unwrap().to_string();

        let ra = api::record_answer(&d, &packs, "english.high", &item_id, "A", Some("quiz"), None, None).expect("record");
        for k in ["ok", "correct", "kc", "nextDue", "eventId"] {
            assert!(ra.get(k).is_some(), "record_answer 缺 {k}");
        }
        assert_eq!(ra.get("ok").and_then(|v| v.as_bool()), Some(false));

        let st = api::learn_state(&d, &packs).expect("state");
        let md = st.get("userMd").and_then(|v| v.as_str()).unwrap();
        assert!(md.contains("薄弱知识点"));

        let de = api::learn_delegate(&d, &packs).expect("delegate");
        assert_eq!(de.get("exported").and_then(|v| v.as_bool()), Some(true));

        let sy = api::learn_sync(&d, &packs).expect("sync");
        assert!(sy.get("per_node").is_some());

        // 包列表与单包加载
        let lp = api::list_packs(&packs);
        assert!(lp.get("packs").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0) >= 2);
        let one = api::load_pack("../../../packs/english.high").expect("load_pack");
        assert!(one.get("kcs").is_some());

        let _ = std::fs::remove_dir_all(&d);
    }
}
