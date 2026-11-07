import fs from "node:fs";
/* index.html: 我的/进度 → 今日 */
const I="apps/desktop/src/index.html"; let h=fs.readFileSync(I,"utf8");
h=h.replace('<button class="tab" data-tab="me">进度</button>','<button class="tab" data-tab="me">今日</button>');
h=h.replace('<span>进度</span>','<span>今日</span>');
h=h.replace('<button class="side-link" data-tab="me">进度</button>','<button class="side-link" data-tab="me">今日</button>');
h=h.replace('<button class="side-link" data-tab="me">我的账本</button>','<button class="side-link" data-tab="me">今日</button>');
fs.writeFileSync(I,h,"utf8"); console.log("✅ 页签改「今日」");

/* app.js */
const P="apps/desktop/src/app.js"; let t=fs.readFileSync(P,"utf8");
// 1) 页面标题 我的 → 今日
t=t.replace('<h1>我的</h1>','<h1>今日</h1>');
// 2) 队列移到薄弱之前
const weakBlockStart = t.indexOf('<section class="me-block">\n    <div class="block-label">薄弱知识点（${weak.length}）</div>');
const dueBlockStart = t.indexOf('<section class="me-block">\n    <div class="block-label">今日复习队列（${due.length}）</div>');
if (weakBlockStart>0 && dueBlockStart>0 && weakBlockStart < dueBlockStart) {
  const weakEnd = t.indexOf('</section>', weakBlockStart)+'</section>'.length;
  const dueEnd = t.indexOf('</section>', dueBlockStart)+'</section>'.length;
  const weakBlock = t.slice(weakBlockStart, weakEnd);
  const dueBlock = t.slice(dueBlockStart, dueEnd);
  const rest = t.slice(weakEnd, dueBlockStart);
  t = t.slice(0,weakBlockStart) + dueBlock + rest + weakBlock + t.slice(dueEnd);
  console.log("✅ 复习队列前置");
}
// 3) 导出周报按钮（放在三个域操作按钮后）
if(!t.includes('id="me-report"')){
  t=t.replace(`    <button class="btn btn-ghost" id="me-review" ${'${busy ? "disabled" : ""}'}>${'${busy === "review" ? "处理中…（调用模型，较慢）" : "处理域内委托"}'}</button>`,
`    <button class="btn btn-ghost" id="me-review" ${'${busy ? "disabled" : ""}'}>${'${busy === "review" ? "处理中…（调用模型，较慢）" : "处理域内委托"}'}</button>
    <button class="btn btn-ghost" id="me-report">导出周报</button>`);
  // 绑定
  t=t.replace(`  const bRev = view.querySelector("#me-review");
  if (bRev) bRev.onclick = runMeReview;`,
`  const bRev = view.querySelector("#me-review");
  if (bRev) bRev.onclick = runMeReview;
  const bRep = view.querySelector("#me-report");
  if (bRep) bRep.onclick = runMeReport;`);
  // 函数
  t=t.replace("async function runMeSync() {", `async function runMeReport() {
  state.me.busy = "report";
  refreshMe();
  try {
    const r = await invoke("export_report", { domain: getDomain(), packsDir: packsDirValue() });
    state.me.report = r;
    state.me.msg = "周报已生成：" + (r && r.path ? r.path : "");
  } catch (e) {
    state.me.error = "导出周报失败：" + readableErr(e);
  }
  state.me.busy = null;
  refreshMe();
}

async function runMeSync() {`);
  console.log("✅ 导出周报按钮");
}
fs.writeFileSync(P,t,"utf8");
