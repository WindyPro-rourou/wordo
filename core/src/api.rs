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
    let raw = packs_dir.trim();
    if !raw.is_empty() {
        return PathBuf::from(raw);
    }
    resolve_default_packs()
}

/// 解析默认学科包目录（不依赖任何硬编码机器路径）：
/// 1) 环境变量 WORDO_PACKS；2) 可执行文件旁 packs/ 与 resources/packs/；
/// 3) 相对当前目录的 packs / ../packs / ../../packs（覆盖 CLI 从仓库根、core/ 与
///    `tauri dev` 从 apps/desktop 启动等情形）。找到含学科包的目录返回其绝对路径。
fn dir_has_pack(dir: &Path) -> bool {
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.flatten() {
            if e.path().join("subject.json").is_file() {
                return true;
            }
        }
    }
    false
}

fn resolve_default_packs() -> PathBuf {
    if let Ok(p) = std::env::var("WORDO_PACKS") {
        if !p.trim().is_empty() {
            return PathBuf::from(p);
        }
    }
    let mut cands: Vec<PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            cands.push(dir.join("packs"));
            cands.push(dir.join("resources").join("packs"));
        }
    }
    cands.push(PathBuf::from("packs"));
    cands.push(PathBuf::from("../packs"));
    cands.push(PathBuf::from("../../packs"));
    for c in &cands {
        if dir_has_pack(c) {
            return std::fs::canonicalize(c).unwrap_or_else(|_| c.clone());
        }
    }
    for c in &cands {
        if c.is_dir() {
            return std::fs::canonicalize(c).unwrap_or_else(|_| c.clone());
        }
    }
    PathBuf::from("packs")
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
    let out = learn::record_answer(
        &d,
        &p,
        &node,
        pack,
        item_id,
        answered,
        source.unwrap_or("quiz"),
        error_type.map(|s| s.to_string()),
        confidence.map(|s| s.to_string()),
    )?;
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

/* ══════════ 新建学科（scaffold_pack）：落实「允许用户新建学科」 ══════════ */

/// 与 validate.rs 的 id 规则一致：小写字母/数字开头，仅含小写字母、数字、点、连字符、下划线。
fn valid_subject_id(id: &str) -> bool {
    let mut chars = id.chars();
    match chars.next() {
        Some(c) if c.is_ascii_lowercase() || c.is_ascii_digit() => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '.' || c == '-' || c == '_')
}

fn guide_md(name: &str) -> String {
    format!(
        "# {name} · 资料阅读方法（GUIDE）\n\n\
> 本文件是本学科包的说明书：人读是手册，喂给模型就是前置提示词的正文。\n\n\
## 1. 这个包教什么、给谁用\n\n（两句话说明学科范围与目标学习者。）\n\n\
## 2. 知识树怎么读\n\n知识点在 `tree/kc.json`，字段：`id`（包内唯一，永不复用）、`name`、`toc`（章节路径数组）、`difficulty`、`bloom`、`aliases`。规范见 `specs/subject-pack/1/SPEC.md`。\n\n\
## 3. 题目怎么读\n\n每题一文件 `items/it_<id>.json`：`type`、`kc_ids`（≥1）、`stem`、`options`、`answer`/`answer_text`、`analysis`、`difficulty`、`origin`、`verification`。\n\n\
## 4. 先修关系怎么读\n\n`tree/prereq.json` 每条边 {{from,to,strength,reason}}：`hard`=不会先修就学不会，`soft`=有帮助。先修图必须是 DAG（有环校验失败）。\n\n\
## 5. 字段词典\n\n（本包自定义字段，若无写「无」。）\n\n\
## 6. 一个完整示例\n\n某知识点 → 挂该知识点的题目 → 讲解素材 `material/<kc_id>.md`。\n"
    )
}

fn slugify(s: &str) -> String {
    let mut out = String::new();
    for ch in s.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
        } else {
            out.push('_');
        }
    }
    let t = out.trim_matches('_').to_string();
    if t.is_empty() {
        "subject".to_string()
    } else {
        t
    }
}

fn starter_material(kc_id: &str, name: &str) -> String {
    format!(
        "---\nkc_id: {kc_id}\nstyles: [intuitive, formal]\n---\n# {name}\n\n\
## 直观理解\n这是新建学科时自动生成的示例讲解，用来验证「讲解→出题→判分→复习」闭环。你可以在 material/ 下替换成真实内容。\n\n\
## 规范表述\n（在这里写这个知识点的严谨定义。）\n\n\
## 常见误解\n- （列出学生常见错误。）\n"
    )
}

/// 在 packs 目录下创建一个符合 subject-pack/1 的最小学科包骨架。
pub fn scaffold_pack(
    packs_dir: &str,
    id: &str,
    name: &str,
    description: Option<&str>,
    author: Option<&str>,
    license: Option<&str>,
) -> Result<Value, String> {
    let dir = resolve_packs(packs_dir);
    let id = id.trim();
    let name = name.trim();
    if !valid_subject_id(id) {
        return Err("学科 id 需为小写反向域名式（如 my.chinese、chinese.junior）".to_string());
    }
    if name.is_empty() {
        return Err("显示名不能为空".to_string());
    }
    let dest = dir.join(id);
    if dest.exists() {
        return Err(format!("学科包已存在：{id}"));
    }
    for sub in ["tree", "items", "material"] {
        std::fs::create_dir_all(dest.join(sub)).map_err(|e| format!("创建目录失败: {e}"))?;
    }
    let meta = json!({
        "id": id,
        "name": name,
        "version": "0.1.0",
        "schema": "subject-pack/1",
        "license": license.unwrap_or("CC-BY-SA-4.0"),
        "author": author.unwrap_or(""),
        "description": description.unwrap_or(""),
        "depends": [],
        "language": "zh-CN",
        "presentation": ["teaching", "qa"],
    });
    let write = |rel: &str, content: &str| -> Result<(), String> {
        std::fs::write(dest.join(rel), content).map_err(|e| format!("写入 {rel} 失败: {e}"))
    };
    // 内置一条示例内容：新建即可跑通「讲解→出题→判分→复习」闭环（示例标注「可删」）。
    let slug = slugify(id);
    let kc_id = format!("kc_{slug}_0001");
    let item_id = format!("it_{slug}_0001");
    let kc_name = "示例知识点（可删）";
    let kc = json!([{
        "id": kc_id.clone(),
        "name": kc_name,
        "toc": ["示例章节"],
        "difficulty": 0.3,
        "bloom": "理解",
        "aliases": ["示例"]
    }]);
    let item = json!({
        "id": item_id.clone(),
        "type": "single_choice",
        "kc_ids": [kc_id.clone()],
        "stem": "这是一道示例题：下面哪个是占位用的正确答案？",
        "options": [
            { "key": "A", "text": "A（示例正确答案）" },
            { "key": "B", "text": "B" },
            { "key": "C", "text": "C" },
            { "key": "D", "text": "D" }
        ],
        "answer": "A",
        "analysis": "新建学科自动生成的示例题；导入真实题目后可在 items/ 下删除本文件。",
        "difficulty": 0.2,
        "origin": { "source_type": "generated", "source_ref": "starter", "redistributable": true },
        "verification": { "answer_checked_by": "human", "human_reviewed": true }
    });
    write("subject.json", &format!("{}\n", serde_json::to_string_pretty(&meta).unwrap()))?;
    write("tree/kc.json", &format!("{}\n", serde_json::to_string_pretty(&kc).unwrap()))?;
    write("tree/prereq.json", "[]\n")?;
    write(&format!("items/{item_id}.json"), &format!("{}\n", serde_json::to_string_pretty(&item).unwrap()))?;
    write(&format!("material/{kc_id}.md"), &starter_material(&kc_id, kc_name))?;
    write("GUIDE.md", &guide_md(name))?;
    Ok(json!({ "ok": true, "path": dest.display().to_string(), "pack": id, "name": name, "starter": true }))
}

#[cfg(test)]
mod scaffold_tests {
    use super::*;

    fn tmp_root() -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!(
            "wordo-scaffold-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .subsec_nanos()
        ));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn scaffold_creates_valid_pack() {
        let root = tmp_root();
        let packs = root.join("packs");
        std::fs::create_dir_all(&packs).unwrap();
        let out = scaffold_pack(
            packs.to_str().unwrap(),
            "my.chinese",
            "我的语文",
            Some("测试用"),
            Some("WORDO"),
            None,
        )
        .expect("scaffold should succeed");
        assert_eq!(out.get("ok").and_then(|v| v.as_bool()), Some(true));
        let pack = packs.join("my.chinese");
        assert!(pack.join("subject.json").is_file());
        assert!(pack.join("GUIDE.md").is_file());
        assert!(pack.join("tree/kc.json").is_file());
        assert!(pack.join("tree/prereq.json").is_file());
        assert!(pack.join("items").is_dir());
        // 生成物应能被核心校验器接受（空包 0 error）
        let report = crate::validate::validate_pack(&pack);
        assert_eq!(report.error_count, 0, "scaffolded pack should have 0 errors");
        // 重复创建应报错
        assert!(scaffold_pack(packs.to_str().unwrap(), "my.chinese", "x", None, None, None).is_err());
        // 非法 id 拒绝
        assert!(scaffold_pack(packs.to_str().unwrap(), "BadId", "x", None, None, None).is_err());
        let _ = std::fs::remove_dir_all(&root);
    }
}
