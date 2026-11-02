//! 数据加载：把学科包读成结构化 JSON，供 GUI / 未来同步层消费。
//! 遵循「文本为源」：这里只读文本，不做任何缓存落盘。

use serde_json::{json, Value};
use std::fs;
use std::path::Path;

fn read_json(path: &Path) -> Result<Value, String> {
    let t = fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
    serde_json::from_str(&t).map_err(|e| format!("{}: {e}", path.display()))
}

/// 扫描 packs/ 目录，列出全部学科包（含校验摘要）
pub fn discover_packs(packs_dir: &Path) -> Value {
    let mut packs: Vec<Value> = Vec::new();
    if let Ok(rd) = fs::read_dir(packs_dir) {
        let mut dirs: Vec<std::path::PathBuf> = rd
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.join("subject.json").is_file())
            .collect();
        dirs.sort();
        for p in dirs {
            let meta = read_json(&p.join("subject.json")).unwrap_or(Value::Null);
            let report = crate::validate::validate_pack(&p);
            packs.push(json!({
                "path": p.display().to_string(),
                "subjectId": meta.get("id").cloned().unwrap_or(Value::Null),
                "name": meta.get("name").cloned().unwrap_or(Value::Null),
                "version": meta.get("version").cloned().unwrap_or(Value::Null),
                "description": meta.get("description").cloned().unwrap_or(Value::Null),
                "errors": report.error_count,
                "warnings": report.warning_count,
                "kcCount": report.kc_count,
                "itemCount": report.item_count,
                "coveragePct": report.coverage_pct,
            }));
        }
    }
    json!({ "packsDir": packs_dir.display().to_string(), "packs": packs })
}

/// 加载单个学科包的全部内容 + 校验报告
pub fn load_pack(pack: &Path) -> Result<Value, String> {
    let meta = read_json(&pack.join("subject.json"))?;
    let kcs = read_json(&pack.join("tree").join("kc.json"))?;
    let prereqs = read_json(&pack.join("tree").join("prereq.json"))
        .unwrap_or_else(|_| Value::Array(vec![]));

    let mut items: Vec<Value> = Vec::new();
    let items_dir = pack.join("items");
    if let Ok(rd) = fs::read_dir(&items_dir) {
        let mut files: Vec<std::path::PathBuf> = rd
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.extension().map_or(false, |x| x == "json"))
            .collect();
        files.sort();
        for f in files {
            if let Ok(v) = read_json(&f) {
                items.push(v);
            }
        }
    }

    let materials: Vec<Value> = list_materials(pack);

    let report = crate::validate::validate_pack(pack);
    let report_v = serde_json::to_value(&report).map_err(|e| e.to_string())?;

    Ok(json!({
        "meta": meta,
        "kcs": kcs,
        "prereqs": prereqs,
        "items": items,
        "materials": materials,
        "report": report_v,
    }))
}

/// 列出 material/ 下的讲解文件（返回 front-matter 摘要 + 正文）
fn list_materials(pack: &Path) -> Vec<Value> {
    let dir = pack.join("material");
    let mut out: Vec<Value> = Vec::new();
    if let Ok(rd) = fs::read_dir(&dir) {
        let mut files: Vec<std::path::PathBuf> = rd
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.extension().map_or(false, |x| x == "md"))
            .collect();
        files.sort();
        for f in files {
            if let Ok(text) = fs::read_to_string(&f) {
                let (front, body) = split_front_matter(&text);
                out.push(json!({
                    "file": f.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default(),
                    "front": front,
                    "body": body,
                }));
            }
        }
    }
    out
}

/// 极简 front-matter 拆分：--- 包围的 YAML 块原样返回（解析交给前端/未来 serde_yaml）
fn split_front_matter(text: &str) -> (Value, String) {
    let trimmed = text.trim_start();
    if let Some(rest) = trimmed.strip_prefix("---") {
        if let Some(end) = rest.find("\n---") {
            let yaml = &rest[..end];
            let body = rest[end + 4..].trim_start_matches(['-', '\n']).to_string();
            let mut map = serde_json::Map::new();
            for line in yaml.lines() {
                let line = line.trim();
                if let Some((k, v)) = line.split_once(':') {
                    let v = v.trim().trim_matches(|c| c == '[' || c == ']').trim();
                    let items: Vec<Value> = v
                        .split(',')
                        .map(|s| Value::String(s.trim().to_string()))
                        .collect();
                    map.insert(k.trim().to_string(), Value::Array(items));
                }
            }
            return (Value::Object(map), body);
        }
    }
    (Value::Null, text.to_string())
}
