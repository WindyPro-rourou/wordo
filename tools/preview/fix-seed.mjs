import fs from "node:fs";
const P="tools/preview/seed.mjs";
let t=fs.readFileSync(P,"utf8");
if(!t.includes('kind: "plan_add"')){
  t=t.replace(`const evs = [];`,`const evs = [];
// 计划任务也写进账本（plan.md 已降级为派生视图，不再作为事实源）
evs.push({ id: \`p1-\${node}\`, ts: iso(daysAgo(3)), node, kind: "plan_add", task_id: "t1", note: "三天内把「一般过去时」练到掌握" });
evs.push({ id: \`p2-\${node}\`, ts: iso(daysAgo(2)), node, kind: "plan_add", task_id: "t2", note: "整理定语从句的关系词选择判据" });`);
  fs.writeFileSync(P,t,"utf8");
  console.log("✅ seed 写入 plan_add 事件");
} else console.log("已存在");
