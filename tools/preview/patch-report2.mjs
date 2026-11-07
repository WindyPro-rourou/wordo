import fs from "node:fs";

const weekly = fs.readFileSync("core/src/_weekly.part", "utf8");
const L = "core/src/learn.rs";
let t = fs.readFileSync(L, "utf8");
if (!t.includes("pub fn weekly_report(")) {
  t += weekly;
  fs.writeFileSync(L, t, "utf8");
  console.log("✅ learn.rs + weekly_report");
}

const A = "core/src/api.rs";
let a = fs.readFileSync(A, "utf8");
if (!a.includes("pub fn export_report(")) {
  a += "\npub fn export_report(domain: &str, packs_dir: &str) -> Result<Value, String> {\n    let d = resolve_domain(domain);\n    let p = resolve_packs(packs_dir);\n    learn::weekly_report(&d, &p)\n}\n";
  fs.writeFileSync(A, a, "utf8");
  console.log("✅ api export_report");
}

const TL = "apps/desktop/src-tauri/src/lib.rs";
let l = fs.readFileSync(TL, "utf8");
if (!l.includes("fn export_report(")) {
  l = l.replace(
    "#[cfg_attr(mobile, tauri::mobile_entry_point)]",
    "#[tauri::command]\nfn export_report(domain: String, packs_dir: String) -> Result<Value, String> {\n    api::export_report(&domain, &packs_dir)\n}\n\n#[cfg_attr(mobile, tauri::mobile_entry_point)]"
  );
  l = l.replace("            verify_ledger\n        ])", "            verify_ledger,\n            export_report\n        ])");
  fs.writeFileSync(TL, l, "utf8");
  console.log("✅ Tauri export_report");
}

const M = "core/src/main.rs";
let m = fs.readFileSync(M, "utf8");
if (!m.includes('"export_report" =>')) {
  m = m.replace('        "verify_ledger" => api::verify_ledger(', '        "export_report" => api::export_report(&s("domain"), &s("packsDir")),\n        "verify_ledger" => api::verify_ledger(');
  fs.writeFileSync(M, m, "utf8");
  console.log("✅ CLI export_report");
}

const B = "tools/preview/backend.mjs";
let b = fs.readFileSync(B, "utf8");
if (!b.includes("export function exportReport")) {
  const part = fs.readFileSync("tools/preview/_exportReport.part", "utf8");
  b = b.replace("export async function invoke(name, args = {}) {", part + "\nexport async function invoke(name, args = {}) {");
  b = b.replace('    case "verify_ledger":', '    case "export_report": return exportReport(domain, packsDir);\n    case "verify_ledger":');
  fs.writeFileSync(B, b, "utf8");
  console.log("✅ backend export_report");
}
console.log("done");
