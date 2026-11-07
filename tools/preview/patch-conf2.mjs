import fs from "node:fs";

/* learn.rs: record_answer 增加 confidence */
const L = "core/src/learn.rs";
let t = fs.readFileSync(L, "utf8");
if (!t.includes("pub fn record_answer(\n    root: &Path,")) throw new Error("record_answer 签名不同");
if (!t.includes("    confidence: Option<String>,\n) -> Result<AnswerOut, String>")) {
  t = t.replace(
    `    source: &str,
    error_type: Option<String>,
) -> Result<AnswerOut, String> {`,
    `    source: &str,
    error_type: Option<String>,
    confidence: Option<String>,
) -> Result<AnswerOut, String> {`
  );
  t = t.replace(
    `    ev.error_type = error_type;
    ev.source = source.to_string();
    append_event(root, &ev)?;

    let st = derive(root, None);`,
    `    ev.error_type = error_type;
    ev.source = source.to_string();
    ev.confidence = confidence;
    append_event(root, &ev)?;

    let st = derive(root, None);`
  );
  fs.writeFileSync(L, t, "utf8");
  console.log("✅ learn::record_answer 接 confidence");
}

/* api.rs */
const A = "core/src/api.rs";
let a = fs.readFileSync(A, "utf8");
if (!a.includes("    confidence: Option<&str>,\n) -> Result<Value, String> {\n    let d = resolve_domain(domain);\n    let p = resolve_packs(packs_dir);\n    let node = learn::node_id(&d)?;\n    let out = learn::record_answer(")) {
  a = a.replace(
    `    answered: &str,
    source: Option<&str>,
) -> Result<Value, String> {
    let d = resolve_domain(domain);
    let p = resolve_packs(packs_dir);
    let node = learn::node_id(&d)?;
    let out = learn::record_answer(`,
    `    answered: &str,
    source: Option<&str>,
    error_type: Option<&str>,
    confidence: Option<&str>,
) -> Result<Value, String> {
    let d = resolve_domain(domain);
    let p = resolve_packs(packs_dir);
    let node = learn::node_id(&d)?;
    let out = learn::record_answer(`
  );
  a = a.replace(
    `&out,
        source.unwrap_or("quiz"),
        None,
    )?;`,
    `&out,
        source.unwrap_or("quiz"),
        error_type.map(|s| s.to_string()),
        confidence.map(|s| s.to_string()),
    )?;`
  );
  fs.writeFileSync(A, a, "utf8");
  console.log("✅ api::record_answer 接 error_type/confidence");
}

/* Tauri */
const TL = "apps/desktop/src-tauri/src/lib.rs";
let l = fs.readFileSync(TL, "utf8");
if (!l.includes("    error_type: Option<String>,\n    confidence: Option<String>,\n) -> Result<Value, String> {\n    api::record_answer(")) {
  l = l.replace(
    `    answered: String,
    source: Option<String>,
) -> Result<Value, String> {
    api::record_answer(&domain, &packs_dir, &pack, &item_id, &answered, source.as_deref())
}`,
    `    answered: String,
    source: Option<String>,
    error_type: Option<String>,
    confidence: Option<String>,
) -> Result<Value, String> {
    api::record_answer(&domain, &packs_dir, &pack, &item_id, &answered, source.as_deref(), error_type.as_deref(), confidence.as_deref())
}`
  );
  fs.writeFileSync(TL, l, "utf8");
  console.log("✅ Tauri record_answer 接 error_type/confidence");
}

/* 预览后端 */
const B = "tools/preview/backend.mjs";
let b = fs.readFileSync(B, "utf8");
b = b.replace(
  `const ev = { id: \`\${Date.now()}-0-\${node}\`, ts: nowIso(), node, kind: "answer", pack: args.pack || it.pack || "", item_id: it.id, kc_ids: it.kc_ids || [], answered: args.answered || "", correct: it.answer, ok, source: args.source || "quiz" };`,
  `const ev = { id: \`\${Date.now()}-0-\${node}\`, ts: nowIso(), node, kind: "answer", pack: args.pack || it.pack || "", item_id: it.id, kc_ids: it.kc_ids || [], answered: args.answered || "", correct: it.answer, ok, source: args.source || "quiz", error_type: args.errorType || null, confidence: args.confidence || null };`
);
fs.writeFileSync(B, b, "utf8");
console.log("✅ backend record_answer 存 error_type/confidence");
