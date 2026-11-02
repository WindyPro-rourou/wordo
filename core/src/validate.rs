//! 学科包校验：subject-pack/1 的全部规则。
//! 输出统一的 Issue 列表（错误/警告/提示），以及统计信息。

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::path::Path;

use serde::Serialize;

use crate::model::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    Error,
    Warning,
    #[allow(dead_code)]
    Info,
}

#[derive(Debug, Clone, Serialize)]
pub struct Issue {
    pub level: Level,
    pub file: String,
    pub code: String,
    pub msg: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct KcStat {
    pub kc_id: String,
    pub name: String,
    pub items: usize,
}

#[derive(Debug, Serialize)]
pub struct PackReport {
    pub pack_path: String,
    pub subject_id: Option<String>,
    pub subject_version: Option<String>,
    pub schema: Option<String>,
    pub kc_count: usize,
    pub edge_count: usize,
    pub item_count: usize,
    pub coverage_pct: f64,
    pub error_count: usize,
    pub warning_count: usize,
    pub dangling_kcs: Vec<String>,
    pub per_kc_items: Vec<KcStat>,
    pub issues: Vec<Issue>,
}

fn push(issues: &mut Vec<Issue>, level: Level, file: &str, code: &str, msg: impl Into<String>) {
    issues.push(Issue { level, file: file.to_string(), code: code.to_string(), msg: msg.into() });
}

fn is_error(issues: &[Issue]) -> bool {
    issues.iter().any(|i| i.level == Level::Error)
}

/// id 规则：小写字母/数字开头，允许小写字母、数字、点、连字符、下划线
fn valid_id(s: &str) -> bool {
    let mut chars = s.chars();
    match chars.next() {
        Some(c) if c.is_ascii_lowercase() || c.is_ascii_digit() => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '.' || c == '-' || c == '_')
}

/// 宽松 semver：x.y.z，各段非负整数
fn valid_version(s: &str) -> bool {
    let parts: Vec<&str> = s.split('.').collect();
    parts.len() == 3 && parts.iter().all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
}

/// 先修图环检测（DFS 三色标记），返回一个环路径（若有）
fn find_cycle(nodes: &[String], adj: &BTreeMap<String, Vec<String>>) -> Option<Vec<String>> {
    #[derive(Clone, Copy, PartialEq)]
    enum Color {
        White,
        Gray,
        Black,
    }
    let mut color: HashMap<String, Color> =
        nodes.iter().map(|n| (n.clone(), Color::White)).collect();

    fn dfs(
        u: &str,
        adj: &BTreeMap<String, Vec<String>>,
        color: &mut HashMap<String, Color>,
        stack: &mut Vec<String>,
    ) -> Option<Vec<String>> {
        color.insert(u.to_string(), Color::Gray);
        stack.push(u.to_string());
        if let Some(vs) = adj.get(u) {
            for v in vs {
                let state = color.get(v).copied().unwrap_or(Color::White);
                match state {
                    Color::Gray => {
                        let start = stack.iter().position(|x| x == v).unwrap_or(0);
                        let mut cyc: Vec<String> = stack[start..].to_vec();
                        cyc.push(v.clone());
                        return Some(cyc);
                    }
                    Color::White => {
                        if let Some(c) = dfs(v, adj, color, stack) {
                            return Some(c);
                        }
                    }
                    Color::Black => {}
                }
            }
        }
        stack.pop();
        color.insert(u.to_string(), Color::Black);
        None
    }

    for n in nodes {
        if color.get(n).copied() == Some(Color::White) {
            let mut stack = Vec::new();
            if let Some(c) = dfs(n, adj, &mut color, &mut stack) {
                return Some(c);
            }
        }
    }
    None
}

pub fn validate_pack(pack: &Path) -> PackReport {
    let mut issues: Vec<Issue> = Vec::new();
    let mut subject_id: Option<String> = None;
    let mut subject_version: Option<String> = None;
    let mut schema: Option<String> = None;

    // ---------- subject.json ----------
    let subj_path = pack.join("subject.json");
    let meta: SubjectMeta = match fs::read_to_string(&subj_path)
        .map_err(|e| format!("读取失败: {e}"))
        .and_then(|t| serde_json::from_str(&t).map_err(|e| format!("JSON 解析失败: {e}")))
    {
        Ok(m) => m,
        Err(msg) => {
            push(&mut issues, Level::Error, "subject.json", "meta-unreadable", msg);
            return finish(pack, issues, subject_id, subject_version, schema, 0, 0, 0, 0.0, vec![], vec![]);
        }
    };

    // id
    match meta.id.as_deref() {
        Some(id) if !id.trim().is_empty() => {
            if !valid_id(id) {
                push(&mut issues, Level::Error, "subject.json", "bad-id",
                    format!("id「{id}」不合法：需小写字母/数字开头，仅含小写字母、数字、点、连字符、下划线"));
            }
            subject_id = Some(id.to_string());
        }
        _ => push(&mut issues, Level::Error, "subject.json", "missing-id", "缺少必需字段 id"),
    }
    // name
    if meta.name.as_deref().map_or(true, |s| s.trim().is_empty()) {
        push(&mut issues, Level::Error, "subject.json", "missing-name", "缺少必需字段 name");
    }
    // version
    match meta.version.as_deref() {
        Some(v) if valid_version(v) => subject_version = Some(v.to_string()),
        Some(v) => push(&mut issues, Level::Error, "subject.json", "bad-version",
            format!("version「{v}」不是 x.y.z 形式")),
        None => push(&mut issues, Level::Error, "subject.json", "missing-version", "缺少必需字段 version"),
    }
    // schema
    match meta.schema.as_deref() {
        Some(s) if s == SCHEMA_VERSION => schema = Some(s.to_string()),
        Some(s) => push(&mut issues, Level::Error, "subject.json", "bad-schema",
            format!("schema「{s}」不受支持，本工具仅支持 {SCHEMA_VERSION}")),
        None => push(&mut issues, Level::Error, "subject.json", "missing-schema", "缺少必需字段 schema"),
    }
    // license
    if meta.license.as_deref().map_or(true, |s| s.trim().is_empty()) {
        push(&mut issues, Level::Error, "subject.json", "missing-license", "缺少必需字段 license");
    }
    // depends（同级 packs/ 目录存在性）
    for dep in &meta.depends {
        let sibling = pack.parent().map(|p| p.join(dep));
        if let Some(p) = sibling {
            if !p.join("subject.json").exists() {
                push(&mut issues, Level::Warning, "subject.json", "dep-not-found",
                    format!("依赖的学科包「{dep}」在同级 packs/ 下不存在"));
            }
        }
    }

    // ---------- GUIDE.md ----------
    let guide = pack.join("GUIDE.md");
    match fs::read_to_string(&guide) {
        Ok(t) => {
            if t.trim().is_empty() {
                push(&mut issues, Level::Error, "GUIDE.md", "empty-guide", "GUIDE.md 是空的（必需：资料阅读方法）");
            } else if t.len() < 200 {
                push(&mut issues, Level::Warning, "GUIDE.md", "thin-guide",
                    "GUIDE.md 过薄（<200 字节）——至少写清：包教什么、树怎么读、题怎么读、字段词典、示例");
            }
        }
        Err(_) => push(&mut issues, Level::Error, "GUIDE.md", "missing-guide",
            "缺少 GUIDE.md（必需：资料阅读方法，一份文本两种消费）"),
    }

    // ---------- tree/kc.json ----------
    let kc_path = pack.join("tree").join("kc.json");
    let kcs: Vec<Kc> = match fs::read_to_string(&kc_path)
        .map_err(|e| format!("读取失败: {e}"))
        .and_then(|t| serde_json::from_str(&t).map_err(|e| format!("JSON 解析失败: {e}")))
    {
        Ok(k) => k,
        Err(msg) => {
            push(&mut issues, Level::Error, "tree/kc.json", "kc-unreadable", msg);
            return finish(pack, issues, subject_id, subject_version, schema, 0, 0, 0, 0.0, vec![], vec![]);
        }
    };

    let mut kc_ids: Vec<String> = Vec::new();
    let mut kc_names: BTreeMap<String, String> = BTreeMap::new();
    let mut seen_kc: HashSet<String> = HashSet::new();
    for kc in &kcs {
        let Some(id) = kc.id.as_deref().map(str::to_string) else {
            push(&mut issues, Level::Error, "tree/kc.json", "kc-missing-id",
                format!("存在缺少 id 的知识点（name={:?}）", kc.name));
            continue;
        };
        if !seen_kc.insert(id.clone()) {
            push(&mut issues, Level::Error, "tree/kc.json", "kc-duplicate",
                format!("知识点 id 重复: {id}"));
            continue;
        }
        if kc.name.as_deref().map_or(true, |s| s.trim().is_empty()) {
            push(&mut issues, Level::Error, "tree/kc.json", "kc-missing-name",
                format!("{id}: 缺少 name"));
        }
        if kc.toc.is_empty() {
            push(&mut issues, Level::Error, "tree/kc.json", "kc-missing-toc",
                format!("{id}: toc 为空（章节路径必需，教材改版只改它）"));
        }
        if let Some(d) = kc.difficulty {
            if !(0.0..=1.0).contains(&d) {
                push(&mut issues, Level::Warning, "tree/kc.json", "kc-bad-difficulty",
                    format!("{id}: difficulty={d} 超出 0–1"));
            }
        }
        if let Some(b) = kc.bloom.as_deref() {
            if !BLOOM_LEVELS.contains(&b) {
                push(&mut issues, Level::Warning, "tree/kc.json", "kc-bad-bloom",
                    format!("{id}: bloom「{b}」不在枚举内（{:?}）", BLOOM_LEVELS));
            }
        }
        kc_ids.push(id.clone());
        kc_names.insert(id.clone(), kc.name.clone().unwrap_or_default());
    }
    let kc_count = kc_ids.len();

    // ---------- tree/prereq.json ----------
    let prereq_path = pack.join("tree").join("prereq.json");
    let mut edges: Vec<(String, String)> = Vec::new();
    match fs::read_to_string(&prereq_path)
        .map_err(|e| format!("读取失败: {e}"))
        .and_then(|t| serde_json::from_str::<Vec<Prereq>>(&t).map_err(|e| format!("JSON 解析失败: {e}")))
    {
        Ok(prereqs) => {
            let mut seen_edge: HashSet<(String, String)> = HashSet::new();
            for p in &prereqs {
                let from = p.from.clone().unwrap_or_default();
                let to = p.to.clone().unwrap_or_default();
                if from.is_empty() || to.is_empty() {
                    push(&mut issues, Level::Error, "tree/prereq.json", "edge-incomplete",
                        "存在缺少 from/to 的先修边");
                    continue;
                }
                if !kc_names.contains_key(&from) {
                    push(&mut issues, Level::Error, "tree/prereq.json", "edge-bad-from",
                        format!("先修边 from「{from}」不在 kc.json 中"));
                }
                if !kc_names.contains_key(&to) {
                    push(&mut issues, Level::Error, "tree/prereq.json", "edge-bad-to",
                        format!("先修边 to「{to}」不在 kc.json 中"));
                }
                if from == to {
                    push(&mut issues, Level::Error, "tree/prereq.json", "edge-self",
                        format!("自环: {from} → {to}"));
                }
                if !seen_edge.insert((from.clone(), to.clone())) {
                    push(&mut issues, Level::Warning, "tree/prereq.json", "edge-duplicate",
                        format!("重复先修边: {from} → {to}"));
                    continue;
                }
                match p.strength.as_deref() {
                    Some(s) if STRENGTHS.contains(&s) => {}
                    Some(s) => push(&mut issues, Level::Error, "tree/prereq.json", "edge-bad-strength",
                        format!("{from}→{to}: strength「{s}」不在枚举（hard/soft）")),
                    None => push(&mut issues, Level::Error, "tree/prereq.json", "edge-missing-strength",
                        format!("{from}→{to}: 缺少 strength（hard/soft）")),
                }
                if p.reason.as_deref().map_or(true, |s| s.trim().is_empty()) {
                    push(&mut issues, Level::Error, "tree/prereq.json", "edge-missing-reason",
                        format!("{from}→{to}: 缺少 reason（必须是一句人话，供复核）"));
                }
                edges.push((from, to));
            }
        }
        Err(msg) => push(&mut issues, Level::Error, "tree/prereq.json", "prereq-unreadable", msg),
    }
    let edge_count = edges.len();

    // DAG 检查
    let mut adj: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for (from, to) in &edges {
        adj.entry(from.clone()).or_default().push(to.clone());
    }
    if let Some(cyc) = find_cycle(&kc_ids, &adj) {
        push(&mut issues, Level::Error, "tree/prereq.json", "cycle",
            format!("先修关系存在环: {}", cyc.join(" → ")));
    }

    // ---------- items/ ----------
    let items_dir = pack.join("items");
    let mut item_count: usize = 0;
    let mut items_with_kc: usize = 0;
    let mut per_kc: BTreeMap<String, usize> = BTreeMap::new();

    if !items_dir.is_dir() {
        push(&mut issues, Level::Error, "items/", "missing-items-dir", "缺少 items/ 目录");
    } else {
        let mut files: Vec<_> = fs::read_dir(&items_dir)
            .map(|rd| {
                rd.filter_map(|e| e.ok())
                    .map(|e| e.path())
                    .filter(|p| p.extension().map_or(false, |x| x == "json"))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        files.sort();
        for p in files {
            let fname = p.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
            let stem = p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
            let rel = format!("items/{fname}");
            let text = match fs::read_to_string(&p) {
                Ok(t) => t,
                Err(e) => {
                    push(&mut issues, Level::Error, &rel, "item-unreadable", format!("读取失败: {e}"));
                    continue;
                }
            };
            let item: Item = match serde_json::from_str(&text) {
                Ok(i) => i,
                Err(e) => {
                    push(&mut issues, Level::Error, &rel, "item-parse", format!("JSON 解析失败: {e}"));
                    continue;
                }
            };
            item_count += 1;

            // id 与文件名一致
            match item.id.as_deref() {
                Some(id) if id == stem => {}
                Some(id) => push(&mut issues, Level::Error, &rel, "item-id-mismatch",
                    format!("id「{id}」与文件名「{stem}」不一致")),
                None => push(&mut issues, Level::Error, &rel, "item-missing-id", "缺少 id"),
            }
            // 题型
            let ty = item.item_type.clone().unwrap_or_default();
            if !ITEM_TYPES.contains(&ty.as_str()) {
                push(&mut issues, Level::Error, &rel, "item-bad-type",
                    format!("type「{ty}」不在枚举（{:?}）", ITEM_TYPES));
            }
            // kc_ids
            if item.kc_ids.is_empty() {
                push(&mut issues, Level::Error, &rel, "item-no-kc",
                    "题目未挂载知识点（kc_ids 为空）——诊断链路会因此断裂");
            } else {
                items_with_kc += 1;
                for k in &item.kc_ids {
                    if !kc_names.contains_key(k) {
                        push(&mut issues, Level::Error, &rel, "item-bad-kc",
                            format!("kc_ids 引用不存在的知识点: {k}"));
                    }
                    *per_kc.entry(k.clone()).or_default() += 1;
                }
            }
            // 题干
            if item.stem.as_deref().map_or(true, |s| s.trim().is_empty()) {
                push(&mut issues, Level::Error, &rel, "item-missing-stem", "缺少题干 stem");
            }
            // 选项/答案
            match ty.as_str() {
                "single_choice" | "multi_choice" => {
                    if item.options.len() < 2 {
                        push(&mut issues, Level::Error, &rel, "item-few-options",
                            format!("选择题至少 2 个选项，实际 {}", item.options.len()));
                    }
                    let mut keys: Vec<String> = Vec::new();
                    for (idx, o) in item.options.iter().enumerate() {
                        match o.key.as_deref() {
                            Some(k) if !k.trim().is_empty() => keys.push(k.to_string()),
                            _ => push(&mut issues, Level::Error, &rel, "option-missing-key",
                                format!("第 {} 个选项缺少 key", idx + 1)),
                        }
                    }
                    let uniq: HashSet<&String> = keys.iter().collect();
                    if uniq.len() != keys.len() {
                        push(&mut issues, Level::Error, &rel, "option-duplicate-key", "选项 key 重复");
                    }
                    match ty.as_str() {
                        "single_choice" => match item.answer.as_deref() {
                            Some(a) if keys.iter().any(|k| k == a) => {}
                            Some(a) => push(&mut issues, Level::Error, &rel, "answer-not-in-options",
                                format!("answer「{a}」不在选项 key（{:?}）中", keys)),
                            None => push(&mut issues, Level::Error, &rel, "missing-answer", "缺少 answer"),
                        },
                        _ => {
                            let ans = item.answer.clone().unwrap_or_default();
                            if ans.is_empty() {
                                push(&mut issues, Level::Error, &rel, "missing-answer", "缺少 answer");
                            } else {
                                let set: HashSet<char> = ans.chars().collect();
                                for c in &set {
                                    if !keys.iter().any(|k| k.contains(*c)) {
                                        push(&mut issues, Level::Error, &rel, "answer-not-in-options",
                                            format!("answer「{ans}」含不在选项中的 key「{c}」"));
                                    }
                                }
                            }
                        }
                    }
                    if item.analysis.as_deref().map_or(true, |s| s.trim().is_empty()) {
                        push(&mut issues, Level::Warning, &rel, "missing-analysis", "缺少解析 analysis");
                    }
                }
                "fill_blank" | "short_answer" | "judge" => {
                    if item.answer_text.as_deref().map_or(true, |s| s.trim().is_empty())
                        && item.answer.as_deref().map_or(true, |s| s.trim().is_empty())
                    {
                        push(&mut issues, Level::Error, &rel, "missing-answer", "缺少 answer/answer_text");
                    }
                }
                _ => {}
            }
            // difficulty
            if let Some(d) = item.difficulty {
                if !(0.0..=1.0).contains(&d) {
                    push(&mut issues, Level::Warning, &rel, "item-bad-difficulty",
                        format!("difficulty={d} 超出 0–1"));
                }
            }
            // origin（工具中立立场：只提醒，不拦截）
            match item.origin.source_type.as_deref() {
                Some(s) if SOURCE_TYPES.contains(&s) => {}
                _ => push(&mut issues, Level::Warning, &rel, "origin-unset",
                    "origin.source_type 未设置（建议标注，便于追溯与分享时声明）"),
            }
        }
    }

    // ---------- 统计 ----------
    let coverage_pct = if item_count == 0 {
        0.0
    } else {
        items_with_kc as f64 / item_count as f64 * 100.0
    };
    if item_count > 0 && coverage_pct < 85.0 {
        push(&mut issues, Level::Warning, "items/", "low-coverage",
            format!("题目→知识点挂载率 {:.0}% < 85%（低于此值诊断链路不可靠）", coverage_pct));
    }
    if item_count == 0 {
        push(&mut issues, Level::Warning, "items/", "no-items", "包内没有任何题目");
    }

    // 无题挂载的 KC（粒度信号）
    let mut dangling: Vec<String> = Vec::new();
    for id in &kc_ids {
        if !per_kc.contains_key(id) {
            dangling.push(id.clone());
        }
    }
    for d in &dangling {
        let name = kc_names.get(d).cloned().unwrap_or_default();
        push(&mut issues, Level::Warning, "items/", "dangling-kc",
            format!("知识点 {d}（{name}）没有任何题目挂载——粒度过细或缺题"));
    }

    let per_kc_items: Vec<KcStat> = per_kc
        .iter()
        .map(|(id, n)| KcStat { kc_id: id.clone(), name: kc_names.get(id).cloned().unwrap_or_default(), items: *n })
        .collect();

    finish(pack, issues, subject_id, subject_version, schema, kc_count, edge_count, item_count, coverage_pct, dangling, per_kc_items)
}

#[allow(clippy::too_many_arguments)]
fn finish(
    pack: &Path,
    mut issues: Vec<Issue>,
    subject_id: Option<String>,
    subject_version: Option<String>,
    schema: Option<String>,
    kc_count: usize,
    edge_count: usize,
    item_count: usize,
    coverage_pct: f64,
    dangling_kcs: Vec<String>,
    per_kc_items: Vec<KcStat>,
) -> PackReport {
    let lv = |l: Level| match l {
        Level::Error => 0,
        Level::Warning => 1,
        Level::Info => 2,
    };
    issues.sort_by(|a, b| lv(a.level).cmp(&lv(b.level)).then_with(|| a.code.cmp(&b.code)));
    let error_count = issues.iter().filter(|i| i.level == Level::Error).count();
    let warning_count = issues.iter().filter(|i| i.level == Level::Warning).count();
    PackReport {
        pack_path: pack.display().to_string(),
        subject_id,
        subject_version,
        schema,
        kc_count,
        edge_count,
        item_count,
        coverage_pct,
        error_count,
        warning_count,
        dangling_kcs,
        per_kc_items,
        issues,
    }
}
