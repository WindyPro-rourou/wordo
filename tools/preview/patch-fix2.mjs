import fs from "node:fs";
const B="tools/preview/backend.mjs"; let b=fs.readFileSync(B,"utf8");
if(!b.includes("export function planList(")){
  b=b.replace("export function exportReport(domain, packsDir) {", `/** 计划列表：从账本事件派生（与 Rust 一致） */
export function planList(domain) {
  const evs = readEvents(domain);
  const done = new Set(evs.filter((e) => e.kind === "plan_done").map((e) => e.task_id));
  const seen = new Set(); const list = [];
  for (const ev of evs.filter((e) => e.kind === "plan_add")) {
    if (!ev.task_id || seen.has(ev.task_id)) continue;
    seen.add(ev.task_id);
    list.push({ id: ev.task_id, text: ev.note || "", done: done.has(ev.task_id), by: ev.node });
  }
  return list;
}

export function exportReport(domain, packsDir) {`);
  fs.writeFileSync(B,b,"utf8"); console.log("✅ backend planList");
}
// runner 改用具体上游模型（auto/* 是路由组，跨调用可能落到不同上游，无法稳定测量）
const R="tools/consistency/run.mjs"; let r=fs.readFileSync(R,"utf8");
r=r.replace('const MODELS = arg("models", "auto/deepseek-v4.1-flash,auto/glm-5.3-flash")','const MODELS = arg("models", "deepseek-ai/deepseek-v4.1-flash,z-ai/glm-5.3-flash")');
fs.writeFileSync(R,r,"utf8"); console.log("✅ runner 用具体模型 id");
