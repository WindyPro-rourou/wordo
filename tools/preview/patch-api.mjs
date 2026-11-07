import fs from "node:fs";

// 1) api.rs：追加 record_judged / record_explain
const A = "core/src/api.rs";
let a = fs.readFileSync(A, "utf8");
if (!a.includes("pub fn record_judged(")) {
  a += `
/* ══════════ 判分即落账（讲解检测题 / 学习页 followup） ══════════ */

/// 无题库 item 的判分（讲解里的检测题）：把结果写进账本，环路才闭合。
pub fn record_judged(
    domain: &str,
    packs_dir: &str,
    pack: &str,
    kc_id: &str,
    synthetic_id: &str,
    answered: &str,
    ok: bool,
    source: &str,
    error_type: Option<&str>,
) -> Result<Value, String> {
    let d = resolve_domain(domain);
    let p = resolve_packs(packs_dir);
    let node = learn::node_id(&d)?;
    learn::record_judged(
        &d,
        &p,
        &node,
        pack,
        kc_id,
        synthetic_id,
        answered,
        ok,
        source,
        error_type.map(|s| s.to_string()),
    )
}

/// 记录一次「讲解已展示」（A3 留痕）
pub fn record_explain(domain: &str, pack: &str, kc_id: &str, model: &str, source: &str) -> Result<Value, String> {
    let d = resolve_domain(domain);
    let node = learn::node_id(&d)?;
    learn::record_explain(&d, &node, pack, kc_id, model, source)
}
`;
  fs.writeFileSync(A, a, "utf8");
  console.log("✅ api.rs 追加 record_judged / record_explain");
} else console.log("api.rs 已有，跳过");

// 2) Tauri：加命令 + 注册
const L = "apps/desktop/src-tauri/src/lib.rs";
let l = fs.readFileSync(L, "utf8");
if (!l.includes("fn record_judged(")) {
  const cmds = `
/* ══════════ 判分即落账 ══════════ */

#[tauri::command]
fn record_judged(
    domain: String,
    packs_dir: String,
    pack: String,
    kc_id: String,
    synthetic_id: String,
    answered: String,
    ok: bool,
    source: Option<String>,
    error_type: Option<String>,
) -> Result<Value, String> {
    api::record_judged(
        &domain,
        &packs_dir,
        &pack,
        &kc_id,
        &synthetic_id,
        &answered,
        ok,
        source.as_deref().unwrap_or("followup"),
        error_type.as_deref(),
    )
}

#[tauri::command]
fn record_explain(domain: String, pack: String, kc_id: String, model: String, source: Option<String>) -> Result<Value, String> {
    api::record_explain(&domain, &pack, &kc_id, &model, source.as_deref().unwrap_or("ai"))
}
`;
  l = l.replace("#[cfg_attr(mobile, tauri::mobile_entry_point)]", cmds + "\n#[cfg_attr(mobile, tauri::mobile_entry_point)]");
  l = l.replace("            detect_subject\n        ])", "            detect_subject,\n            record_judged,\n            record_explain\n        ])");
  fs.writeFileSync(L, l, "utf8");
  console.log("✅ Tauri 命令已加");
} else console.log("Tauri 已有，跳过");

// 3) CLI：api 分发加两个 case（便于脚本与一致性测试）
const M = "core/src/main.rs";
let m = fs.readFileSync(M, "utf8");
if (!m.includes('"record_judged" =>')) {
  m = m.replace(
    '        "learn_plan" => api::learn_plan(',
    `        "record_judged" => api::record_judged(
            &s("domain"),
            &s("packsDir"),
            &s("pack"),
            &s("kcId"),
            &s("syntheticId"),
            &s("answered"),
            a.get("ok").and_then(|v| v.as_bool()).unwrap_or(false),
            os("source").as_deref().unwrap_or("followup"),
            os("errorType").as_deref(),
        ),
        "record_explain" => api::record_explain(
            &s("domain"),
            &s("pack"),
            &s("kcId"),
            &s("model"),
            os("source").as_deref().unwrap_or("ai"),
        ),
        "learn_plan" => api::learn_plan(`
  );
  fs.writeFileSync(M, m, "utf8");
  console.log("✅ CLI api 分发已加");
} else console.log("CLI 已有，跳过");
