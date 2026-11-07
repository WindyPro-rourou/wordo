import fs from "node:fs";

/* ========== learn.rs：Event.seq + append 自动递增 + verify_ledger ========== */
const L = "core/src/learn.rs";
let t = fs.readFileSync(L, "utf8");

if (!t.includes("pub seq: u64,")) {
  t = t.replace("pub kind: String,", "pub kind: String,\n    /// 每节点单调递增序号（并发合并时可检测重放/乱序）\n    pub seq: u64,");
  console.log("✅ Event.seq");
}

// append_event：写入前补 seq（取本节点已有最大 seq + 1）
if (!t.includes("fn next_seq(")) {
  t = t.replace(
    `pub fn append_event(root: &Path, ev: &Event) -> Result<(), String> {
    let p = ensure_domain(root)?;
    fs::create_dir_all(p.ledger_dir()).map_err(|e| e.to_string())?;
    let line = serde_json::to_string(ev).map_err(|e| e.to_string())?;`,
    `/// 本节点账本里已有的最大 seq
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
    let line = serde_json::to_string(&ev2).map_err(|e| e.to_string())?;`
  );
  t = t.replace(
    `    let mut f = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(p.ledger_of(&ev.node))
        .map_err(|e| format!("打开账本失败: {e}"))?;`,
    `    let mut f = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(p.ledger_of(&ev2.node))
        .map_err(|e| format!("打开账本失败: {e}"))?;`
  );
  console.log("✅ append_event 自动 seq");
}

// verify_ledger
if (!t.includes("pub fn verify_ledger(")) {
  t += `
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
    for (node, mut seqs) in by_node {
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
`;
  console.log("✅ verify_ledger");
}
fs.writeFileSync(L, t, "utf8");

/* ========== api.rs ========== */
const A = "core/src/api.rs";
let a = fs.readFileSync(A, "utf8");
if (!a.includes("pub fn verify_ledger(")) {
  a += `
pub fn verify_ledger(domain: &str, packs_dir: &str) -> Result<Value, String> {
    let d = resolve_domain(domain);
    let p = resolve_packs(packs_dir);
    Ok(learn::verify_ledger(&d, &p))
}
`;
  fs.writeFileSync(A, a, "utf8");
  console.log("✅ api::verify_ledger");
}

/* ========== Tauri + CLI ========== */
const TL = "apps/desktop/src-tauri/src/lib.rs";
let l = fs.readFileSync(TL, "utf8");
if (!l.includes("fn verify_ledger(")) {
  l = l.replace(
    "#[cfg_attr(mobile, tauri::mobile_entry_point)]",
    `#[tauri::command]
fn verify_ledger(domain: String, packs_dir: String) -> Result<Value, String> {
    api::verify_ledger(&domain, &packs_dir)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]`
  );
  l = l.replace("            record_explain\n        ])", "            record_explain,\n            verify_ledger\n        ])");
  fs.writeFileSync(TL, l, "utf8");
  console.log("✅ Tauri verify_ledger");
}
const M = "core/src/main.rs";
let m = fs.readFileSync(M, "utf8");
if (!m.includes('"verify_ledger" =>')) {
  m = m.replace('        "record_judged" => api::record_judged(', `        "verify_ledger" => api::verify_ledger(&s("domain"), &s("packsDir")),
        "record_judged" => api::record_judged(`);
  fs.writeFileSync(M, m, "utf8");
  console.log("✅ CLI verify_ledger");
}

/* ========== 预览后端：seq + nodeOverride + verify ========== */
const B = "tools/preview/backend.mjs";
let b = fs.readFileSync(B, "utf8");
// nodeOverride 支持（用于模拟多节点）
if (!b.includes("state.nodeOverride")) {
  b = b.replace(
    `export function nodeId(domain) {
  const d = domainRoot(domain);`,
    `export function nodeId(domain) {
  if (state.nodeOverride) return state.nodeOverride; // 测试用：模拟不同设备
  const d = domainRoot(domain);`
  );
  b = b.replace("export const state = { packsDir: \"\", domain: \"\", configPath: \"\" };", "export const state = { packsDir: \"\", domain: \"\", configPath: \"\", nodeOverride: \"\" };");
  console.log("✅ nodeOverride");
}
// appendEvent 自动 seq
if (!b.includes("function nextSeq(")) {
  b = b.replace(
    `export function appendEvent(domain, ev) {
  const dir = ledgerDir(domain); ensureDir(dir);
  fs.appendFileSync(path.join(dir, \`\${ev.node}.jsonl\`), JSON.stringify(ev) + "\\n");
}`,
    `function nextSeq(file) {
  let max = 0;
  if (exists(file)) for (const line of fs.readFileSync(file, "utf8").split(/\\r?\\n/)) {
    const s = line.trim(); if (!s) continue;
    try { const v = JSON.parse(s); if (v.seq && v.seq > max) max = v.seq; } catch {}
  }
  return max + 1;
}

export function appendEvent(domain, ev) {
  const dir = ledgerDir(domain); ensureDir(dir);
  const file = path.join(dir, \`\${ev.node}.jsonl\`);
  const out = { ...ev };
  if (!out.seq) out.seq = nextSeq(file);
  fs.appendFileSync(file, JSON.stringify(out) + "\\n");
}`
  );
  console.log("✅ backend appendEvent seq");
}
// verify_ledger 实现 + case
if (!b.includes("export function verifyLedger(")) {
  b = b.replace("export async function invoke(name, args = {}) {", `export function verifyLedger(domain, packsDir) {
  const dir = ledgerDir(domain);
  const dupIds = [];
  const seqByNode = {};
  const all = [];
  if (exists(dir)) for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".jsonl"))) {
    const node = f.replace(/\\.jsonl$/, "");
    seqByNode[node] = seqByNode[node] || [];
    for (const line of fs.readFileSync(path.join(dir, f), "utf8").split(/\\r?\\n/)) {
      const s = line.trim(); if (!s) continue;
      try { const v = JSON.parse(s); all.push(v); if (v.seq) seqByNode[node].push(v.seq); } catch {}
    }
  }
  const seen = new Set();
  for (const v of all) { if (seen.has(v.id)) dupIds.push(v.id); else seen.add(v.id); }
  const seqIssues = [];
  for (const [node, seqs] of Object.entries(seqByNode)) {
    const uniq = new Set(seqs);
    const max = seqs.length ? Math.max(...seqs) : 0;
    let missing = 0;
    for (let i = 1; i <= max; i++) if (!uniq.has(i)) missing++;
    const duplicate = seqs.length - uniq.size;
    if (missing || duplicate) seqIssues.push({ node, max, missing, duplicate });
  }
  const known = new Set(kcIndex(packsDir || state.packsDir).keys());
  const badKc = [...new Set(all.flatMap((e) => e.kc_ids || []).filter((k) => known.size && !known.has(k)))];
  return { events: all.length, nodes: Object.keys(seqByNode), duplicate_ids: dupIds, seq_issues: seqIssues, unknown_kc_refs: badKc, ok: !dupIds.length && !seqIssues.length && !badKc.length };
}

export async function invoke(name, args = {}) {`);
  b = b.replace('    case "chat_list":', '    case "verify_ledger": return verifyLedger(domain, packsDir);\n    case "chat_list":');
  console.log("✅ backend verify_ledger");
}
fs.writeFileSync(B, b, "utf8");
console.log("done");
