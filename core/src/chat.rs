//! 会话（对话历史）：chat-first 的存储层。
//! 每个会话一个 JSON 文件，放在账号域 `chats/` 下 —— 因此会话天然随域同步、任何设备可读可续。
//! 学科包不再是用户要选的东西：第一句话之后由 `detect_subject` 自动判定。

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Msg {
    /// user | assistant | system
    pub role: String,
    /// text | explain | quiz | classify | note
    #[serde(default)]
    pub kind: String,
    pub text: String,
    pub ts: String,
    /// 结构化附加（讲解结果/题目等），可空
    #[serde(default)]
    pub data: Value,
    /// 这条消息对应的学科包（便于续聊时恢复上下文）
    #[serde(default)]
    pub pack: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Chat {
    pub id: String,
    pub title: String,
    pub created: String,
    pub updated: String,
    #[serde(default)]
    pub pack: String,
    #[serde(default)]
    pub messages: Vec<Msg>,
}

fn now() -> String {
    chrono::Local::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

fn chats_dir(domain: &Path) -> PathBuf {
    domain.join("chats")
}

fn chat_path(domain: &Path, id: &str) -> PathBuf {
    chats_dir(domain).join(format!("{id}.json"))
}

fn safe_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

pub fn ensure(domain: &Path) -> Result<(), String> {
    fs::create_dir_all(chats_dir(domain)).map_err(|e| format!("创建 chats 目录失败: {e}"))
}

pub fn new_id() -> String {
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("c{ms}")
}

/// 会话列表：只返回摘要（id/title/updated/pack/count），按更新时间倒序
pub fn list(domain: &Path) -> Value {
    let mut out: Vec<Value> = Vec::new();
    if let Ok(rd) = fs::read_dir(chats_dir(domain)) {
        for e in rd.filter_map(|e| e.ok()) {
            let p = e.path();
            if p.extension().map_or(true, |x| x != "json") {
                continue;
            }
            let Ok(t) = fs::read_to_string(&p) else { continue };
            let Ok(c) = serde_json::from_str::<Chat>(&t) else { continue };
            let last_user = c
                .messages
                .iter()
                .rev()
                .find(|m| m.role == "user")
                .map(|m| m.text.clone())
                .unwrap_or_default();
            out.push(json!({
                "id": c.id,
                "title": if c.title.trim().is_empty() { last_user } else { c.title.clone() },
                "updated": c.updated,
                "pack": c.pack,
                "count": c.messages.len(),
            }));
        }
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
    let p = chat_path(domain, id);
    let t = fs::read_to_string(&p).map_err(|_| format!("找不到会话 {id}"))?;
    let c: Chat = serde_json::from_str(&t).map_err(|e| format!("会话文件损坏: {e}"))?;
    serde_json::to_value(c).map_err(|e| e.to_string())
}

pub fn new_chat(domain: &Path, title: &str) -> Result<Value, String> {
    ensure(domain)?;
    let c = Chat {
        id: new_id(),
        title: title.trim().to_string(),
        created: now(),
        updated: now(),
        pack: String::new(),
        messages: Vec::new(),
    };
    let t = serde_json::to_string_pretty(&c).map_err(|e| e.to_string())?;
    fs::write(chat_path(domain, &c.id), t).map_err(|e| e.to_string())?;
    serde_json::to_value(c).map_err(|e| e.to_string())
}

/// 追加一条消息（不存在则建会话），返回最新会话
pub fn append(domain: &Path, id: &str, msg: &Value) -> Result<Value, String> {
    ensure(domain)?;
    let mut c = if safe_id(id) && chat_path(domain, id).exists() {
        let t = fs::read_to_string(chat_path(domain, id)).map_err(|e| e.to_string())?;
        serde_json::from_str::<Chat>(&t).map_err(|e| format!("会话文件损坏: {e}"))?
    } else {
        Chat {
            id: if safe_id(id) { id.to_string() } else { new_id() },
            title: String::new(),
            created: now(),
            updated: now(),
            pack: String::new(),
            messages: Vec::new(),
        }
    };

    let role = msg.get("role").and_then(|v| v.as_str()).unwrap_or("user").to_string();
    let kind = msg.get("kind").and_then(|v| v.as_str()).unwrap_or("text").to_string();
    let text = msg.get("text").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let pack = msg.get("pack").and_then(|v| v.as_str()).unwrap_or("").to_string();
    if !pack.is_empty() {
        c.pack = pack.clone();
    }
    c.messages.push(Msg {
        role: role.clone(),
        kind,
        text: text.clone(),
        ts: now(),
        data: msg.get("data").cloned().unwrap_or(Value::Null),
        pack,
    });
    // 标题：取第一条用户消息的前 24 个字
    if c.title.trim().is_empty() && role == "user" && !text.trim().is_empty() {
        c.title = text.chars().take(24).collect();
    }
    c.updated = now();
    let t = serde_json::to_string_pretty(&c).map_err(|e| e.to_string())?;
    fs::write(chat_path(domain, &c.id), t).map_err(|e| e.to_string())?;
    serde_json::to_value(c).map_err(|e| e.to_string())
}

pub fn rename(domain: &Path, id: &str, title: &str) -> Result<Value, String> {
    if !safe_id(id) {
        return Err("非法会话 id".into());
    }
    let p = chat_path(domain, id);
    let t = fs::read_to_string(&p).map_err(|_| format!("找不到会话 {id}"))?;
    let mut c: Chat = serde_json::from_str(&t).map_err(|e| e.to_string())?;
    c.title = title.trim().chars().take(60).collect();
    c.updated = now();
    fs::write(&p, serde_json::to_string_pretty(&c).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    Ok(json!({ "renamed": true, "id": c.id, "title": c.title }))
}

pub fn delete(domain: &Path, id: &str) -> Result<Value, String> {
    if !safe_id(id) {
        return Err("非法会话 id".into());
    }
    let p = chat_path(domain, id);
    if p.exists() {
        fs::remove_file(&p).map_err(|e| e.to_string())?;
    }
    Ok(json!({ "deleted": true, "id": id }))
}

/* ══════════ 学科自动判定 ══════════ */

/// 从一句话里判断该用哪个学科包：先按知识点名命中，再按学科名/ id 命中。
/// 返回 (pack_id, 命中依据, 分数)。分数为 0 表示没命中。
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

        // 1) 知识点名命中（最强信号）
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
        // 2) 学科名 / id 命中
        if !name.is_empty() && t.contains(&name.to_lowercase()) {
            score += 3;
            if why.is_empty() {
                why = format!("提到学科「{name}」");
            }
        }
        let short = name.replace("高中", "").replace("初中", "");
        if short.chars().count() >= 1 && t.contains(&short.to_lowercase()) {
            score += 1;
            if why.is_empty() {
                why = format!("提到「{short}」");
            }
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
