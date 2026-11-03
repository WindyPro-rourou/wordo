//! 提示词装配：把 prompt-pack/1 与学科包拼成一次请求的 system + user。
//! 规范随代码编译内嵌（include_str!）——保证「规范三件套与实现同版本」。
//!
//! `pack` 参数既可以是**单个学科包目录**，也可以是**学科包根目录**（T3 委托处理跨包时）。
//! 注入顺序：GUIDE.md（怎么读）→ kc.json（知识点表）→ 题目索引 →
//!          **本次涉及知识点的预置讲解素材** → **学习者状态（user.md 摘要）**

use serde_json::{json, Value};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

const PROMPT_TEMPLATE: &str = include_str!("../../specs/prompt-pack/1/PROMPT.md");
/// 素材注入总量上限（字符），防止超长把上下文挤爆
const MATERIAL_BUDGET: usize = 14000;

pub fn build(task: &str, pack: &Path, payload: &Value) -> Result<Value, String> {
    let kcs = payload_kc_ids(payload);
    let packs = resolve_packs(pack);
    if packs.is_empty() {
        return Err(format!("{} 下没有找到学科包", pack.display()));
    }

    let mut guide = String::new();
    let mut kc_block = String::new();
    let mut items_block = String::new();
    let mut mat_block = String::new();
    let mut used = 0usize;

    for p in &packs {
        let ids = kc_id_set(p);
        let relevant = packs.len() == 1 || kcs.iter().any(|k| ids.contains(k));
        if !relevant {
            continue;
        }
        let name = p.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        if let Ok(g) = fs::read_to_string(p.join("GUIDE.md")) {
            guide.push_str(&format!("\n\n#### 学科包 {name} 的 GUIDE.md\n{g}"));
        }
        if let Ok(k) = fs::read_to_string(p.join("tree").join("kc.json")) {
            kc_block.push_str(&format!("\n```json\n{k}\n```\n"));
        }
        items_block.push_str(&format!("\n// {name}\n{}\n", items_index(p)));
        for kc in &kcs {
            if !ids.contains(kc) {
                continue;
            }
            if let Some(m) = material_for(p, kc) {
                if used + m.len() > MATERIAL_BUDGET {
                    mat_block.push_str(&format!("\n（{kc} 的素材超预算，未注入）\n"));
                    continue;
                }
                used += m.len();
                mat_block.push_str("\n\n### 预置讲解素材（**必须以它为准**：术语、例句、易错点都要与之一致；可补充但不得矛盾）\n");
                mat_block.push_str(&m);
            }
        }
    }
    if mat_block.is_empty() {
        mat_block.push_str("\n\n### 预置讲解素材\n（本次涉及的知识点暂无素材——请依据 kc.json 与题目索引组织内容，并在 warnings 里说明）");
    }

    let learner = payload
        .get("_learner_md")
        .and_then(|v| v.as_str())
        .map(|s| truncate(s, 6000))
        .unwrap_or_else(|| "（本轮未注入；见 user.md）".to_string());

    let injected = format!(
        "{guide}\n\n### 知识点表（kc.json）\n{kc_block}\n### 题目索引\n```json\n{items_block}\n```{mat_block}\n\n### 学习者状态（user.md，个性化依据）\n{learner}"
    );
    let system = PROMPT_TEMPLATE.replace("{{READING_GUIDE}}", &injected);
    let user = json!({ "task": task, "payload": payload }).to_string();
    Ok(json!({ "system": system, "user": user, "task": task }))
}

fn is_pack(p: &Path) -> bool {
    p.join("subject.json").exists() || p.join("tree").join("kc.json").exists()
}

/// pack 既可能是单包，也可能是包根目录
fn resolve_packs(pack: &Path) -> Vec<PathBuf> {
    if is_pack(pack) {
        return vec![pack.to_path_buf()];
    }
    let mut v: Vec<PathBuf> = match fs::read_dir(pack) {
        Ok(rd) => rd
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.is_dir() && is_pack(p))
            .collect(),
        Err(_) => Vec::new(),
    };
    v.sort();
    v
}

fn truncate(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        return s.to_string();
    }
    let t: String = s.chars().take(n).collect();
    format!("{t}\n…（截断）")
}

/// 从 payload 里收集本次涉及的知识点 id：kc_id / kc_ids[] / items[].kc_id
pub fn payload_kc_ids(payload: &Value) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut push = |s: &str| {
        if !s.is_empty() && !out.iter().any(|x| x == s) {
            out.push(s.to_string());
        }
    };
    if let Some(k) = payload.get("kc_id").and_then(|v| v.as_str()) {
        push(k);
    }
    if let Some(arr) = payload.get("kc_ids").and_then(|v| v.as_array()) {
        for k in arr {
            if let Some(s) = k.as_str() {
                push(s);
            }
        }
    }
    if let Some(arr) = payload.get("items").and_then(|v| v.as_array()) {
        for it in arr {
            if let Some(s) = it.get("kc_id").and_then(|v| v.as_str()) {
                push(s);
            }
        }
    }
    out
}

/// 该知识点对应的预置讲解素材：material/*.md 的 front-matter 中 `kc_id: <id>` 命中即取
fn material_for(pack: &Path, kc_id: &str) -> Option<String> {
    let want = format!("kc_id: {kc_id}");
    let rd = fs::read_dir(pack.join("material")).ok()?;
    let mut files: Vec<_> = rd
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().map_or(false, |x| x == "md"))
        .collect();
    files.sort();
    for p in files {
        let Ok(t) = fs::read_to_string(&p) else { continue };
        if t.lines().take(12).any(|l| l.trim() == want) {
            let name = p.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
            return Some(format!("（文件：material/{name}）\n{t}"));
        }
    }
    None
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

/// 单个包的全部合法知识点 id
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

/// 多个包合并的知识点 id 集合（T3 委托处理跨包）
pub fn kc_id_set_multi(packs_dir: &Path) -> HashSet<String> {
    let mut set = HashSet::new();
    for p in resolve_packs(packs_dir) {
        for id in kc_id_set(&p) {
            set.insert(id);
        }
    }
    set
}

/// 校验用的知识点集合：单包优先，其次按包根目录合并
pub fn kc_scope(pack: &Path) -> HashSet<String> {
    let s = kc_id_set(pack);
    if s.is_empty() {
        kc_id_set_multi(pack)
    } else {
        s
    }
}
