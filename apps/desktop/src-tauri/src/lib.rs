//! WORDO 桌面壳：Tauri 命令是「核心能力的薄封装」——逻辑全部在 wordo-core。
//! 模型调用一律走 wordo_core::llm（与 CLI 同一条代码路径，含校验重试）。
//! `domain` / `packsDir` 传空字符串时使用默认账号域与 ./packs。

use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use tauri::Manager;

use wordo_core::{config, learn, llm};

fn config_path(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_config_dir()
        .map(|p| p.join("config.json"))
        .unwrap_or_else(|_| config::default_path())
}

fn resolve_domain(domain: &str) -> PathBuf {
    if domain.trim().is_empty() {
        config::default_domain_path()
    } else {
        PathBuf::from(domain)
    }
}

fn resolve_packs(packs_dir: &str) -> PathBuf {
    if packs_dir.trim().is_empty() {
        PathBuf::from("packs")
    } else {
        PathBuf::from(packs_dir)
    }
}

/// 把 kc_id 补上人类可读名称与所属学科包
fn decorate(packs: &Path, list: &[learn::KcState]) -> Vec<Value> {
    let idx = learn::kc_index(packs);
    list.iter()
        .map(|k| {
            let (name, pack) = idx
                .get(&k.kc_id)
                .map(|(n, p)| (n.clone(), p.clone()))
                .unwrap_or_else(|| (k.kc_id.clone(), String::new()));
            json!({
                "kc_id": k.kc_id,
                "kc_name": name,
                "pack": pack,
                "attempts": k.attempts,
                "correct": k.correct,
                "wrong": k.wrong,
                "streak": k.streak,
                "mastery": (k.mastery * 100.0).round() / 100.0,
                "due_ts": k.due_ts,
                "mastered": k.mastered,
            })
        })
        .collect()
}

/* ══════════ 学科包 ══════════ */

#[tauri::command]
fn list_packs(packs_dir: String) -> Result<Value, String> {
    Ok(wordo_core::load::discover_packs(&resolve_packs(&packs_dir)))
}

#[tauri::command]
fn load_pack(pack_path: String) -> Result<Value, String> {
    wordo_core::load::load_pack(Path::new(&pack_path))
}

/* ══════════ 配置 ══════════ */

#[tauri::command]
fn get_config(app: tauri::AppHandle) -> Value {
    let p = config_path(&app);
    json!({
        "config": config::load(&p),
        "presets": config::presets(),
        "path": p.display().to_string(),
        "domain": config::default_domain_path().display().to_string(),
    })
}

/// 注意：参数名必须是 `config`（前端 invoke 用的键名），因此函数内用全路径调模块
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

/* ══════════ 模型 ══════════ */

/// 调用模型：装配提示词（自动注入 user.md 学习者状态）→ 请求 → 校验 → 最多 2 次重试
#[tauri::command]
async fn ask_model(app: tauri::AppHandle, req: Value) -> Result<Value, String> {
    let task = req.get("task").and_then(|v| v.as_str()).unwrap_or("explain").to_string();
    let pack = req.get("packPath").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let domain = resolve_domain(req.get("domain").and_then(|v| v.as_str()).unwrap_or(""));
    let packs_dir = resolve_packs(req.get("packsDir").and_then(|v| v.as_str()).unwrap_or(""));
    let mut payload = req.get("payload").cloned().unwrap_or(Value::Null);

    if !Path::new(&pack).is_dir() {
        return Err(format!("学科包目录不存在：{pack}"));
    }
    // 学习者状态注入（user.md）：个性化与「重点复习我不会的」都靠它
    if payload.get("_learner_md").is_none() {
        if let Ok((content, _)) = learn::write_user_md(&domain, &packs_dir) {
            if let Some(obj) = payload.as_object_mut() {
                obj.insert("_learner_md".to_string(), Value::String(content));
            }
        }
    }
    let cfg = config::load(&config_path(&app));

    tauri::async_runtime::spawn_blocking(move || {
        let r = llm::ask_retry(&cfg, &task, Path::new(&pack), &payload, 2)?;
        Ok::<Value, String>(r.to_json())
    })
    .await
    .map_err(|e| format!("调用任务异常终止：{e}"))?
}

/* ══════════ 学习环路 ══════════ */

/// 学员状态：user.md 全文（人读+机读同一份）
#[tauri::command]
fn learn_state(domain: String, packs_dir: String) -> Result<Value, String> {
    let d = resolve_domain(&domain);
    let p = resolve_packs(&packs_dir);
    let (content, path) = learn::write_user_md(&d, &p)?;
    Ok(json!({
        "userMd": content,
        "path": path.display().to_string(),
        "domain": d.display().to_string(),
    }))
}

/// 复习态势：薄弱 + 今日到期
#[tauri::command]
fn learn_due(domain: String, packs_dir: String) -> Result<Value, String> {
    let d = resolve_domain(&domain);
    let p = resolve_packs(&packs_dir);
    let st = learn::derive(&d, None);
    Ok(json!({
        "weak": decorate(&p, &learn::weak_list(&st)),
        "due": decorate(&p, &learn::due_list(&st, None)),
        "today_answers": st.today_answers,
        "today_wrong": st.today_wrong,
        "nodes": st.nodes,
        "events_total": st.events_total,
        "domain": d.display().to_string(),
    }))
}

/// 出题（错题优先 → 未做过 → 最久未做）
#[tauri::command]
fn learn_queue(domain: String, packs_dir: String, kc_id: String, n: Option<usize>) -> Result<Value, String> {
    let d = resolve_domain(&domain);
    let p = resolve_packs(&packs_dir);
    let st = learn::derive(&d, None);
    let items = learn::pick_items(&p, &kc_id, &st, n.unwrap_or(3));
    Ok(json!({ "items": items }))
}

/// 记一次作答 = 写一条账本事件，并返回该知识点更新后的状态
#[tauri::command]
fn record_answer(
    domain: String,
    packs_dir: String,
    pack: String,
    item_id: String,
    answered: String,
    source: Option<String>,
) -> Result<Value, String> {
    let d = resolve_domain(&domain);
    let p = resolve_packs(&packs_dir);
    let node = learn::node_id(&d)?;
    let out = learn::record_answer(
        &d,
        &p,
        &node,
        &pack,
        &item_id,
        &answered,
        source.as_deref().unwrap_or("quiz"),
        None,
    )?;
    // 顺带刷新 user.md（账本变了，派生文件就该跟着变）
    let _ = learn::write_user_md(&d, &p);
    Ok(json!({
        "ok": out.ok,
        "correct": out.event.correct,
        "kc": out.kc_state,
        "nextDue": out.next_due,
        "eventId": out.event.id,
    }))
}

/// 域同步：合并全部节点账本 → 重算 user.md
#[tauri::command]
fn learn_sync(domain: String, packs_dir: String) -> Result<Value, String> {
    let d = resolve_domain(&domain);
    let p = resolve_packs(&packs_dir);
    learn::sync(&d, &p)
}

/// 导出今日错题为委托文书（发给域内其他设备处理）
#[tauri::command]
fn learn_delegate(domain: String, packs_dir: String) -> Result<Value, String> {
    let d = resolve_domain(&domain);
    let p = resolve_packs(&packs_dir);
    let node = learn::node_id(&d)?;
    learn::export_wrong_delegation(&d, &p, &node, &learn::today())
}

/// 处理域内其他设备发来的委托（调模型 T3，可能较慢）
#[tauri::command]
async fn learn_review(app: tauri::AppHandle, domain: String, packs_dir: String, limit: Option<usize>) -> Result<Value, String> {
    let d = resolve_domain(&domain);
    let p = resolve_packs(&packs_dir);
    let cfg = config::load(&config_path(&app));
    let node = learn::node_id(&d)?;

    tauri::async_runtime::spawn_blocking(move || {
        let pending = learn::pending_delegations(&d, &node);
        let mut processed = Vec::new();
        for f in pending.iter().take(limit.unwrap_or(3)) {
            let md = std::fs::read_to_string(f).unwrap_or_default();
            let Some(payload) = learn::extract_machine_json(&md) else { continue };
            let res = llm::ask_retry(&cfg, "review-wrong", &p, &payload, 1)?;
            if let Some(data) = &res.data {
                let out = learn::write_delegation_result(&d, &node, f, data)?;
                processed.push(json!({
                    "src": f.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default(),
                    "result": out.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default(),
                    "ok": res.ok,
                    "attempts": res.attempts,
                }));
            }
        }
        let _ = learn::sync(&d, &p);
        Ok::<Value, String>(json!({ "processed": processed, "pending_before": pending.len() }))
    })
    .await
    .map_err(|e| format!("处理委托异常终止：{e}"))?
}

/// 学习计划 / 任务清单
#[tauri::command]
fn learn_plan(domain: String, action: String, text: Option<String>, task_id: Option<String>) -> Result<Value, String> {
    let d = resolve_domain(&domain);
    let node = learn::node_id(&d)?;
    match action.as_str() {
        "add" => {
            let id = learn::plan_add(&d, &node, text.as_deref().unwrap_or(""))?;
            Ok(json!({ "added": id }))
        }
        "done" => {
            learn::plan_done(&d, &node, task_id.as_deref().unwrap_or(""))?;
            Ok(json!({ "done": task_id }))
        }
        _ => Ok(json!({ "plan": learn::plan_list(&d) })),
    }
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
            ask_model,
            learn_state,
            learn_due,
            learn_queue,
            record_answer,
            learn_sync,
            learn_delegate,
            learn_review,
            learn_plan
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/* ══════════ 集成测试：验证 GUI 后端契约（不弹窗、不点击） ══════════ */

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_domain() -> String {
        let d = std::env::temp_dir().join(format!("wordo-contract-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        d.to_string_lossy().to_string()
    }

    /// 前端 invoke 的每个键都必须存在（JS 直接消费这些字段）
    #[test]
    fn learn_commands_contract() {
        let d = tmp_domain();
        let packs = "../../../packs".to_string();

        // learn_due
        let due = learn_due(d.clone(), packs.clone()).expect("learn_due");
        for k in ["weak", "due", "today_answers", "today_wrong", "nodes", "events_total", "domain"] {
            assert!(due.get(k).is_some(), "learn_due 缺字段 {k}");
        }

        // learn_queue
        let q = learn_queue(d.clone(), packs.clone(), "kc_eng_0002".into(), Some(1)).expect("learn_queue");
        let items = q.get("items").and_then(|v| v.as_array()).expect("items");
        assert_eq!(items.len(), 1);
        let item_id = items[0].get("id").and_then(|v| v.as_str()).unwrap().to_string();

        // record_answer（故意答错：it_eng_0001 正确答案为 B）
        let ra = record_answer(
            d.clone(),
            packs.clone(),
            "english.high".into(),
            item_id.clone(),
            "A".into(),
            Some("quiz".into()),
        )
        .expect("record_answer");
        for k in ["ok", "correct", "kc", "nextDue", "eventId"] {
            assert!(ra.get(k).is_some(), "record_answer 缺字段 {k}");
        }
        assert_eq!(ra.get("ok").and_then(|v| v.as_bool()), Some(false));
        let kc = ra.get("kc").unwrap();
        for k in ["kc_id", "correct", "wrong", "streak", "mastery", "due_ts"] {
            assert!(kc.get(k).is_some(), "record_answer.kc 缺字段 {k}");
        }

        // learn_state（user.md 派生）
        let st = learn_state(d.clone(), packs.clone()).expect("learn_state");
        let md = st.get("userMd").and_then(|v| v.as_str()).unwrap();
        assert!(md.contains("学习者状态"), "user.md 内容异常");
        assert!(md.contains("薄弱知识点"), "user.md 缺薄弱段");
        assert!(st.get("path").is_some() && st.get("domain").is_some());

        // learn_sync（多节点视图）
        let sy = learn_sync(d.clone(), packs.clone()).expect("learn_sync");
        for k in ["domain", "node", "events_total", "per_node", "weak", "due", "pending_delegations", "user_md"] {
            assert!(sy.get(k).is_some(), "learn_sync 缺字段 {k}");
        }
        assert!(sy.get("events_total").and_then(|v| v.as_u64()).unwrap() >= 1);

        // learn_delegate（今日有错题 → 必须导出）
        let de = learn_delegate(d.clone(), packs.clone()).expect("learn_delegate");
        assert_eq!(de.get("exported").and_then(|v| v.as_bool()), Some(true), "应导出错题");
        assert!(de.get("file").is_some() && de.get("count").is_some());

        // learn_plan
        let add = learn_plan(d.clone(), "add".into(), Some("今天复习一般过去时".into()), None).expect("plan add");
        assert!(add.get("added").is_some());
        let list = learn_plan(d.clone(), "list".into(), None, None).expect("plan list");
        assert!(list.get("plan").and_then(|v| v.as_array()).unwrap().len() >= 1);

        // 空 domain/packs 时应落到默认路径而不是报错
        let dflt = learn_due(String::new(), String::new()).expect("learn_due 默认路径");
        assert!(dflt.get("domain").and_then(|v| v.as_str()).unwrap().len() > 3);

        let _ = std::fs::remove_dir_all(&d);
    }
}
