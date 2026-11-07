// 补丁：learn.rs
// 1) plan_list 改为从账本派生  2) 追加 record_judged / record_explain / today_queue
import fs from "node:fs";
const P = "core/src/learn.rs";
let t = fs.readFileSync(P, "utf8");

// ---------- 1) plan_list ----------
const startIdx = t.indexOf("pub fn plan_list(root: &Path) -> Vec<Value> {");
if (startIdx < 0) throw new Error("找不到 plan_list");
// 找到该函数结束（下一个 "\n}\n" 之后）
let depth = 0, i = t.indexOf("{", startIdx), end = -1;
for (; i < t.length; i++) {
  if (t[i] === "{") depth++;
  else if (t[i] === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
}
if (end < 0) throw new Error("plan_list 括号不闭合");
const newFn = `/// 计划列表：**从账本事件派生**（唯一事实），不读共享 plan.md——多设备并发写 plan.md 会互相覆盖。
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
}`;
t = t.slice(0, startIdx) + newFn + t.slice(end);
console.log("✅ plan_list 已改为从账本派生");

// ---------- 2) 追加新函数（幂等） ----------
if (!t.includes("pub fn record_judged(")) {
  const block = `

/* ══════════ 判分即落账（讲解内检测题 / 学习页 followup 也走这里） ══════════ */

/// 记一次「无题库 item」的作答（讲解里的检测题）。
/// \`synthetic_id\` 例如 \`english.high::kc_eng_0002::followup\`，用来去重与追溯。
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
`;
  t += block;
  console.log("✅ 已追加 record_judged / record_explain");
}

fs.writeFileSync(P, t, "utf8");
console.log("写入完成，文件长度", t.length);
