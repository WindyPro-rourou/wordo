//! 学习环路内核：账本（append-only）→ 派生状态（user.md）→ 复习队列 → 委托流 → 域同步。
//! 设计见 docs/大纲/03-学习环路与同步-v0.1.md。
//!
//! 无冲突的根本原因：每个节点只**追加**自己的 `ledger/<node>.jsonl`，从不改写他人文件；
//! `user.md` 是**派生**文件，任何节点重算结果一致 → 账号域内共享同一份学习状态，且没有主从。

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use chrono::{DateTime, Duration, FixedOffset, Local, SecondsFormat};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub const SCHEMA_EVENT: &str = "wordo/event/1";
pub const SCHEMA_USER: &str = "wordo/user/1";
pub const SCHEMA_DELEGATION: &str = "wordo/delegation-wrong/1";
pub const SCHEMA_DELEGATION_RESULT: &str = "wordo/delegation-result/1";

/// 掌握阈值：mastery ≥ 0.8 且连续对 ≥ 2 次
pub const MASTERY_OK: f64 = 0.8;
pub const STREAK_OK: u32 = 2;
/// 复习间隔上限（小时）
pub const MAX_INTERVAL_HOURS: f64 = 720.0;
/// 答错后的最短回炉间隔（小时）
pub const MIN_INTERVAL_HOURS: f64 = 4.0;

/* ══════════ 事件 ══════════ */

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct Event {
    pub id: String,
    pub ts: String,
    pub node: String,
    pub kind: String,
    /// 每节点单调递增序号（并发合并时可检测重放/乱序）
    pub seq: u64,
    pub pack: String,
    pub item_id: String,
    pub kc_ids: Vec<String>,
    pub answered: String,
    pub correct: String,
    pub ok: Option<bool>,
    pub error_type: Option<String>,
    /// 答题信心档：certain | unsure | guess（用于区分「蒙对」）
    pub confidence: Option<String>,
    pub source: String,
    pub model: String,
    pub task_id: String,
    pub file: String,
    pub by_node: String,
    pub note: String,
}

impl Event {
    pub fn new(node: &str, kind: &str) -> Event {
        Event {
            id: new_id(node),
            ts: Local::now().to_rfc3339_opts(SecondsFormat::Secs, true),
            node: node.to_string(),
            kind: kind.to_string(),
            ..Default::default()
        }
    }
    pub fn to_json(&self) -> Value {
        serde_json::to_value(self).unwrap_or(Value::Null)
    }
    fn ok_bool(&self) -> bool {
        self.ok.unwrap_or(false)
    }
}

static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

pub fn new_id(node: &str) -> String {
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let n = COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    format!("{ms}-{n}-{node}")
}

pub fn today() -> String {
    Local::now().format("%Y-%m-%d").to_string()
}

fn parse_ts(s: &str) -> Option<DateTime<FixedOffset>> {
    DateTime::parse_from_rfc3339(s).ok()
}

/* ══════════ 账号域目录 ══════════ */

#[derive(Debug, Clone)]
pub struct Paths {
    pub root: PathBuf,
}

impl Paths {
    pub fn new(root: &Path) -> Paths {
        Paths { root: root.to_path_buf() }
    }
    pub fn ledger_dir(&self) -> PathBuf {
        self.root.join("ledger")
    }
    pub fn ledger_of(&self, node: &str) -> PathBuf {
        self.ledger_dir().join(format!("{node}.jsonl"))
    }
    pub fn wrong_dir(&self) -> PathBuf {
        self.root.join("wrong")
    }
    pub fn user_md(&self) -> PathBuf {
        self.root.join("user.md")
    }
    pub fn settings_md(&self) -> PathBuf {
        self.root.join("settings.md")
    }
    pub fn plan_md(&self) -> PathBuf {
        self.root.join("plan.md")
    }
    pub fn node_json(&self) -> PathBuf {
        self.root.join("node.json")
    }
}

/// 建目录 + 缺省 settings.md
pub fn ensure_domain(root: &Path) -> Result<Paths, String> {
    let p = Paths::new(root);
    for d in [p.root.clone(), p.ledger_dir(), p.wrong_dir()] {
        fs::create_dir_all(&d).map_err(|e| format!("创建 {} 失败: {e}", d.display()))?;
    }
    if !p.settings_md().exists() {
        fs::write(
            p.settings_md(),
            "---\ndoc: wordo/settings/1\ndaily_goal: 20\ndifficulty_min: 0.2\ndifficulty_max: 0.7\nexplain_lang: zh\nreview_first: true\n---\n# 个性化设置\n\n（本文件随账号域同步；改这里就能改变所有设备的学习行为）\n",
        )
        .map_err(|e| e.to_string())?;
    }
    if !p.plan_md().exists() {
        fs::write(
            p.plan_md(),
            "# 学习计划 / 任务清单\n\n> 任何设备都可以往这里追加任务（append-only）；完成情况记在账本里。\n\n",
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(p)
}

fn fnv1a(s: &str) -> u32 {
    let mut h: u32 = 0x811c9dc5;
    for b in s.as_bytes() {
        h ^= *b as u32;
        h = h.wrapping_mul(0x01000193);
    }
    h
}

fn slug(s: &str) -> String {
    let t: String = s
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect::<String>()
        .to_lowercase();
    if t.is_empty() {
        "node".to_string()
    } else {
        t.chars().take(12).collect()
    }
}

/// 本机节点身份（首次访问自动生成并写 node.json）
pub fn node_id(root: &Path) -> Result<String, String> {
    let p = Paths::new(root);
    if let Ok(t) = fs::read_to_string(p.node_json()) {
        if let Ok(v) = serde_json::from_str::<Value>(&t) {
            if let Some(n) = v.get("node").and_then(|x| x.as_str()) {
                if !n.trim().is_empty() {
                    return Ok(n.to_string());
                }
            }
        }
    }
    let host = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "node".to_string());
    let node = format!("{}-{:04x}", slug(&host), fnv1a(&format!("{host}-{}", today())) % 0xFFFF);
    fs::create_dir_all(&p.root).map_err(|e| e.to_string())?;
    fs::write(
        p.node_json(),
        serde_json::to_string_pretty(&json!({ "node": node, "host": host, "created": Local::now().to_rfc3339() }))
            .unwrap_or_default(),
    )
    .map_err(|e| e.to_string())?;
    Ok(node)
}

/* ══════════ 账本读写 ══════════ */

/// 本节点账本里已有的最大 seq
fn next_seq(ledger: &Path) -> u64 {
    let mut max = 0u64;
    if let Ok(t) = fs::read_to_string(ledger) {
        for line in t.lines() {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
                if let Some(s) = v.get("seq").and_then(|x| x.as_u64()) {
                    if s > max {
                        max = s;
                    }
                }
            }
        }
    }
    max + 1
}

pub fn append_event(root: &Path, ev: &Event) -> Result<(), String> {
    let p = ensure_domain(root)?;
    fs::create_dir_all(p.ledger_dir()).map_err(|e| e.to_string())?;
    // 单调序号：同一节点串行追加时保证不重复、可检测丢失
    let mut ev2 = ev.clone();
    if ev2.seq == 0 {
        ev2.seq = next_seq(&p.ledger_of(&ev.node));
    }
    let line = serde_json::to_string(&ev2).map_err(|e| e.to_string())?;
    use std::io::Write;
    let mut f = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(p.ledger_of(&ev2.node))
        .map_err(|e| format!("打开账本失败: {e}"))?;
    writeln!(f, "{line}").map_err(|e| format!("写入账本失败: {e}"))?;
    Ok(())
}

/// 读全部节点账本：按 id 去重、按时间排序（这就是「域」的唯一事实）
pub fn read_events(root: &Path) -> Vec<Event> {
    let mut out: Vec<Event> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let dir = Paths::new(root).ledger_dir();
    let Ok(rd) = fs::read_dir(&dir) else {
        return out;
    };
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
            if let Ok(ev) = serde_json::from_str::<Event>(l) {
                if seen.insert(ev.id.clone()) {
                    out.push(ev);
                }
            }
        }
    }
    // 按「解析后的时间」排序：RFC3339 字符串在不同时区偏移下字典序≠时间序
    out.sort_by(|a, b| {
        let ta = parse_ts(&a.ts).map(|x| x.timestamp_millis()).unwrap_or(0);
        let tb = parse_ts(&b.ts).map(|x| x.timestamp_millis()).unwrap_or(0);
        ta.cmp(&tb).then(a.id.cmp(&b.id))
    });
    out
}

/* ══════════ 派生状态 ══════════ */

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct KcState {
    pub kc_id: String,
    pub attempts: u32,
    pub correct: u32,
    pub wrong: u32,
    pub streak: u32,
    pub last_ok: Option<bool>,
    pub last_ts: Option<String>,
    pub mastery: f64,
    pub interval_hours: f64,
    pub due_ts: Option<String>,
    pub mastered: bool,
    #[serde(default)]
    pub error_types: BTreeMap<String, u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LearnerState {
    pub node: String,
    pub events_total: u32,
    pub nodes: Vec<String>,
    pub kcs: BTreeMap<String, KcState>,
    /// item_id → 最近一次是否正确
    pub items: BTreeMap<String, bool>,
    pub today_answers: u32,
    pub today_wrong: u32,
}

pub fn derive(root: &Path, now: Option<DateTime<FixedOffset>>) -> LearnerState {
    let now = now.unwrap_or_else(|| Local::now().fixed_offset());
    let events = read_events(root);
    let mut nodes: Vec<String> = events.iter().map(|e| e.node.clone()).collect();
    nodes.sort();
    nodes.dedup();

    // kc → [(ok, ts)]
    let mut hist: HashMap<String, Vec<(bool, DateTime<FixedOffset>, Option<String>, Option<String>)>> = HashMap::new();
    let mut acc: BTreeMap<String, KcState> = BTreeMap::new();
    let mut items: BTreeMap<String, bool> = BTreeMap::new();
    let d0 = today();

    for ev in &events {
        if ev.kind != "answer" {
            continue;
        }
        let ts = parse_ts(&ev.ts).unwrap_or(now);
        let ok = ev.ok_bool();
        for kc in &ev.kc_ids {
            hist.entry(kc.clone()).or_default().push((ok, ts, ev.confidence.clone(), ev.error_type.clone()));
        }
        if !ev.item_id.is_empty() {
            items.insert(ev.item_id.clone(), ok);
        }
    }
    // 今天
    let (mut ta, mut tw) = (0u32, 0u32);
    for ev in &events {
        if ev.kind == "answer" && ev.ts.starts_with(&d0) {
            ta += 1;
            if !ev.ok_bool() {
                tw += 1;
            }
        }
    }

    for (kc, list) in hist.iter() {
        let mut st = KcState {
            kc_id: kc.clone(),
            ..Default::default()
        };
        let mut wsum = 0.0;
        let mut oksum = 0.0;
        let mut interval = 0.0f64;
        for (ok, ts, conf, etype) in list {
            st.attempts += 1;
            let guess = conf.as_deref() == Some("guess");
            let unsure = conf.as_deref() == Some("unsure");
            let misread = etype.as_deref() == Some("misread");
            if *ok {
                st.correct += 1;
                if guess {
                    // 蒙对 = 没有真实记忆证据：按「未掌握」调度，并打断连对
                    st.streak = 0;
                    interval = MIN_INTERVAL_HOURS;
                } else {
                    st.streak += 1;
                    let growth = if unsure { 1.4 } else { 2.0 };
                    interval = if st.streak == 1 { 24.0 } else { (interval * growth).min(MAX_INTERVAL_HOURS) };
                }
            } else {
                st.wrong += 1;
                st.streak = 0;
                interval = if interval <= 0.0 { MIN_INTERVAL_HOURS } else { (interval / 2.0).max(MIN_INTERVAL_HOURS) };
            }
            st.last_ok = Some(*ok);
            st.last_ts = Some(ts.to_rfc3339_opts(SecondsFormat::Secs, true));
            // mastery 权重：72 小时半衰期
            let hours = (now - *ts).num_minutes() as f64 / 60.0;
            let w = 0.5f64.powf(hours / 72.0);
            // 「看错题」是审题问题，不代表知识点没掌握 → 不计入掌握度
            if !(!*ok && misread) {
                wsum += w;
                if *ok {
                    // 蒙对几乎没有记忆证据，只按 15% 计入
                    let cw = if guess { 0.15 } else if unsure { 0.7 } else { 1.0 };
                    oksum += w * cw;
                }
            }
        }
        st.mastery = if wsum > 0.0 { oksum / wsum } else { 0.0 };
        st.mastered = st.mastery >= MASTERY_OK && st.streak >= STREAK_OK;
        // 已掌握进入低频抽查（≥14 天），避免占掉每日复习配额
        if st.mastered && interval < 336.0 {
            interval = 336.0;
        }
        st.interval_hours = interval;
        if let Some(lt) = st.last_ts.as_deref().and_then(parse_ts) {
            st.due_ts = Some((lt + Duration::minutes((interval * 60.0) as i64)).to_rfc3339_opts(SecondsFormat::Secs, true));
        }
        // 错因统计
        for ev in events.iter().filter(|e| e.kind == "answer" && !e.ok_bool() && e.kc_ids.contains(kc)) {
            if let Some(t) = ev.error_type.as_deref() {
                if !t.is_empty() && t != "none" {
                    *st.error_types.entry(t.to_string()).or_insert(0) += 1;
                }
            }
        }
        acc.insert(kc.clone(), st);
    }

    LearnerState {
        node: node_id(root).unwrap_or_default(),
        events_total: events.len() as u32,
        nodes,
        kcs: acc,
        items,
        today_answers: ta,
        today_wrong: tw,
    }
}

/// 到期待复习（due ≤ now）；未掌握优先，其次按到期时间
pub fn due_list(st: &LearnerState, now: Option<DateTime<FixedOffset>>) -> Vec<KcState> {
    let now = now.unwrap_or_else(|| Local::now().fixed_offset());
    let mut v: Vec<KcState> = st
        .kcs
        .values()
        .filter(|k| k.attempts > 0 && !k.mastered) // 已掌握不占每日复习配额（低频抽查，见 interval≥14d）
        .filter(|k| match k.due_ts.as_deref().and_then(parse_ts) {
            Some(d) => d <= now,
            None => false,
        })
        .cloned()
        .collect();
    v.sort_by(|a, b| {
        let ca = a.error_types.contains_key("concept_confused");
        let cb = b.error_types.contains_key("concept_confused");
        cb.cmp(&ca) // 概念不清排前面
            .then(b.wrong.cmp(&a.wrong))
            .then(a.due_ts.cmp(&b.due_ts))
    });
    v
}

/// 薄弱知识点（错过的、未掌握），不受到期限制
pub fn weak_list(st: &LearnerState) -> Vec<KcState> {
    let mut v: Vec<KcState> = st
        .kcs
        .values()
        .filter(|k| k.wrong > 0 && !k.mastered)
        .cloned()
        .collect();
    v.sort_by(|a, b| {
        b.wrong
            .cmp(&a.wrong)
            .then(a.mastery.partial_cmp(&b.mastery).unwrap_or(std::cmp::Ordering::Equal))
    });
    v
}

/* ══════════ 学科包读取（出题 / 名称） ══════════ */

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ItemLite {
    pub id: String,
    #[serde(default)]
    pub kc_ids: Vec<String>,
    #[serde(default)]
    pub stem: String,
    #[serde(default)]
    pub r#type: String,
    #[serde(default)]
    pub options: Vec<Value>,
    #[serde(default)]
    pub answer: String,
    #[serde(default)]
    pub answer_text: String,
    #[serde(default)]
    pub analysis: String,
    #[serde(default)]
    pub pack: String,
}

pub fn load_items(packs_dir: &Path) -> Vec<ItemLite> {
    let mut out = Vec::new();
    let Ok(rd) = fs::read_dir(packs_dir) else { return out };
    let mut packs: Vec<PathBuf> = rd.filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| p.is_dir()).collect();
    packs.sort();
    for pk in packs {
        let pack_id = pk
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        let Ok(rd) = fs::read_dir(pk.join("items")) else { continue };
        let mut files: Vec<PathBuf> = rd
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.extension().map_or(false, |x| x == "json"))
            .collect();
        files.sort();
        for f in files {
            if let Ok(t) = fs::read_to_string(&f) {
                if let Ok(mut it) = serde_json::from_str::<ItemLite>(&t) {
                    it.pack = pack_id.clone();
                    out.push(it);
                }
            }
        }
    }
    out
}

/// kc_id → (名称, 学科包 id)
pub fn kc_index(packs_dir: &Path) -> BTreeMap<String, (String, String)> {
    let mut m = BTreeMap::new();
    let Ok(rd) = fs::read_dir(packs_dir) else { return m };
    let mut packs: Vec<PathBuf> = rd.filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| p.is_dir()).collect();
    packs.sort();
    for pk in packs {
        let pack_id = pk.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        if let Ok(t) = fs::read_to_string(pk.join("tree").join("kc.json")) {
            if let Ok(Value::Array(arr)) = serde_json::from_str::<Value>(&t) {
                for kc in arr {
                    let id = kc.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let name = kc.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    if !id.is_empty() {
                        m.insert(id, (name, pack_id.clone()));
                    }
                }
            }
        }
    }
    m
}

pub fn judge(item: &Value, answered: &str) -> bool {
    let typ = item.get("type").and_then(|v| v.as_str()).unwrap_or("");
    let norm = |s: &str| -> String {
        s.chars()
            .filter(|c| !c.is_whitespace() && *c != '。' && *c != ',' && *c != '．')
            .collect::<String>()
            .to_lowercase()
    };
    let correct = item
        .get("answer")
        .map(|v| match v {
            Value::String(s) => s.clone(),
            other => other.to_string(),
        })
        .unwrap_or_default();
    match typ {
        "single_choice" => norm(&correct) == norm(answered),
        "multi_choice" => {
            let mut a: Vec<char> = norm(answered).chars().collect();
            let mut b: Vec<char> = norm(&correct).chars().collect();
            a.sort();
            b.sort();
            a == b
        }
        _ => {
            let alt = item.get("answer_text").and_then(|v| v.as_str()).unwrap_or("");
            norm(&correct) == norm(answered) || norm(alt) == norm(answered)
        }
    }
}

/// 出题优先级：① 最近答错 ② 从未做过 ③ 最久未做
pub fn pick_items(packs_dir: &Path, kc_id: &str, st: &LearnerState, n: usize) -> Vec<ItemLite> {
    let all = load_items(packs_dir);
    let mut pool: Vec<ItemLite> = all.into_iter().filter(|i| i.kc_ids.iter().any(|k| k == kc_id)).collect();
    // 用最粗的稳定排序实现优先级（无 per-item 时间戳时的合理近似）
    pool.sort_by_key(|i| match st.items.get(&i.id) {
        Some(false) => 0,
        None => 1,
        Some(true) => 2,
    });
    pool.truncate(n);
    pool
}

/* ══════════ user.md（派生，人读+机读同一份） ══════════ */

pub fn load_settings(root: &Path) -> BTreeMap<String, String> {
    let mut m = BTreeMap::new();
    let Ok(t) = fs::read_to_string(Paths::new(root).settings_md()) else { return m };
    for line in t.lines() {
        if line.trim() == "---" {
            continue;
        }
        if let Some((k, v)) = line.split_once(':') {
            let k = k.trim();
            let v = v.trim();
            if !k.is_empty() && !k.starts_with('#') && !v.is_empty() {
                m.insert(k.to_string(), v.to_string());
            }
        }
    }
    m
}

pub fn render_user_md(root: &Path, packs_dir: &Path, st: &LearnerState) -> String {
    let idx = kc_index(packs_dir);
    let set = load_settings(root);
    let name = |id: &str| idx.get(id).map(|(n, _)| n.clone()).unwrap_or_else(|| id.to_string());
    let pack_of = |id: &str| idx.get(id).map(|(_, p)| p.clone()).unwrap_or_default();

    let weak = weak_list(st);
    let due = due_list(st, None);
    let due_ids: HashSet<String> = due.iter().map(|k| k.kc_id.clone()).collect();

    let mut s = String::new();
    s.push_str("---\n");
    s.push_str(&format!("doc: {SCHEMA_USER}\n"));
    s.push_str(&format!("node: {}\n", st.node));
    s.push_str(&format!("updated: {}\n", Local::now().to_rfc3339_opts(SecondsFormat::Secs, false)));
    s.push_str(&format!("events: {}\n", st.events_total));
    s.push_str(&format!(
        "nodes: [{}]\n",
        st.nodes.join(", ")
    ));
    s.push_str("---\n");
    s.push_str("# 学习者状态（由账本派生，请勿手改）\n\n");
    s.push_str("> 这是「我不会的东西」的权威记录：模型读它做个性化，人读它知道该复习什么。\n\n");

    s.push_str("## 个性化设置\n");
    for k in ["daily_goal", "difficulty_min", "difficulty_max", "explain_lang", "review_first"] {
        if let Some(v) = set.get(k) {
            s.push_str(&format!("- {k}: {v}\n"));
        }
    }
    s.push('\n');

    s.push_str(&format!("## 今日进度\n- 作答 {} 次，其中错 {} 次\n\n", st.today_answers, st.today_wrong));

    s.push_str(&format!("## 今日复习队列（{} 项）\n", due.len()));
    if due.is_empty() {
        s.push_str("- （无到期项）\n");
    } else {
        s.push_str("| 知识点 | 学科包 | 错次 | 掌握度 | 到期 |\n|---|---|---|---|---|\n");
        for k in &due {
            s.push_str(&format!(
                "| {} | {} | {} | {:.2} | {} |\n",
                name(&k.kc_id),
                pack_of(&k.kc_id),
                k.wrong,
                k.mastery,
                k.due_ts.as_deref().unwrap_or("-")
            ));
        }
    }
    s.push('\n');

    s.push_str(&format!("## 薄弱知识点（{} 项）\n", weak.len()));
    if weak.is_empty() {
        s.push_str("- （暂无）\n");
    } else {
        s.push_str("| 知识点 | 掌握度 | 对/错 | 连对 | 到期复习 | 主要错因 |\n|---|---|---|---|---|---|\n");
        for k in weak.iter() {
            let et = k
                .error_types
                .iter()
                .max_by_key(|(_, v)| **v)
                .map(|(a, b)| format!("{a}×{b}"))
                .unwrap_or_else(|| "-".to_string());
            s.push_str(&format!(
                "| {} | {:.2} | {}/{} | {} | {} | {} |\n",
                name(&k.kc_id),
                k.mastery,
                k.correct,
                k.wrong,
                k.streak,
                if due_ids.contains(&k.kc_id) { "已到期" } else { k.due_ts.as_deref().unwrap_or("-") },
                et
            ));
        }
    }
    s.push('\n');

    let mastered: Vec<&KcState> = st.kcs.values().filter(|k| k.mastered).collect();
    s.push_str(&format!("## 已掌握（{} 项）\n", mastered.len()));
    if mastered.is_empty() {
        s.push_str("- （暂无）\n");
    } else {
        for k in mastered {
            s.push_str(&format!("- {}（掌握度 {:.2}，连对 {}）\n", name(&k.kc_id), k.mastery, k.streak));
        }
    }
    s.push('\n');

    s.push_str("## 最近错题\n");
    let events = read_events(root);
    let mut wrongs: Vec<&Event> = events
        .iter()
        .filter(|e| e.kind == "answer" && !e.ok_bool())
        .collect();
    wrongs.reverse();
    if wrongs.is_empty() {
        s.push_str("- （暂无）\n");
    } else {
        for ev in wrongs.iter().take(20) {
            s.push_str(&format!(
                "- {} `{}` 我选 {} / 正确 {}（{}）\n",
                &ev.ts[..16.min(ev.ts.len())],
                ev.item_id,
                if ev.answered.is_empty() { "?" } else { &ev.answered },
                ev.correct,
                ev.kc_ids.iter().map(|k| name(k)).collect::<Vec<_>>().join("、")
            ));
        }
    }
    s.push_str("\n## 其他设备帮我处理的委托\n");
    let res: Vec<&Event> = events.iter().filter(|e| e.kind == "delegation_result").collect();
    if res.is_empty() {
        s.push_str("- （暂无）\n");
    } else {
        for ev in res.iter().rev().take(10) {
            s.push_str(&format!("- {} 由 `{}` 处理：{}（{}）\n", &ev.ts[..16.min(ev.ts.len())], ev.by_node, ev.file, ev.note));
        }
    }
    s
}

/// 重算并写入 user.md，返回 (内容, 路径)
pub fn write_user_md(root: &Path, packs_dir: &Path) -> Result<(String, PathBuf), String> {
    let p = ensure_domain(root)?;
    let st = derive(root, None);
    let content = render_user_md(root, packs_dir, &st);
    fs::write(p.user_md(), &content).map_err(|e| e.to_string())?;
    Ok((content, p.user_md()))
}

/* ══════════ 委托流 ══════════ */

fn machine_json_block(v: &Value) -> String {
    format!("\n```json\n{}\n```\n", serde_json::to_string_pretty(v).unwrap_or_default())
}

/// 抽取 markdown 里最后一个 ```json``` 块（人读文档里嵌机读载荷）
pub fn extract_machine_json(md: &str) -> Option<Value> {
    let mut found = None;
    let mut in_block = false;
    let mut buf = String::new();
    for line in md.lines() {
        if line.trim_start().starts_with("```json") {
            in_block = true;
            buf.clear();
            continue;
        }
        if in_block && line.trim_start().starts_with("```") {
            in_block = false;
            if let Ok(v) = serde_json::from_str::<Value>(&buf) {
                found = Some(v);
            }
            continue;
        }
        if in_block {
            buf.push_str(line);
            buf.push('\n');
        }
    }
    if found.is_none() {
        // 兜底：MACHINE 标记之后的第一段 {...}
        if let Some(pos) = md.rfind("MACHINE") {
            let tail = &md[pos..];
            if let (Some(a), Some(b)) = (tail.find('{'), tail.rfind('}')) {
                if b > a {
                    if let Ok(v) = serde_json::from_str::<Value>(&tail[a..=b]) {
                        found = Some(v);
                    }
                }
            }
        }
    }
    found
}

/// 导出「今日错题」委托文书（含人读表格 + 机读 JSON）
pub fn export_wrong_delegation(
    root: &Path,
    packs_dir: &Path,
    node: &str,
    date: &str,
) -> Result<Value, String> {
    let p = ensure_domain(root)?;
    let events = read_events(root);
    let idx = kc_index(packs_dir);
    let items = load_items(packs_dir);
    let by_id: HashMap<&str, &ItemLite> = items.iter().map(|i| (i.id.as_str(), i)).collect();

    // 同一道题今天错多次只委托一次（按 item_id 去重，保留最近一次）
    let mut seen_items: HashSet<String> = HashSet::new();
    let wrongs: Vec<&Event> = events
        .iter()
        .rev()
        .filter(|e| e.kind == "answer" && !e.ok_bool() && e.ts.starts_with(date))
        .filter(|e| seen_items.insert(e.item_id.clone()))
        .collect();
    if wrongs.is_empty() {
        return Ok(json!({ "exported": false, "reason": format!("{date} 没有错题") }));
    }

    let mut payload_items = Vec::new();
    let mut body = String::new();
    for (n, ev) in wrongs.iter().enumerate() {
        let it = by_id.get(ev.item_id.as_str());
        let kc = ev.kc_ids.first().cloned().unwrap_or_default();
        let kc_nm = idx.get(&kc).map(|(n, _)| n.clone()).unwrap_or_else(|| kc.clone());
        body.push_str(&format!(
            "## {}. {} — `{}`\n- 题干：{}\n- 我选：{}　正确：{}\n",
            n + 1,
            kc_nm,
            ev.item_id,
            it.map(|i| i.stem.clone()).unwrap_or_default(),
            if ev.answered.is_empty() { "?" } else { &ev.answered },
            ev.correct
        ));
        if let Some(i) = it {
            let opts: Vec<String> = i
                .options
                .iter()
                .map(|o| {
                    format!(
                        "{} {}",
                        o.get("key").and_then(|v| v.as_str()).unwrap_or(""),
                        o.get("text").and_then(|v| v.as_str()).unwrap_or("")
                    )
                })
                .collect();
            if !opts.is_empty() {
                body.push_str(&format!("- 选项：{}\n", opts.join(" / ")));
            }
        }
        body.push('\n');
        payload_items.push(json!({
            "item_id": ev.item_id,
            "kc_id": kc,
            "kc_name": kc_nm,
            "stem": it.map(|i| i.stem.clone()).unwrap_or_default(),
            "options": it.map(|i| i.options.clone()).unwrap_or_default(),
            "answered": ev.answered,
            "correct": ev.correct,
            "analysis": it.map(|i| i.analysis.clone()).unwrap_or_default(),
        }));
    }

    let payload = json!({ "items": payload_items, "from_node": node, "date": date });
    let file_name = format!("{date}-{node}.md");
    let md = format!(
        "---\ndoc: {SCHEMA_DELEGATION}\ndate: {date}\nfrom_node: {node}\ncount: {}\n---\n# 今日错题委托（{date}）\n\n> 请账号域内**任一**设备处理：给出错因分析、补讲、一道变式题；\n> 结果请写成 `{file_name}.result-<你的节点>.md`（同目录）。\n\n{body}<!-- MACHINE：下行 JSON 供程序读取 -->{}\n",
        wrongs.len(),
        machine_json_block(&payload)
    );
    let path = p.wrong_dir().join(&file_name);
    fs::write(&path, md).map_err(|e| e.to_string())?;

    let mut ev = Event::new(node, "delegation_out");
    ev.file = format!("wrong/{file_name}");
    ev.note = format!("{} 道错题", wrongs.len());
    append_event(root, &ev)?;

    Ok(json!({
        "exported": true,
        "file": path.display().to_string(),
        "count": wrongs.len(),
        "items": payload_items,
    }))
}

/// 尚未被任何设备处理的委托（排除自己发起的、已有 .result- 的）
pub fn pending_delegations(root: &Path, me: &str) -> Vec<PathBuf> {
    let p = Paths::new(root);
    let mut out = Vec::new();
    let Ok(rd) = fs::read_dir(p.wrong_dir()) else { return out };
    for e in rd.filter_map(|e| e.ok()) {
        let path = e.path();
        let name = path.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        if !name.ends_with(".md") || name.contains(".result-") {
            continue;
        }
        if name.ends_with(&format!("-{me}.md")) {
            continue; // 自己发的不处理
        }
        // 该委托是否已有回执：回执名形如 `<完整委托文件名>.result-<node>.md`
        let Ok(rd2) = fs::read_dir(p.wrong_dir()) else { continue };
        let has = rd2.filter_map(|x| x.ok()).any(|x| {
            x.file_name()
                .to_string_lossy()
                .starts_with(&format!("{name}.result-"))
        });
        if !has {
            out.push(path);
        }
    }
    out.sort();
    out
}

/// 写入委托回执（处理节点调用）
pub fn write_delegation_result(
    root: &Path,
    by_node: &str,
    src: &Path,
    data: &Value,
) -> Result<PathBuf, String> {
    let p = ensure_domain(root)?;
    let src_name = src
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let fm = extract_machine_json(&fs::read_to_string(src).unwrap_or_default()).unwrap_or(Value::Null);
    let from_node = fm.get("from_node").and_then(|v| v.as_str()).unwrap_or("unknown").to_string();
    let date = fm.get("date").and_then(|v| v.as_str()).unwrap_or(&today()).to_string();
    let reviews = data.get("reviews").and_then(|v| v.as_array()).cloned().unwrap_or_default();

    let mut body = String::new();
    for r in &reviews {
        body.push_str(&format!(
            "## `{}`（{}）\n**错因**：{}\n\n**补讲**：{}\n\n",
            r.get("item_id").and_then(|v| v.as_str()).unwrap_or("?"),
            r.get("kc_id").and_then(|v| v.as_str()).unwrap_or("?"),
            r.get("why_wrong_md").and_then(|v| v.as_str()).unwrap_or(""),
            r.get("fix_md").and_then(|v| v.as_str()).unwrap_or("")
        ));
        if let Some(v) = r.get("variant") {
            body.push_str(&format!(
                "**变式题**：{}\n- 选项：{}\n- 答案：{}\n\n",
                v.get("stem").and_then(|x| x.as_str()).unwrap_or(""),
                v.get("options")
                    .and_then(|x| x.as_array())
                    .map(|a| a.iter().filter_map(|y| y.as_str()).collect::<Vec<_>>().join(" / "))
                    .unwrap_or_default(),
                v.get("answer").and_then(|x| x.as_str()).unwrap_or("")
            ));
        }
    }
    let md = format!(
        "---\ndoc: {SCHEMA_DELEGATION_RESULT}\nfrom_node: {from_node}\nby_node: {by_node}\ndate: {date}\nsource_file: wrong/{src_name}\ncount: {}\n---\n# 委托处理结果\n\n（由 `{by_node}` 处理）\n\n{body}<!-- MACHINE -->\n{}\n",
        reviews.len(),
        serde_json::to_string_pretty(data).unwrap_or_default()
    );
    let out = p.wrong_dir().join(format!("{src_name}.result-{by_node}.md"));
    fs::write(&out, md).map_err(|e| e.to_string())?;

    let mut ev = Event::new(by_node, "delegation_result");
    ev.file = format!("wrong/{}", out.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default());
    ev.by_node = by_node.to_string();
    ev.note = format!("处理 {from_node} 的 {} 道错题", reviews.len());
    ev.task_id = from_node;
    append_event(root, &ev)?;
    Ok(out)
}

/// 同步：合并账本（读全部节点）→ 重算 user.md → 报告域内态势
pub fn sync(root: &Path, packs_dir: &Path) -> Result<Value, String> {
    let me = node_id(root)?;
    sync_as(root, packs_dir, &me)
}

/// 指定「我是谁」的同步（CLI 可显式扮演某个节点）
pub fn sync_as(root: &Path, packs_dir: &Path, me: &str) -> Result<Value, String> {
    let p = ensure_domain(root);
    let p = p?;
    let events = read_events(root);
    let st = derive(root, None);
    let (_c, user_path) = write_user_md(root, packs_dir)?;
    let mut per_node: BTreeMap<String, u32> = BTreeMap::new();
    for e in &events {
        *per_node.entry(e.node.clone()).or_insert(0) += 1;
    }
    let pending = pending_delegations(root, &me);
    Ok(json!({
        "domain": p.root.display().to_string(),
        "node": me,
        "events_total": events.len(),
        "per_node": per_node,
        "weak": weak_list(&st).len(),
        "due": due_list(&st, None).len(),
        "pending_delegations": pending.iter().map(|x| x.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default()).collect::<Vec<_>>(),
        "user_md": user_path.display().to_string(),
    }))
}

/* ══════════ 任务清单（plan.md，append-only） ══════════ */

pub fn plan_add(root: &Path, node: &str, text: &str) -> Result<String, String> {
    let p = ensure_domain(root)?;
    let id = format!("t{}", new_id(node).split('-').next().unwrap_or("0"));
    use std::io::Write;
    let mut f = fs::OpenOptions::new().create(true).append(true).open(p.plan_md()).map_err(|e| e.to_string())?;
    writeln!(f, "- [ ] {id} · {text}　<!-- {node} {} -->", Local::now().to_rfc3339_opts(SecondsFormat::Secs, true))
        .map_err(|e| e.to_string())?;
    let mut ev = Event::new(node, "plan_add");
    ev.task_id = id.clone();
    ev.note = text.to_string();
    append_event(root, &ev)?;
    Ok(id)
}

/// 计划列表：**从账本事件派生**（唯一事实），不读共享 plan.md——多设备并发写 plan.md 会互相覆盖。
pub fn plan_list(root: &Path) -> Vec<Value> {
    let events = read_events(root);
    let done: HashSet<String> = events
        .iter()
        .filter(|e| e.kind == "plan_done")
        .map(|e| e.task_id.clone())
        .collect();
    let mut out: Vec<Value> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for e in events.iter().filter(|e| e.kind == "plan_add") {
        if e.task_id.is_empty() || !seen.insert(e.task_id.clone()) {
            continue;
        }
        out.push(json!({ "id": e.task_id, "text": e.note, "done": done.contains(&e.task_id), "by": e.node }));
    }
    out
}

pub fn plan_done(root: &Path, node: &str, task_id: &str) -> Result<(), String> {
    let mut ev = Event::new(node, "plan_done");
    ev.task_id = task_id.to_string();
    append_event(root, &ev)
}

/* ══════════ 一次作答 = 一次账本事件 ══════════ */

pub struct AnswerOut {
    pub ok: bool,
    pub event: Event,
    pub kc_state: Option<KcState>,
    pub next_due: Option<String>,
}

pub fn record_answer(
    root: &Path,
    packs_dir: &Path,
    node: &str,
    pack: &str,
    item_id: &str,
    answered: &str,
    source: &str,
    error_type: Option<String>,
    confidence: Option<String>,
) -> Result<AnswerOut, String> {
    let items = load_items(packs_dir);
    let it = items
        .iter()
        .find(|i| i.id == item_id)
        .ok_or_else(|| format!("找不到题目 {item_id}"))?;
    let raw = serde_json::to_value(it).unwrap_or(Value::Null);
    let ok = judge(&raw, answered);
    let correct = it.answer.clone();

    let mut ev = Event::new(node, "answer");
    ev.pack = pack.to_string();
    ev.item_id = item_id.to_string();
    ev.kc_ids = it.kc_ids.clone();
    ev.answered = answered.to_string();
    ev.correct = correct;
    ev.ok = Some(ok);
    ev.error_type = error_type;
    ev.source = source.to_string();
    ev.confidence = confidence;
    append_event(root, &ev)?;

    let st = derive(root, None);
    let kc_state = it.kc_ids.first().and_then(|k| st.kcs.get(k)).cloned();
    Ok(AnswerOut {
        ok,
        event: ev,
        next_due: kc_state.as_ref().and_then(|k| k.due_ts.clone()),
        kc_state,
    })
}


/* ══════════ 判分即落账（讲解内检测题 / 学习页 followup 也走这里） ══════════ */

/// 记一次「无题库 item」的作答（讲解里的检测题）。
/// `synthetic_id` 例如 `english.high::kc_eng_0002::followup`，用来去重与追溯。
pub fn record_judged(
    root: &Path,
    packs_dir: &Path,
    node: &str,
    pack: &str,
    kc_id: &str,
    synthetic_id: &str,
    answered: &str,
    ok: bool,
    source: &str,
    error_type: Option<String>,
    confidence: Option<String>,
) -> Result<Value, String> {
    let mut ev = Event::new(node, "answer");
    ev.pack = pack.to_string();
    ev.item_id = synthetic_id.to_string();
    ev.kc_ids = if kc_id.is_empty() { vec![] } else { vec![kc_id.to_string()] };
    ev.answered = answered.to_string();
    ev.correct = if ok { "(judged-correct)".to_string() } else { "(judged-wrong)".to_string() };
    ev.ok = Some(ok);
    ev.source = source.to_string();
    ev.error_type = error_type;
    ev.confidence = confidence;
    append_event(root, &ev)?;
    let _ = write_user_md(root, packs_dir);
    let st = derive(root, None);
    let kc = if kc_id.is_empty() { None } else { st.kcs.get(kc_id).cloned() };
    Ok(json!({
        "ok": ok,
        "eventId": ev.id,
        "kc": kc,
        "nextDue": kc.as_ref().and_then(|k| k.due_ts.clone()),
    }))
}

/// 记录「展示了某知识点的讲解」（A3 留痕；也让 user.md 能看到讲过什么）
pub fn record_explain(root: &Path, node: &str, pack: &str, kc_id: &str, model: &str, source: &str) -> Result<Value, String> {
    let mut ev = Event::new(node, "explain");
    ev.pack = pack.to_string();
    ev.kc_ids = if kc_id.is_empty() { vec![] } else { vec![kc_id.to_string()] };
    ev.model = model.to_string();
    ev.source = source.to_string();
    append_event(root, &ev)?;
    Ok(json!({ "ok": true, "eventId": ev.id }))
}

/// 账本完整性自检：重复 id / 每节点 seq 是否连续递增 / 引用不存在的知识点
pub fn verify_ledger(root: &Path, packs_dir: &Path) -> Value {
    let events = read_events(root);
    let mut dup_ids: Vec<String> = Vec::new();
    {
        let mut seen = HashSet::new();
        if let Ok(rd) = std::fs::read_dir(Paths::new(root).ledger_dir()) {
            for f in rd.filter_map(|e| e.ok()).map(|e| e.path()) {
                if f.extension().map_or(true, |x| x != "jsonl") {
                    continue;
                }
                if let Ok(txt) = std::fs::read_to_string(&f) {
                    for line in txt.lines() {
                        if let Ok(v) = serde_json::from_str::<Value>(line) {
                            if let Some(id) = v.get("id").and_then(|x| x.as_str()) {
                                if !seen.insert(id.to_string()) {
                                    dup_ids.push(id.to_string());
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    // 每节点 seq 连续性
    let mut seq_issues: Vec<Value> = Vec::new();
    let mut by_node: std::collections::BTreeMap<String, Vec<u64>> = std::collections::BTreeMap::new();
    for e in &events {
        by_node.entry(e.node.clone()).or_default().push(e.seq);
    }
    for (node, seqs_ref) in &by_node {
        let mut seqs = seqs_ref.clone();
        seqs.sort_unstable();
        let uniq: HashSet<u64> = seqs.iter().cloned().collect();
        let max = *seqs.last().unwrap_or(&0);
        let missing = (1..=max).filter(|s| !uniq.contains(s)).count();
        let dup = seqs.len() - uniq.len();
        if missing > 0 || dup > 0 {
            seq_issues.push(json!({ "node": node, "max": max, "missing": missing, "duplicate": dup }));
        }
    }
    // 知识点引用
    let known = kc_index(packs_dir).into_keys().collect::<HashSet<String>>();
    let mut bad_kc: Vec<String> = Vec::new();
    for e in &events {
        for kc in &e.kc_ids {
            if !known.is_empty() && !known.contains(kc) && !bad_kc.contains(kc) {
                bad_kc.push(kc.clone());
            }
        }
    }
    json!({
        "events": events.len(),
        "nodes": by_node.keys().cloned().collect::<Vec<_>>(),
        "duplicate_ids": dup_ids,
        "seq_issues": seq_issues,
        "unknown_kc_refs": bad_kc,
        "ok": dup_ids.is_empty() && seq_issues.is_empty() && bad_kc.is_empty(),
    })
}

/// 生成近 7 天学习周报（Markdown，写入 <domain>/reports/）
pub fn weekly_report(root: &Path, packs_dir: &Path) -> Result<Value, String> {
    let p = ensure_domain(root)?;
    let st = derive(root, None);
    let events = read_events(root);
    let idx = kc_index(packs_dir);
    let now = chrono::Local::now();
    let from = now - Duration::days(7);
    let name = |id: &str| idx.get(id).map(|(n, _)| n.clone()).unwrap_or_else(|| id.to_string());

    let mut answers = 0u32;
    let mut correct = 0u32;
    let mut wrongs: Vec<&Event> = Vec::new();
    let mut kc_touch: HashSet<String> = HashSet::new();
    for e in &events {
        if let Some(ts) = parse_ts(&e.ts) {
            if ts < from {
                continue;
            }
        }
        if e.kind == "answer" {
            answers += 1;
            if e.ok_bool() {
                correct += 1;
            } else {
                wrongs.push(e);
            }
            for k in &e.kc_ids {
                kc_touch.insert(k.clone());
            }
        }
    }
    let plan = plan_list(root);
    let plan_done = plan
        .iter()
        .filter(|x| x.get("done").and_then(|v| v.as_bool()).unwrap_or(false))
        .count();

    let mut md = String::new();
    md.push_str(&format!(
        "# WORDO 学习周报 · {} ~ {}\n\n",
        from.format("%Y-%m-%d"),
        now.format("%Y-%m-%d")
    ));
    md.push_str(&format!(
        "节点 {} ｜ 事件 {} 条 ｜ 生成于 {}\n\n",
        st.node,
        events.len(),
        now.format("%Y-%m-%d %H:%M")
    ));
    md.push_str("## 概览\n");
    let rate = if answers > 0 {
        format!("{:.0}%", correct as f64 / answers as f64 * 100.0)
    } else {
        "-".to_string()
    };
    md.push_str(&format!("- 作答 **{}** 次，正确 **{}**（{}）\n", answers, correct, rate));
    md.push_str(&format!(
        "- 涉及知识点 **{}** 个；当前薄弱 **{}** 个；今日到期 **{}** 个\n",
        kc_touch.len(),
        weak_list(&st).len(),
        due_list(&st, None).len()
    ));
    md.push_str(&format!("- 学习计划完成 **{}/{}**\n\n", plan_done, plan.len()));

    md.push_str("## 薄弱与到期\n");
    let weak = weak_list(&st);
    if weak.is_empty() {
        md.push_str("- （无）\n");
    } else {
        md.push_str("| 知识点 | 掌握度 | 对 / 错 | 到期 |\n|---|---|---|---|\n");
        for k in weak.iter().take(10) {
            md.push_str(&format!(
                "| {} | {:.2} | {}/{} | {} |\n",
                name(&k.kc_id),
                k.mastery,
                k.correct,
                k.wrong,
                k.due_ts.clone().unwrap_or_else(|| "-".to_string())
            ));
        }
    }
    md.push('\n');

    md.push_str("## 本周错题\n");
    if wrongs.is_empty() {
        md.push_str("- （无）\n");
    } else {
        for e in wrongs.iter().rev().take(20) {
            md.push_str(&format!(
                "- {} `{}` 我选 {} / 正确 {}（{}）\n",
                &e.ts[..16.min(e.ts.len())],
                e.item_id,
                if e.answered.is_empty() { "?" } else { &e.answered },
                e.correct,
                e.kc_ids.iter().map(|k| name(k)).collect::<Vec<_>>().join("、")
            ));
        }
    }
    md.push('\n');

    md.push_str("## 学习计划\n");
    if plan.is_empty() {
        md.push_str("- （无）\n");
    } else {
        for x in &plan {
            let done = x.get("done").and_then(|v| v.as_bool()).unwrap_or(false);
            md.push_str(&format!(
                "- [{}] {}\n",
                if done { "x" } else { " " },
                x.get("text").and_then(|v| v.as_str()).unwrap_or("")
            ));
        }
    }
    md.push('\n');

    md.push_str("## 建议下一步\n");
    let mut suggestions: Vec<String> = Vec::new();
    for k in weak.iter().take(2) {
        suggestions.push(format!("先补齐「{}」（掌握度 {:.0}%）", name(&k.kc_id), k.mastery * 100.0));
    }
    for k in due_list(&st, None).iter().take(2) {
        suggestions.push(format!("今日到期：「{}」", name(&k.kc_id)));
    }
    if suggestions.is_empty() {
        suggestions.push("保持节奏：说「混合练 3 个薄弱点」做一次交错练习".to_string());
    }
    for s in suggestions {
        md.push_str(&format!("- {}\n", s));
    }

    let dir = p.root.join("reports");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file = dir.join(format!("周报-{}.md", now.format("%Y-%m-%d")));
    fs::write(&file, &md).map_err(|e| e.to_string())?;
    Ok(json!({ "path": file.display().to_string(), "markdown": md }))
}
