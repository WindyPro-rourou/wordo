//! 对外 API 契约（唯一实现）：GUI 的 Tauri 命令、CLI 的 `wordo api`、无头预览桥
//! 全部调用这里，保证三处行为与字段名完全一致，不会漂移。
//!
//! 约定：入参用 &str / &Value（与前端 JSON 一一对应），出参一律 serde_json::Value。

use serde_json::{json, Value};
use std::path::{Path, PathBuf};

use crate::{config, learn, llm};

/* ══════════ 路径解析 ══════════ */

pub fn resolve_domain(domain: &str) -> PathBuf {
    if domain.trim().is_empty() {
        config::default_domain_path()
    } else {
        PathBuf::from(domain)
    }
}

pub fn resolve_packs(packs_dir: &str) -> PathBuf {
    if packs_dir.trim().is_empty() {
        PathBuf::from("packs")
    } else {
        PathBuf::from(packs_dir)
    }
}

/// 把知识点状态补上人类可读名称与所属学科包
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
                // 保留两位小数，前端直接显示成百分比
                "mastery": (k.mastery * 100.0).round() / 100.0,
                "due_ts": k.due_ts,
                "mastered": k.mastered,
                "error_types": k.error_types,
            })
        })
        .collect()
}

/* ══════════ 学科包 ══════════ */

pub fn list_packs(packs_dir: &str) -> Value {
    crate::load::discover_packs(&resolve_packs(packs_dir))
}

pub fn load_pack(pack_path: &str) -> Result<Value, String> {
    crate::load::load_pack(Path::new(pack_path))
}

/* ══════════ 配置 ══════════ */

pub fn get_config(config_path: &Path) -> Value {
    json!({
        "config": config::load(config_path),
        "presets": config::presets(),
        "path": config_path.display().to_string(),
        "domain": config::default_domain_path().display().to_string(),
    })
}

pub fn set_config(config_path: &Path, config_value: Value) -> Result<Value, String> {
    let cfg: config::AppConfig =
        serde_json::from_value(config_value).map_err(|e| format!("配置格式错误: {e}"))?;
    // 简单校验：至少要有 base_url / api_key / model
    if let Some(p) = cfg.providers.get(cfg.active) {
        if p.base_url.trim().is_empty() || p.api_key.trim().is_empty() || p.model.trim().is_empty() {
            return Err("模型配置不完整：需要 baseURL / API Key / 模型名".to_string());
        }
    } else {
        return Err("没有可用的模型提供方".to_string());
    }
    config::save(config_path, &cfg)?;
    Ok(json!({ "saved": true, "path": config_path.display().to_string() }))
}

/* ══════════ 提示词 / 模型 ══════════ */

pub fn build_prompt(task: &str, pack_path: &str, payload: &Value) -> Result<Value, String> {
    crate::prompt::build(task, Path::new(pack_path), payload)
}

/// 装配提示词（自动注入 user.md 学习者状态）→ 请求 → 校验 → 最多 2 次重试
pub fn ask_model(config_path: &Path, req: &Value) -> Result<Value, String> {
    let task = req.get("task").and_then(|v| v.as_str()).unwrap_or("explain");
    let pack = req.get("packPath").and_then(|v| v.as_str()).unwrap_or("");
    let domain = resolve_domain(req.get("domain").and_then(|v| v.as_str()).unwrap_or(""));
    let packs_dir = resolve_packs(req.get("packsDir").and_then(|v| v.as_str()).unwrap_or(""));
    let mut payload = req.get("payload").cloned().unwrap_or(Value::Null);

    if !Path::new(pack).is_dir() {
        return Err(format!("学科包目录不存在：{pack}"));
    }
    // 学习者状态注入（user.md）：模型据此做个性化，落实「重点复习我不会的」
    // 注意：这里**只在内存里渲染**，不写盘 —— user.md 是派生物，避免多设备抢写同一文件
    if payload.get("_learner_md").is_none() {
        let st = learn::derive(&domain, None);
        let content = learn::render_user_md(&domain, &packs_dir, &st);
        if let Some(obj) = payload.as_object_mut() {
            obj.insert("_learner_md".to_string(), Value::String(content));
        }
    }
    let cfg = config::load(config_path);
    let r = llm::ask_retry(&cfg, task, Path::new(pack), &payload, 2)?;
    Ok(r.to_json())
}

/* ══════════ 学习环路 ══════════ */

/// user.md 全文（人读 + 机读同一份）
pub fn learn_state(domain: &str, packs_dir: &str) -> Result<Value, String> {
    let d = resolve_domain(domain);
    let p = resolve_packs(packs_dir);
    let (content, path) = learn::write_user_md(&d, &p)?;
    Ok(json!({
        "userMd": content,
        "path": path.display().to_string(),
        "domain": d.display().to_string(),
    }))
}

/// 复习态势：薄弱 + 今日到期 + 今日进度
pub fn learn_due(domain: &str, packs_dir: &str) -> Result<Value, String> {
    let d = resolve_domain(domain);
    let p = resolve_packs(packs_dir);
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
pub fn learn_queue(domain: &str, packs_dir: &str, kc_id: &str, n: Option<usize>) -> Result<Value, String> {
    let d = resolve_domain(domain);
    let p = resolve_packs(packs_dir);
    let st = learn::derive(&d, None);
    let items = learn::pick_items(&p, kc_id, &st, n.unwrap_or(3));
    Ok(json!({ "items": items }))
}

/// 记一次作答 = 写一条账本事件，并返回该知识点更新后的状态
pub fn record_answer(
    domain: &str,
    packs_dir: &str,
    pack: &str,
    item_id: &str,
    answered: &str,
    source: Option<&str>,
    error_type: Option<&str>,
    confidence: Option<&str>,
) -> Result<Value, String> {
    let d = resolve_domain(domain);
    let p = resolve_packs(packs_dir);
    let node = learn::node_id(&d)?;
    let out = learn::record_answer(&d, &p, &node, pack, item_id, answered, source.unwrap_or("quiz"), None)?;
    // 账本变了，派生文件随之刷新
    let _ = learn::write_user_md(&d, &p);
    Ok(json!({
        "ok": out.ok,
        "correct": out.event.correct,
        "kc": out.kc_state,
        "nextDue": out.next_due,
        "eventId": out.event.id,
    }))
}

pub fn learn_sync(domain: &str, packs_dir: &str) -> Result<Value, String> {
    let d = resolve_domain(domain);
    let p = resolve_packs(packs_dir);
    learn::sync(&d, &p)
}

pub fn learn_delegate(domain: &str, packs_dir: &str) -> Result<Value, String> {
    let d = resolve_domain(domain);
    let p = resolve_packs(packs_dir);
    let node = learn::node_id(&d)?;
    learn::export_wrong_delegation(&d, &p, &node, &learn::today())
}

pub fn learn_review(config_path: &Path, domain: &str, packs_dir: &str, limit: Option<usize>) -> Result<Value, String> {
    let d = resolve_domain(domain);
    let p = resolve_packs(packs_dir);
    let cfg = config::load(config_path);
    let node = learn::node_id(&d)?;
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
    Ok(json!({ "processed": processed, "pending_before": pending.len() }))
}

pub fn learn_plan(domain: &str, action: &str, text: Option<&str>, task_id: Option<&str>) -> Result<Value, String> {    let d = resolve_domain(domain);
    let node = learn::node_id(&d)?;
    match action {
        "add" => Ok(json!({ "added": learn::plan_add(&d, &node, text.unwrap_or(""))? })),
        "done" => {
            learn::plan_done(&d, &node, task_id.unwrap_or(""))?;
            Ok(json!({ "done": task_id }))
        }
        _ => Ok(json!({ "plan": learn::plan_list(&d) })),
    }
}

/* ══════════ 会话（chat-first：侧栏=对话历史，学科自动判定） ══════════ */

pub fn chat_list(domain: &str) -> Result<Value, String> {
    Ok(crate::chat::list(&resolve_domain(domain)))
}

pub fn chat_get(domain: &str, id: &str) -> Result<Value, String> {
    crate::chat::get(&resolve_domain(domain), id)
}

pub fn chat_new(domain: &str, title: &str) -> Result<Value, String> {
    crate::chat::new_chat(&resolve_domain(domain), title)
}

pub fn chat_append(domain: &str, id: &str, msg: &Value) -> Result<Value, String> {
    crate::chat::append(&resolve_domain(domain), id, msg)
}

pub fn chat_rename(domain: &str, id: &str, title: &str) -> Result<Value, String> {
    crate::chat::rename(&resolve_domain(domain), id, title)
}

pub fn chat_delete(domain: &str, id: &str) -> Result<Value, String> {
    crate::chat::delete(&resolve_domain(domain), id)
}

/// 依据一句话判定学科：返回 { pack, name, why, score }
pub fn detect_subject(domain: &str, text: &str, packs_dir: &str) -> Result<Value, String> {
    let packs = resolve_packs(packs_dir);
    let (pack, why, score) = crate::chat::detect_subject(text, &packs);
    let name = if pack.is_empty() {
        String::new()
    } else {
        let meta = std::fs::read_to_string(packs.join(&pack).join("subject.json")).unwrap_or_default();
        serde_json::from_str::<Value>(&meta)
            .ok()
            .and_then(|v| v.get("name").and_then(|x| x.as_str()).map(|s| s.to_string()))
            .unwrap_or_else(|| pack.clone())
    };
    let _ = domain;
    Ok(serde_json::json!({ "pack": pack, "name": name, "why": why, "score": score }))
}

/* ══════════ 判分即落账（讲解检测题 / 学习页 followup） ══════════ */

/// 无题库 item 的判分（讲解里的检测题）：把结果写进账本，环路才闭合。
pub fn record_judged(
    domain: &str,
    packs_dir: &str,
    pack: &str,
    kc_id: &str,
    synthetic_id: &str,
    answered: &str,
    ok: bool,
    source: &str,
    error_type: Option<&str>,
    confidence: Option<&str>,
) -> Result<Value, String> {
    let d = resolve_domain(domain);
    let p = resolve_packs(packs_dir);
    let node = learn::node_id(&d)?;
    learn::record_judged(
        &d,
        &p,
        &node,
        pack,
        kc_id,
        synthetic_id,
        answered,
        ok,
        source,
        error_type.map(|s| s.to_string()),
        confidence.map(|s| s.to_string()),
    )
}

/// 记录一次「讲解已展示」（A3 留痕）
pub fn record_explain(domain: &str, pack: &str, kc_id: &str, model: &str, source: &str) -> Result<Value, String> {
    let d = resolve_domain(domain);
    let node = learn::node_id(&d)?;
    learn::record_explain(&d, &node, pack, kc_id, model, source)
}

pub fn verify_ledger(domain: &str, packs_dir: &str) -> Result<Value, String> {
    let d = resolve_domain(domain);
    let p = resolve_packs(packs_dir);
    Ok(learn::verify_ledger(&d, &p))
}

pub fn export_report(domain: &str, packs_dir: &str) -> Result<Value, String> {
    let d = resolve_domain(domain);
    let p = resolve_packs(packs_dir);
    learn::weekly_report(&d, &p)
}
