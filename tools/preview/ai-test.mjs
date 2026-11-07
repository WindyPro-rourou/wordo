// 端到端验证：界面里点「让 AI 讲一遍」→ 真调 NVIDIA → 渲染讲解 + 检测题 + 错因分析
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { chromium } from "playwright-core";
const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "shots");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 4310;

const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ["--no-sandbox", "--force-color-profile=srgb"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "zh-CN", timezoneId: "Asia/Shanghai" });
const page = await ctx.newPage();
const logs = [];
page.on("console", (m) => { if (m.type() === "error") logs.push(m.text().slice(0, 200)); });
page.on("pageerror", (e) => logs.push("pageerror: " + e.message));

const t0 = Date.now();
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
await page.waitForSelector(".pack-btn", { timeout: 10000 });
await page.waitForTimeout(400);

// 选「高中英语」包（第一个），确保落在有讲解的知识点
await page.evaluate(() => document.querySelector(".pack-btn")?.click());
await page.waitForTimeout(800);
await page.evaluate(() => { const t = document.querySelector('.tab[data-tab="learn"]'); if (t) t.click(); });
await page.waitForTimeout(500);

const result = { startedAt: new Date().toISOString() };

// 1) 让 AI 讲一遍
await page.evaluate(() => { const b = document.querySelector("#btn-ai"); if (b) { b.scrollIntoView({ block: "center" }); b.click(); } });
// 等 ai-card 或错误
const ok = await page.waitForFunction(
  () => !!document.querySelector(".lesson-block.ai-card:not(.skeleton)") || !!document.querySelector(".issue.err"),
  { timeout: 200000 }
).then(() => true).catch(() => false);
result.aiRenderMs = Date.now() - t0;
await page.waitForTimeout(500);
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(OUT, "ai-explain.png"), fullPage: false });

// 2) 读取渲染出来的内容
result.render = await page.evaluate(() => {
  const card = document.querySelector(".lesson-block.ai-card:not(.skeleton)");
  const err = document.querySelector(".issue.err");
  const label = card?.querySelector(".block-label")?.textContent?.trim() || "";
  const h3 = [...(card?.querySelectorAll("h3") || [])].map((x) => x.textContent.trim());
  const followup = card?.querySelector(".followup")?.innerText?.slice(0, 300) || "";
  const toolHint = card?.querySelector(".tool-hint")?.innerText?.trim() || "";
  return {
    hasCard: !!card, label, h3, followupLen: followup.length, followup: followup.replace(/\n+/g, " | ").slice(0, 260),
    toolHint,
    textLen: (card?.innerText || "").length,
    errorText: err ? err.textContent.trim().slice(0, 300) : null,
  };
});

// 3) 检测题选一个错项 → 点「让 AI 分析错因」
result.classify = null;
const hasFollowup = await page.evaluate(() => !!document.querySelector(".lesson-block.ai-card .followup .q-opt[data-pick]"));
if (hasFollowup) {
  // 找到正确答案与一个错误选项
  await page.evaluate(() => {
    const opts = [...document.querySelectorAll(".lesson-block.ai-card .followup .q-opt[data-pick]")];
    // 点击非正确项（渲染逻辑里正确项在点击前无法判断，故点第一个）
    if (opts[0]) opts[0].click();
  });
  await page.waitForTimeout(800);
  const btn = await page.$("#btn-classify");
  if (btn) {
    await page.evaluate(() => { const b = document.querySelector("#btn-classify"); b.scrollIntoView({ block: "center" }); b.click(); });
    const got = await page.waitForFunction(() => !!document.querySelector(".followup .ai-card"), { timeout: 200000 }).then(() => true).catch(() => false);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, "ai-classify.png"), fullPage: false });
    result.classify = await page.evaluate(() => {
      const c = document.querySelector(".followup .ai-card");
      return { ok: !!c, text: (c?.innerText || "").replace(/\n+/g, " | ").slice(0, 400) };
    });
    result.classifyWaited = got;
  } else {
    result.classify = { note: "未出现「分析错因」按钮（可能首选项恰好是正确答案）" };
  }
}

result.consoleErrors = logs;
fs.writeFileSync(path.join(HERE, "ai-report.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await browser.close();
