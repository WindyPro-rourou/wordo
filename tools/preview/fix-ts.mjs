import fs from "node:fs";
const P="tools/preview/backend.mjs";
let t=fs.readFileSync(P,"utf8");
t=t.replace(`  out.sort((a, b) => String(a.ts).localeCompare(String(b.ts)) || String(a.id).localeCompare(String(b.id)));`,
`  // 按「解析后的时间」排序（跨时区偏移时字符串序 != 时间序）
  out.sort((a, b) => (Date.parse(a.ts) || 0) - (Date.parse(b.ts) || 0) || String(a.id).localeCompare(String(b.id)));`);
fs.writeFileSync(P,t,"utf8");
console.log("✅ backend 会话事件按时间戳排序");
