import fs from "node:fs";
/* ---------- Rust learn.rs：weekly_report ---------- */
const L="core/src/learn.rs"; let t=fs.readFileSync(L,"utf8");
if(!t.includes("pub fn weekly_report(")){
  t += `
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
        let ts = parse_ts(&e.ts);
        if let Some(ts) = ts {
            if ts < from {
                continue;
            }
        }
        match e.kind.as_str() {
            "answer" => {
                answers += 1;
                if e.ok_bool() { correct += 1; } else { wrongs.push(e); }
                for k in &e.kc_ids { kc_touch.insert(k.clone()); }
            }
            _ => {}
        }
    }
    let plan = plan_list(root);
    let plan_done = plan.iter().filter(|x| x.get("done").and_then(|v| v.as_bool()).unwrap_or(false)).count();

    let mut md = String::new();
    md.push_str(&format!("# WORDO 学习周报 · {} ~ {}\n\n", from.format("%Y-%m-%d"), now.format("%Y-%m-%d")));
    md.push_str(&format!("节点 `{}` ｜ 事件 {} 条 ｜ 生成于 {}\n\n", st.node, events.len(), now.format("%Y-%m-%d %H:%M")));
    md.push_str("## 概览\n");
    let rate = if answers > 0 { format!("{:.0}%", correct as f64 / answers as f64 * 100.0) } else { "-".into() };
    md.push_str(&format!("- 作答 **{}** 次，正确 **{}**（{}）\n", answers, correct, rate));
    md.push_str(&format!("- 涉及知识点 **{}** 个；当前薄弱 **{}** 个；今日到期 **{}** 个\n", kc_touch.len(), weak_list(&st).len(), due_list(&st, None).len()));
    md.push_str(&format!("- 学习计划完成 **{}/{}**\n\n", plan_done, plan.len()));

    md.push_str("## 薄弱与到期\n");
    let weak = weak_list(&st);
    if weak.is_empty() {
        md.push_str("- （无）\n");
    } else {
        md.push_str("| 知识点 | 掌握度 | 对 / 错 | 到期 |\n|---|---|---|---|\n");
        for k in weak.iter().take(10) {
            md.push_str(&format!("| {} | {:.2} | {}/{} | {} |\n", name(&k.kc_id), k.mastery, k.correct, k.wrong, k.due_ts.clone().unwrap_or_else(|| "-".into())));
        }
    }
    md.push('\n');

    md.push_str("## 本周错题\n");
    if wrongs.is_empty() {
        md.push_str("- （无）\n");
    } else {
        for e in wrongs.iter().rev().take(20) {
            md.push_str(&format!("- {} `{}` 我选 {} / 正确 {}（{}）\n",
                &e.ts[..16.min(e.ts.len())], e.item_id,
                if e.answered.is_empty() { "?" } else { &e.answered },
                e.correct,
                e.kc_ids.iter().map(|k| name(k)).collect::<Vec<_>>().join("、")));
        }
    }
    md.push('\n');

    md.push_str("## 学习计划\n");
    if plan.is_empty() {
        md.push_str("- （无）\n");
    } else {
        for x in &plan {
            let done = x.get("done").and_then(|v| v.as_bool()).unwrap_or(false);
            md.push_str(&format!("- [{}] {}\n", if done { "x" } else { " " }, x.get("text").and_then(|v| v.as_str()).unwrap_or("")));
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
        suggestions.push("保持节奏：说「给我出两道题」做一次混合练习".into());
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
`;
  fs.writeFileSync(L,t,"utf8"); console.log("✅ rust weekly_report");
}
/* api.rs */
const A="core/src/api.rs"; let a=fs.readFileSync(A,"utf8");
if(!a.includes("pub fn export_report(")){
  a += `
pub fn export_report(domain: &str, packs_dir: &str) -> Result<Value, String> {
    let d = resolve_domain(domain);
    let p = resolve_packs(packs_dir);
    learn::weekly_report(&d, &p)
}
`;
  fs.writeFileSync(A,a,"utf8"); console.log("✅ api export_report");
}
/* Tauri + CLI */
const TL="apps/desktop/src-tauri/src/lib.rs"; let l=fs.readFileSync(TL,"utf8");
if(!l.includes("fn export_report(")){
  l=l.replace("#[cfg_attr(mobile, tauri::mobile_entry_point)]",`#[tauri::command]
fn export_report(domain: String, packs_dir: String) -> Result<Value, String> {
    api::export_report(&domain, &packs_dir)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]`);
  l=l.replace("            verify_ledger\n        ])","            verify_ledger,\n            export_report\n        ])");
  fs.writeFileSync(TL,l,"utf8"); console.log("✅ Tauri export_report");
}
const M="core/src/main.rs"; let m=fs.readFileSync(M,"utf8");
if(!m.includes('"export_report" =>')){
  m=m.replace('        "verify_ledger" => api::verify_ledger(','        "export_report" => api::export_report(&s("domain"), &s("packsDir")),\n        "verify_ledger" => api::verify_ledger(');
  fs.writeFileSync(M,m,"utf8"); console.log("✅ CLI export_report");
}
/* backend */
const B="tools/preview/backend.mjs"; let b=fs.readFileSync(B,"utf8");
if(!b.includes("export function exportReport")){
  b=b.replace("export async function invoke(name, args = {}) {", `export function exportReport(domain, packsDir) {
  const d = ensureDomain(domain);
  const st = derive(domain);
  const events = readEvents(domain);
  const idx = kcIndex(packsDir || state.packsDir);
  const nm = (id) => (idx.get(id) || { name: id }).name;
  const from = new Date(Date.now() - 7 * 86400000);
  let answers = 0, correct = 0; const wrongs = []; const kcSet = new Set();
  for (const e of events) {
    const ts = Date.parse(e.ts) || 0;
    if (ts < from.getTime()) continue;
    if (e.kind !== "answer") continue;
    answers++; if (e.ok) correct++; else wrongs.push(e);
    (e.kc_ids || []).forEach((k) => kcSet.add(k));
  }
  const plan = planList(domain);
  const planDone = plan.filter((x) => x.done).length;
  const weak = weakList(st), due = dueList(st);
  const fmt = (t) => new Date(t).toISOString().slice(0, 10);
  let md = "# WORDO 学习周报 · " + fmt(from) + " ~ " + fmt(Date.now()) + "\\n\\n";
  md += "节点 \`" + st.node + "\` ｜ 事件 " + events.length + " 条\\n\\n## 概览\\n";
  md += "- 作答 **" + answers + "** 次，正确 **" + correct + "**（" + (answers ? Math.round((correct / answers) * 100) + "%" : "-") + "）\\n";
  md += "- 涉及知识点 **" + kcSet.size + "** 个；薄弱 **" + weak.length + "**；今日到期 **" + due.length + "**\\n";
  md += "- 计划完成 **" + planDone + "/" + plan.length + "**\\n\\n## 薄弱与到期\\n";
  if (!weak.length) md += "- （无）\\n";
  else { md += "| 知识点 | 掌握度 | 对 / 错 | 到期 |\\n|---|---|---|---|\\n"; for (const k of weak.slice(0, 10)) md += "| " + nm(k.kc_id) + " | " + (Math.round(k.mastery * 100) / 100) + " | " + k.correct + "/" + k.wrong + " | " + (k.due_ts || "-") + " |\\n"; }
  md += "\\n## 本周错题\\n";
  if (!wrongs.length) md += "- （无）\\n";
  else for (const e of wrongs.reverse().slice(0, 20)) md += "- " + String(e.ts).slice(0, 16) + " \`" + e.item_id + "\` 我选 " + (e.answered || "?") + " / 正确 " + e.correct + "（" + (e.kc_ids || []).map(nm).join("、") + "）\\n";
  md += "\\n## 学习计划\\n";
  if (!plan.length) md += "- （无）\\n"; else for (const x of plan) md += "- [" + (x.done ? "x" : " ") + "] " + x.text + "\\n";
  md += "\\n## 建议下一步\\n";
  const sug = [];
  for (const k of weak.slice(0, 2)) sug.push("先补齐「" + nm(k.kc_id) + "」（掌握度 " + Math.round(k.mastery * 100) + "%）");
  for (const k of due.slice(0, 2)) sug.push("今日到期：「" + nm(k.kc_id) + "」");
  if (!sug.length) sug.push("保持节奏：说「混合练 3 个薄弱点」做一次交错练习");
  for (const s of sug) md += "- " + s + "\\n";
  const dir = path.join(d, "reports"); ensureDir(dir);
  const file = path.join(dir, "周报-" + new Date().toISOString().slice(0, 10) + ".md");
  fs.writeFileSync(file, md, "utf8");
  return { path: file, markdown: md };
}

export async function invoke(name, args = {}) {`);
  b=b.replace('    case "verify_ledger":','    case "export_report": return exportReport(domain, packsDir);\n    case "verify_ledger":');
  fs.writeFileSync(B,b,"utf8"); console.log("✅ backend export_report");
}
