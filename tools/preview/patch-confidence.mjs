import fs from "node:fs";

/* ================= Rust: learn.rs ================= */
const L = "core/src/learn.rs";
let t = fs.readFileSync(L, "utf8");

// 1) Event 增加 confidence 字段
if (!t.includes("pub confidence: Option<String>")) {
  t = t.replace("pub error_type: Option<String>,", "pub error_type: Option<String>,\n    /// 答题信心档：certain | unsure | guess（用于区分「蒙对」）\n    pub confidence: Option<String>,");
  console.log("✅ Event.confidence");
}

// 2) hist 存置信度
t = t.replace(
  "let mut hist: HashMap<String, Vec<(bool, DateTime<FixedOffset>)>> = HashMap::new();",
  "let mut hist: HashMap<String, Vec<(bool, DateTime<FixedOffset>, Option<String>)>> = HashMap::new();"
);
t = t.replace("hist.entry(kc.clone()).or_default().push((ok, ts));", "hist.entry(kc.clone()).or_default().push((ok, ts, ev.confidence.clone()));");
t = t.replace("for (ok, ts) in list {", "for (ok, ts, conf) in list {");
// 3) 掌握度：蒙对按 0.4 权重计入（区分「会」与「猜对」）
t = t.replace(
  `            wsum += w;
            if *ok {
                oksum += w;
            }`,
  `            wsum += w;
            if *ok {
                // 「蒙对」只按 40% 计入掌握度，避免高估
                let cw = if conf.as_deref() == Some("guess") { 0.4 } else { 1.0 };
                oksum += w * cw;
            }`
);

// 4) record_judged 接收 confidence
if (!t.includes("confidence: Option<String>,\n) -> Result<Value, String> {\n    let mut ev = Event::new(node, \"answer\");")) {
  t = t.replace(
    `    source: &str,
    error_type: Option<String>,
) -> Result<Value, String> {
    let mut ev = Event::new(node, "answer");`,
    `    source: &str,
    error_type: Option<String>,
    confidence: Option<String>,
) -> Result<Value, String> {
    let mut ev = Event::new(node, "answer");`
  );
  t = t.replace(
    `    ev.error_type = error_type;
    append_event(root, &ev)?;`,
    `    ev.error_type = error_type;
    ev.confidence = confidence;
    append_event(root, &ev)?;`
  );
  console.log("✅ record_judged 接 confidence");
}
fs.writeFileSync(L, t, "utf8");

/* ================= api.rs ================= */
const A = "core/src/api.rs";
let a = fs.readFileSync(A, "utf8");
if (!a.includes("confidence: Option<&str>")) {
  a = a.replace(
    `    source: &str,
    error_type: Option<&str>,
) -> Result<Value, String> {
    let d = resolve_domain(domain);
    let p = resolve_packs(packs_dir);
    let node = learn::node_id(&d)?;
    learn::record_judged(`,
    `    source: &str,
    error_type: Option<&str>,
    confidence: Option<&str>,
) -> Result<Value, String> {
    let d = resolve_domain(domain);
    let p = resolve_packs(packs_dir);
    let node = learn::node_id(&d)?;
    learn::record_judged(`
  );
  a = a.replace(
    `        source,
        error_type.map(|s| s.to_string()),
    )
}`,
    `        source,
        error_type.map(|s| s.to_string()),
        confidence.map(|s| s.to_string()),
    )
}`
  );
  fs.writeFileSync(A, a, "utf8");
  console.log("✅ api record_judged 接 confidence");
}

/* ================= Tauri ================= */
const TL = "apps/desktop/src-tauri/src/lib.rs";
let l = fs.readFileSync(TL, "utf8");
if (!l.includes("confidence: Option<String>,")) {
  l = l.replace(
    `    source: Option<String>,
    error_type: Option<String>,
) -> Result<Value, String> {
    api::record_judged(`,
    `    source: Option<String>,
    error_type: Option<String>,
    confidence: Option<String>,
) -> Result<Value, String> {
    api::record_judged(`
  );
  l = l.replace(
    `        source.as_deref().unwrap_or("followup"),
        error_type.as_deref(),
    )`,
    `        source.as_deref().unwrap_or("followup"),
        error_type.as_deref(),
        confidence.as_deref(),
    )`
  );
  fs.writeFileSync(TL, l, "utf8");
  console.log("✅ Tauri record_judged 接 confidence");
}

/* ================= CLI ================= */
const M = "core/src/main.rs";
let m = fs.readFileSync(M, "utf8");
if (!m.includes('os("confidence").as_deref()')) {
  m = m.replace(
    `            os("source").as_deref().unwrap_or("followup"),
            os("errorType").as_deref(),
        ),`,
    `            os("source").as_deref().unwrap_or("followup"),
            os("errorType").as_deref(),
            os("confidence").as_deref(),
        ),`
  );
  fs.writeFileSync(M, m, "utf8");
  console.log("✅ CLI 传 confidence");
}

/* ================= 预览后端 ================= */
const B = "tools/preview/backend.mjs";
let b = fs.readFileSync(B, "utf8");
// event 存 confidence
b = b.replace(
  `ok: !!args.ok, source: args.source || "followup", error_type: args.errorType || null,`,
  `ok: !!args.ok, source: args.source || "followup", error_type: args.errorType || null, confidence: args.confidence || null,`
);
// derive：蒙对降权
if (!b.includes("confidence === \"guess\"")) {
  b = b.replace(
    `      st.attempts++;
      if (ok) { st.correct++; st.streak++; st.interval_hours = st.streak === 1 ? 24 : Math.min(st.interval_hours * 2, MAX_INTERVAL); }`,
    `      st.attempts++;
      if (ok) { st.correct++; st.streak++; st.interval_hours = st.streak === 1 ? 24 : Math.min(st.interval_hours * 2, MAX_INTERVAL); }`
  );
  b = b.replace(
    `      const w = Math.pow(0.5, hours / 72);
      st._w += w; if (ok) st._o += w;`,
    `      const w = Math.pow(0.5, hours / 72);
      st._w += w;
      if (ok) st._o += w * (ev.confidence === "guess" ? 0.4 : 1);`
  );
  fs.writeFileSync(B, b, "utf8");
  console.log("✅ backend 蒙对降权");
}

console.log("done");
