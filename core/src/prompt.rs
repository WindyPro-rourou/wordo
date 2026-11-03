//! 提示词装配：把 prompt-pack/1 与当前学科包拼成一次请求的 system + user。
//! 规范随代码编译内嵌（include_str!）——保证「规范三件套与实现同版本」。

use serde_json::{json, Value};
use std::collections::HashSet;
use std::fs;
use std::path::Path;

const PROMPT_TEMPLATE: &str = include_str!("../../specs/prompt-pack/1/PROMPT.md");

/// 组装：system = 前置提示词（注入阅读方法）+ user = 任务与载荷
pub fn build(task: &str, pack: &Path, payload: &Value) -> Result<Value, String> {
    let guide = fs::read_to_string(pack.join("GUIDE.md")).unwrap_or_default();
    let kc_json = fs::read_to_string(pack.join("tree").join("kc.json")).unwrap_or_default();
    let items_index = items_index(pack);

    let injected = format!(
        "{guide}\n\n### 本包知识点表（kc.json）\n```json\n{kc_json}\n```\n\n### 本包题目索引\n```json\n{items_index}\n```\n\n### 学习者状态\n（本轮暂为空；user.md 接入后在此注入）"
    );
    let system = PROMPT_TEMPLATE.replace("{{READING_GUIDE}}", &injected);
    let user = json!({ "task": task, "payload": payload }).to_string();
    Ok(json!({ "system": system, "user": user, "task": task }))
}

/// 题目索引（id + 挂载知识点 + 题干），供模型引用合法 id
fn items_index(pack: &Path) -> String {
    let mut out = Vec::new();
    if let Ok(rd) = fs::read_dir(pack.join("items")) {
        let mut files: Vec<_> = rd
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.extension().map_or(false, |x| x == "json"))
            .collect();
        files.sort();
        for f in files {
            if let Ok(t) = fs::read_to_string(&f) {
                if let Ok(v) = serde_json::from_str::<Value>(&t) {
                    out.push(json!({
                        "id": v.get("id"),
                        "kc_ids": v.get("kc_ids"),
                        "stem": v.get("stem"),
                        "answer": v.get("answer"),
                    }));
                }
            }
        }
    }
    serde_json::to_string_pretty(&out).unwrap_or_default()
}

/// 本包全部合法知识点 id（用于输出校验的引用完整性）
pub fn kc_id_set(pack: &Path) -> HashSet<String> {
    let mut set = HashSet::new();
    if let Ok(t) = fs::read_to_string(pack.join("tree").join("kc.json")) {
        if let Ok(Value::Array(arr)) = serde_json::from_str::<Value>(&t) {
            for kc in arr {
                if let Some(id) = kc.get("id").and_then(|v| v.as_str()) {
                    set.insert(id.to_string());
                }
            }
        }
    }
    set
}
