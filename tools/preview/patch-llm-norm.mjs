import fs from "node:fs";
const P="core/src/llm.rs";
let t=fs.readFileSync(P,"utf8");
if(!t.includes("fn normalize_explain")){
  t += `
/* ══════════ 确定性归一化（与预览后端同逻辑） ══════════ */

/// 检测题改为「从题库选」：保证答案正确、且跨模型一致
pub fn normalize_explain(pack: &Path, kc_id: &str, data: &mut Value) {
    let items_dir = pack.join("items");
    let Ok(rd) = std::fs::read_dir(&items_dir) else { return };
    let mut files: Vec<std::path::PathBuf> = rd
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().map_or(false, |x| x == "json"))
        .collect();
    files.sort();
    for f in files {
        let Ok(txt) = std::fs::read_to_string(&f) else { continue };
        let Ok(it) = serde_json::from_str::<Value>(&txt) else { continue };
        let matched = it
            .get("kc_ids")
            .and_then(|v| v.as_array())
            .map(|a| a.iter().any(|k| k.as_str() == Some(kc_id)))
            .unwrap_or(false);
        if !matched {
            continue;
        }
        let Some(opts) = it.get("options").and_then(|v| v.as_array()) else { continue };
        if opts.is_empty() {
            continue;
        }
        let texts: Vec<Value> = opts
            .iter()
            .map(|o| Value::String(o.get("text").and_then(|v| v.as_str()).unwrap_or("").to_string()))
            .collect();
        if let Some(obj) = data.as_object_mut() {
            obj.insert(
                "followup_question".to_string(),
                serde_json::json!({
                    "stem": it.get("stem").cloned().unwrap_or(Value::String(String::new())),
                    "options": texts,
                    "answer": it.get("answer").cloned().unwrap_or(Value::String(String::new())),
                }),
            );
            if let Some(w) = obj.get_mut("warnings").and_then(|v| v.as_array_mut()) {
                w.push(Value::String("检测题取自题库（确定性来源），非模型生成".to_string()));
            }
        }
        return;
    }
}

/// 建议动作由错因决定（枚举 → 枚举），避免模型自由发挥导致跨模型不一致
pub fn normalize_classify(data: &mut Value) {
    let et = data.get("error_type").and_then(|v| v.as_str()).unwrap_or("");
    let action = match et {
        "none" => "none",
        "knowledge_missing" => "review_prereq",
        "concept_confused" => "split_concept",
        "method_missing" => "drill_similar",
        "calculation_slip" => "retry_later",
        "misread" => "re_explain",
        _ => return,
    };
    if let Some(obj) = data.as_object_mut() {
        obj.insert("suggested_action".to_string(), Value::String(action.to_string()));
    }
}
`;
  fs.writeFileSync(P,t,"utf8"); console.log("✅ rust 归一化函数");
}
// 在 ask/ask_retry 校验通过后套用（两处 return 前统一处理）
if(!t.includes("normalize_explain(pack,")){
  t=t.replace(`    let issues = check(task, pack, &data);
    Ok(AskResult {
        ok: data.is_some() && issues.is_empty(),`,
`    let issues = check(task, pack, &data);
    let mut data = data;
    if let Some(d) = data.as_mut() {
        if issues.is_empty() {
            if task == "explain" {
                let kc = payload.get("kc_id").and_then(|v| v.as_str()).unwrap_or("");
                normalize_explain(pack, kc, d);
            } else if task == "classify-error" {
                normalize_classify(d);
            }
        }
    }
    Ok(AskResult {
        ok: data.is_some() && issues.is_empty(),`);
  fs.writeFileSync(P,t,"utf8"); console.log("✅ rust ask 套用（改 data 为 mut）");
}
