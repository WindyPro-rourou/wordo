import fs from "node:fs";
const R="tools/consistency/run.mjs"; let r=fs.readFileSync(R,"utf8");
r=r.replace(`"confidence", "suggested_action"];`,`"confidence", "suggested_action", "tool_hints"]; // tool_hints 是教具建议，属主观选择`);
fs.writeFileSync(R,r,"utf8"); console.log("✅ tool_hints 归入主观");
