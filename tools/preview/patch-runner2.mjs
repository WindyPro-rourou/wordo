import fs from "node:fs";
const R="tools/consistency/run.mjs";
let r=fs.readFileSync(R,"utf8");
if(!r.includes("SUBJECTIVE_FIELDS")){
  r=r.replace(`/* ---------- 汇总 ---------- */`,
`/* ---------- 汇总：口径拆分（结构一致 vs 主观判断一致） ---------- */
const SUBJECTIVE_FIELDS = new Set(["error_type", "inferred", "root_cause_kc_id", "confidence"]);`);
  r=r.replace(`  let agree = 0, total = 0, diffs = [];
  if (vals.length >= 2) {
    for (const k of Object.keys(vals[0])) {
      total++;
      const set = new Set(vals.map((v) => JSON.stringify(v[k] ?? null)));
      if (set.size === 1) agree++;
      else diffs.push({ field: k, values: vals.map((v) => v[k]) });
    }
  }
  perCase.push({ case: r.case, task: r.task, models: vals.length, fields: total, agree, rate: total ? Math.round((agree / total) * 1000) / 10 : null, diffs });`,
`  let agree = 0, total = 0, sAgree = 0, sTotal = 0, diffs = [];
  if (vals.length >= 2) {
    for (const k of Object.keys(vals[0])) {
      total++;
      const same = new Set(vals.map((v) => JSON.stringify(v[k] ?? null))).size === 1;
      if (same) agree++; else diffs.push({ field: k, values: vals.map((v) => v[k]), subjective: SUBJECTIVE_FIELDS.has(k) });
      if (!SUBJECTIVE_FIELDS.has(k)) { sTotal++; if (same) sAgree++; }
    }
  }
  perCase.push({ case: r.case, task: r.task, models: vals.length, fields: total, agree, rate: total ? Math.round((agree / total) * 1000) / 10 : null, structural: sTotal ? Math.round((sAgree / sTotal) * 1000) / 10 : null, sAgree, sTotal, diffs });`);
  r=r.replace(`  overallAgreement: (() => { const t = perCase.reduce((s, x) => s + x.fields, 0), a = perCase.reduce((s, x) => s + x.agree, 0); return t ? Math.round((a / t) * 1000) / 10 : null; })(),`,
`  overallAgreement: (() => { const t = perCase.reduce((s, x) => s + x.fields, 0), a = perCase.reduce((s, x) => s + x.agree, 0); return t ? Math.round((a / t) * 1000) / 10 : null; })(),
  overallStructural: (() => { const t = perCase.reduce((s, x) => s + x.sTotal, 0), a = perCase.reduce((s, x) => s + x.sAgree, 0); return t ? Math.round((a / t) * 1000) / 10 : null; })(),`);
  // markdown 报告加结构一致率列
  r=r.replace('"| 用例 | 任务 | 参与模型 | 一致字段 | 一致率 |", "|---|---|---|---|---|",',
'"| 用例 | 任务 | 参与模型 | 结构一致 | 结构一致率 | 全字段一致率 |", "|---|---|---|---|---|---|",');
  r=r.replace('...perCase.map((x) => `| ${x.case} | ${x.task} | ${x.models} | ${x.agree}/${x.fields} | ${x.rate ?? "-"}% |`), "",',
'...perCase.map((x) => `| ${x.case} | ${x.task} | ${x.models} | ${x.sAgree}/${x.sTotal} | ${x.structural ?? "-"}% | ${x.rate ?? "-"}% |`), "",');
  r=r.replace('`**总体客观字段一致率：${summary.overallAgreement ?? "-"}%**`',
'`**结构一致率（剔除主观判断字段）：${summary.overallStructural ?? "-"}%**　｜　全字段一致率：${summary.overallAgreement ?? "-"}%`');
  fs.writeFileSync(R,r,"utf8"); console.log("✅ runner 口径拆分");
}
