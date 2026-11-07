import fs from "node:fs";
const R="tools/consistency/run.mjs";
let r=fs.readFileSync(R,"utf8");
r=r.replace(`const SUBJECTIVE_FIELDS = new Set(["error_type", "inferred", "root_cause_kc_id", "confidence"]);`,
`const SUBJECTIVE_FIELDS = new Set(["error_type", "inferred", "root_cause_kc_id", "confidence", "suggested_action"]); // suggested_action 由 error_type 派生，随之变化不算格式不一致`);
if(!r.includes("judgment:")){
  r=r.replace(`  perCase.push({ case: r.case, task: r.task, models: vals.length,`,`  // 判断类一致（error_type）：模型对「错因」的判断是否一致（这是教学信号，不是格式问题）
  let judgment = null;
  if (r.task === "classify-error" && vals.length >= 2) {
    const ets = new Set(vals.map((v) => v.error_type));
    judgment = { agree: ets.size === 1, values: [...ets] };
  }
  perCase.push({ case: r.case, task: r.task, models: vals.length, judgment,`);
  fs.writeFileSync(R,r,"utf8"); console.log("✅ 加 judgment 指标");
}
