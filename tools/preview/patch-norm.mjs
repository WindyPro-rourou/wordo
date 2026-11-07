import fs from "node:fs";
const B="tools/preview/backend.mjs";
let b=fs.readFileSync(B,"utf8");
if(!b.includes("function normalizeExplain")){
  b=b.replace("function checkOutput(task, v, kcIds) {", `/** 确定性归一化：把「模型自由发挥」的高风险字段改成可复现的值 */
export function normalizeExplain(packPath, kcId, data) {
  try {
    const itemsDir = path.join(packPath, "items");
    if (!exists(itemsDir)) return data;
    for (const f of fs.readdirSync(itemsDir).filter((x) => x.endsWith(".json")).sort()) {
      const it = readJson(path.join(itemsDir, f));
      if (!(it.kc_ids || []).includes(kcId)) continue;
      if (!it.options || !it.options.length) continue;
      const opts = it.options.map((o) => String(o.text ?? o).replace(/^[A-D][.、]\\s*/, ""));
      data.followup_question = { stem: it.stem, options: opts, answer: String(it.answer || "").toUpperCase() };
      data.warnings = Array.isArray(data.warnings) ? data.warnings : [];
      data.warnings.push("检测题取自题库（确定性来源），非模型生成");
      return data;
    }
  } catch (e) {}
  return data;
}

const ACTION_BY_ERROR = { none: "none", knowledge_missing: "review_prereq", concept_confused: "split_concept", method_missing: "drill_similar", calculation_slip: "retry_later", misread: "re_explain" };
export function normalizeClassify(data) {
  const a = ACTION_BY_ERROR[data && data.error_type];
  if (a) data.suggested_action = a;
  return data;
}

function checkOutput(task, v, kcIds) {`);
  fs.writeFileSync(B,b,"utf8"); console.log("✅ backend 归一化函数");
}
// 在 askModel 校验通过后套用
let t=fs.readFileSync(B,"utf8");
if(!t.includes("normalizeExplain(packPath")){
  t=t.replace(`  return { ok: !!data && issues.length === 0, data, issues, first_issues: firstIssues, raw, model: prov.model, attempts };`,
`  if (data && issues.length === 0) {
    if (task === "explain") data = normalizeExplain(packPath, (req.payload && req.payload.kc_id) || data.kc_id, data);
    if (task === "classify-error") data = normalizeClassify(data);
  }
  return { ok: !!data && issues.length === 0, data, issues, first_issues: firstIssues, raw, model: prov.model, attempts };`);
  fs.writeFileSync(B,t,"utf8"); console.log("✅ askModel 套用归一化");
}
