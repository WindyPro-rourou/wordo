import fs from "node:fs";
const B="tools/preview/backend.mjs";
let b=fs.readFileSync(B,"utf8");
if(!b.includes("export function buildPromptFor")){
  b=b.replace("function buildPromptPayload(task, packPath, payload) {","export function buildPromptFor(task, packPath, payload) { return buildPromptPayload(task, packPath, payload); }\n\nfunction buildPromptPayload(task, packPath, payload) {");
  fs.writeFileSync(B,b,"utf8"); console.log("✅ 导出 buildPromptFor");
} else console.log("已导出");
// checkOutput 收紧：schema_ver / warnings 元素 / secondary_factor / 长度
let t=fs.readFileSync(B,"utf8");
if(!t.includes('v.schema_ver !== "1"')){
  t=t.replace(`  if (!Array.isArray(v?.warnings)) e.push("缺少 warnings 数组");`,
`  if (!Array.isArray(v?.warnings)) e.push("缺少 warnings 数组");
  else if (v.warnings.some((w) => typeof w !== "string")) e.push("warnings 元素必须是字符串");
  if (v?.schema_ver !== "1") e.push('schema_ver 必须为 "1"');`);
  t=t.replace(`    const q = v.followup_question;`,`    if (v.explanation_md && String(v.explanation_md).length > 2000) e.push("explanation_md 超过 2000 字");
    if (Array.isArray(v.tool_hints) && v.tool_hints.some((h) => !["canvas-geometry","graph-plot","physics-sim","timeline","mindmap","answer-board","none"].includes(h))) e.push("tool_hints 含未知值");
    const q = v.followup_question;`);
  t=t.replace(`  } else if (task === "classify-error") {`,
`  } else if (task === "classify-error") {
    if (v.secondary_factor !== undefined && v.secondary_factor !== null && !["knowledge_missing","concept_confused","method_missing","calculation_slip","misread"].includes(v.secondary_factor)) e.push("secondary_factor 枚举非法");`);
  fs.writeFileSync(B,t,"utf8"); console.log("✅ backend 校验收紧");
}
