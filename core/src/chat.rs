//! 会话（chat-first）：**事件化**存储，避免整文件覆盖写导致多设备丢消息。
//!
//! 目录结构（都在账号域内，随同步盘同步）：
//!   chats/<id>/meta.json          仅 created
//!   chats/<id>/<node>.jsonl       每节点只追加自己的事件（消息 / 重命名 / 删除墓碑）
//!
//! 读取 = 合并所有节点日志，按 (ts, msg_id) 排序去重；因此：
//!  - 没有读-改-写，不会互相覆盖；
//!  - 删除写墓碑事件，同步后不会「复活」；
//!  - 任何设备都能看到全部消息。

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMsg {
    #[serde(default)]
    pub id: String,
    pub role: String,
    #[serde(default)]
    pub kind: String,
    pub text: String,
    pub ts: String,
    #[serde(default)]
    pub data: Value,
    #[serde(default)]
    pub pack: String,
    #[serde(default)]
    pub node: String,
}

fn now() -> String {
    chrono::Local::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

fn chats_root(domain: &Path) -> PathBuf {
    domain.join("chats")
}
fn chat_dir(domain: &Path, id: &str) -> PathBuf {
    chats_root(domain).join(id)
}
fn safe_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 80 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn new_msg_id(node: &str) -> String {
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("m{ms}-{node}")
}

pub fn new_chat_id(domain: &Path) -> String {
    let node = crate::learn::node_id(domain).unwrap_or_else(|_| "local".into());
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    // 带节点后缀：跨设备同毫秒也不会撞 id
    format!("c{ms}-{node}")
}

/// 该会话全部事件（合并所有节点日志，按时间排序）
fn read_events(dir: &Path) -> Vec<ChatMsg> {
    let mut out: Vec<ChatMsg> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    if let Ok(rd) = fs::read_dir(dir) {
        let mut files: Vec<PathBuf> = rd
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.extension().map_or(false, |x| x == "jsonl"))
            .collect();
        files.sort();
        for f in files {
            let Ok(t) = fs::read_to_string(&f) else { continue };
            for line in t.lines() {
                let l = line.trim();
                if l.is_empty() {
                    continue;
                }
                if let Ok(m) = serde_json::from_str::<ChatMsg>(l) {
                    if seen.insert(m.id.clone()) {
                        out.push(m);
                    }
                }
            }
        }
    }
    out.sort_by(|a, b| a.ts.cmp(&b.ts).then(a.id.cmp(&b.id)));
    out
}

fn is_deleted(dir: &Path) -> bool {
    read_events(dir).iter().any(|m| m.kind == "__deleted")
}

fn append_line(dir: &Path, node: &str, msg: &Value) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| format!("创建会话目录失败: {e}"))?;
    let mut m = msg.clone();
    let obj = m.as_object_mut().ok_or("消息必须是对象")?;
    obj.entry("id".to_string()).or_insert_with(|| Value::String(new_msg_id(node)));
    obj.entry("ts".to_string()).or_insert_with(|| Value::String(now()));
    obj.entry("node".to_string()).or_insert_with(|| Value::String(node.to_string()));
    obj.entry("role".to_string()).or_insert_with(|| Value::String("user".into()));
    obj.entry("kind".to_string()).or_insert_with(|| Value::String("text".into()));
    obj.entry("text".to_string()).or_insert_with(|| Value::String(String::new()));
    use std::io::Write;
    let f = dir.join(format!("{node}.jsonl"));
    let mut fh = fs::OpenOptions::new().create(true).append(true).open(&f).map_err(|e| e.to_string())?;
    writeln!(fh, "{}", serde_json::to_string(&m).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    Ok(())
}

fn meta(domain: &Path, id: &str) -> Value {
    let p = chat_dir(domain, id).join("meta.json");
    fs::read_to_string(p)
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .unwrap_or(Value::Null)
}

/* ══════════ 对外 API ══════════ */

pub fn list(domain: &Path) -> Value {
    let mut out: Vec<Value> = Vec::new();
    let Ok(rd) = fs::read_dir(chats_root(domain)) else { return json!({ "chats": [] }) };
    for e in rd.filter_map(|e| e.ok()) {
        let dir = e.path();
        if !dir.is_dir() {
            continue;
        }
        let id = dir.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        if !safe_id(&id) || is_deleted(&dir) {
            continue;
        }
        let evs = read_events(&dir);
        if evs.is_empty() {
            continue;
        }
        // 标题：最后一条 rename，否则第一条 user 消息前 24 字
        let title = evs
            .iter()
            .filter(|m| m.kind == "__rename")
            .last()
            .map(|m| m.text.clone())
            .unwrap_or_else(|| {
                evs.iter()
                    .find(|m| m.role == "user")
                    .map(|m| m.text.chars().take(24).collect())
                    .unwrap_or_default()
            });
        let pack = evs.iter().rev().map(|m| m.pack.clone()).find(|p| !p.is_empty()).unwrap_or_default();
        let updated = evs.last().map(|m| m.ts.clone()).unwrap_or_default();
        let count = evs.iter().filter(|m| m.kind != "__rename" && m.kind != "__deleted").count();
        out.push(json!({ "id": id, "title": title, "updated": updated, "pack": pack, "count": count }));
    }
    out.sort_by(|a, b| {
        b.get("updated").and_then(|v| v.as_str()).unwrap_or("")
            .cmp(a.get("updated").and_then(|v| v.as_str()).unwrap_or(""))
    });
    json!({ "chats": out })
}

pub fn get(domain: &Path, id: &str) -> Result<Value, String> {
    if !safe_id(id) {
        return Err("非法会话 id".into());
    }
    let dir = chat_dir(domain, id);
    if !dir.is_dir() {
        return Err(format!("找不到会话 {id}"));
    }
    let evs = read_events(&dir);
    let msgs: Vec<Value> = evs
        .iter()
        .filter(|m| m.kind != "__rename" && m.kind != "__deleted")
        .map(|m| {
            json!({
                "id": m.id, "role": m.role, "kind": m.kind, "text": m.text,
                "ts": m.ts, "data": m.data, "pack": m.pack, "node": m.node,
            })
        })
        .collect();
    let title = evs
        .iter()
        .filter(|m| m.kind == "__rename")
        .last()
        .map(|m| m.text.clone())
        .unwrap_or_else(|| {
            evs.iter().find(|m| m.role == "user").map(|m| m.text.chars().take(24).collect()).unwrap_or_default()
        });
    let pack = evs.iter().rev().map(|m| m.pack.clone()).find(|p| !p.is_empty()).unwrap_or_default();
    let m = meta(domain, id);
    let created = m.get("created").and_then(|v| v.as_str()).unwrap_or("").to_string();
    Ok(json!({ "id": id, "title": title, "pack": pack, "created": created, "messages": msgs }))
}

pub fn new_chat(domain: &Path, title: &str) -> Result<Value, String> {
    let id = new_chat_id(domain);
    let dir = chat_dir(domain, &id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    fs::write(dir.join("meta.json"), json!({ "id": id, "created": now() }).to_string()).map_err(|e| e.to_string())?;
    if !title.trim().is_empty() {
        let node = crate::learn::node_id(domain).unwrap_or_else(|_| "local".into());
        append_line(&dir, &node, &json!({ "role": "system", "kind": "__rename", "text": title }))?;
    }
    get(domain, &id)
}

pub fn append(domain: &Path, id: &str, msg: &Value) -> Result<Value, String> {
    let id = if safe_id(id) { id.to_string() } else { new_chat_id(domain) };
    let dir = chat_dir(domain, &id);
    let node = crate::learn::node_id(domain).unwrap_or_else(|_| "local".into());
    // 新会话顺手写 meta
    if !dir.is_dir() {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        fs::write(dir.join("meta.json"), json!({ "id": id, "created": now() }).to_string()).map_err(|e| e.to_string())?;
    }
    append_line(&dir, &node, msg)?;
    get(domain, &id)
}

pub fn rename(domain: &Path, id: &str, title: &str) -> Result<Value, String> {
    if !safe_id(id) {
        return Err("非法会话 id".into());
    }
    let dir = chat_dir(domain, id);
    if !dir.is_dir() {
        return Err(format!("找不到会话 {id}"));
    }
    let node = crate::learn::node_id(domain).unwrap_or_else(|_| "local".into());
    append_line(&dir, &node, &json!({ "role": "system", "kind": "__rename", "text": title.trim() }))?;
    get(domain, id)
}

pub fn delete(domain: &Path, id: &str) -> Result<Value, String> {
    if !safe_id(id) {
        return Err("非法会话 id".into());
    }
    let dir = chat_dir(domain, id);
    if !dir.is_dir() {
        return Ok(json!({ "deleted": false, "id": id }));
    }
    // 写墓碑事件（不是物理删除），同步后不会被旧副本「复活」
    let node = crate::learn::node_id(domain).unwrap_or_else(|_| "local".into());
    append_line(&dir, &node, &json!({ "role": "system", "kind": "__deleted", "text": "" }))?;
    Ok(json!({ "deleted": true, "id": id }))
}

/* ══════════ 学科自动判定 ══════════ */

pub fn detect_subject(text: &str, packs_dir: &Path) -> (String, String, u32) {
    let t = text.to_lowercase();
    let mut best: (String, String, u32) = (String::new(), String::new(), 0);
    let Ok(rd) = fs::read_dir(packs_dir) else { return best };
    let mut dirs: Vec<PathBuf> = rd
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.join("subject.json").is_file())
        .collect();
    dirs.sort();
    for p in dirs {
        let pack_id = p.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        let meta = fs::read_to_string(p.join("subject.json"))
            .ok()
            .and_then(|s| serde_json::from_str::<Value>(&s).ok())
            .unwrap_or(Value::Null);
        let name = meta.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let mut score: u32 = 0;
        let mut why = String::new();
        if let Ok(t2) = fs::read_to_string(p.join("tree").join("kc.json")) {
            if let Ok(Value::Array(arr)) = serde_json::from_str::<Value>(&t2) {
                for kc in arr {
                    let kn = kc.get("name").and_then(|v| v.as_str()).unwrap_or("");
                    if kn.chars().count() >= 2 && t.contains(&kn.to_lowercase()) {
                        score += 5;
                        if why.is_empty() {
                            why = format!("命中知识点「{kn}」");
                        }
                    }
                }
            }
        }
        if !name.is_empty() && t.contains(&name.to_lowercase()) {
            score += 3;
            if why.is_empty() {
                why = format!("提到学科「{name}」");
            }
        }
        let short = name.replace("高中", "").replace("初中", "");
        if short.chars().count() >= 1 && t.contains(&short.to_lowercase()) {
            score += 1;
        }
        if t.contains(&pack_id.to_lowercase()) {
            score += 2;
        }
        if score > best.2 {
            best = (pack_id, why, score);
        }
    }
    best
}
