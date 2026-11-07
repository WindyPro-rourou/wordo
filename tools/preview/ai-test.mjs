// 端到端：对话里「讲讲X」→ 真调模型 → 渲染讲解卡 + 检测题 + 判分
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { chromium } from "playwright-core";
const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "shots");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 4310;

const b = await chromium.launch({ executablePath: EDGE, headless: true, args: ["--no-sandbox", "--force-color-profile=srgb"] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, locale: "zh-CN" });
const p = await ctx.newPage();
const errs = [];
p.on("pageerror", (e) => errs.push(e.message));
const t0 = Date.now();
await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
await p.waitForSelector("#chat-input", { timeout: 15000 });
await p.waitForTimeout(800);
await p.fill("#chat-input", "讲讲一般过去时");
await p.press("#chat-input", "Enter");
const ok = await p.waitForFunction(() => !!document.querySelector(".msg-card"), { timeout: 180000 }).then(() => true).catch(() => false);
await p.waitForTimeout(600);
const R = { ok, ms: Date.now() - t0 };
R.render = await p.evaluate(() => {
  const card = document.querySelector(".msg-card");
  return {
    head: card?.querySelector(".msg-card-head")?.textContent?.trim() || "",
    h3: [...(card?.querySelectorAll("h3") || [])].map((x) => x.textContent.trim()),
    hasFollowup: !!card?.querySelector(".followup .q-opt"),
    len: (card?.innerText || "").length,
    subjectNote: document.querySelector(".msg-note")?.textContent?.trim().slice(0, 60) || "",
    chatSubj: document.querySelector(".chat-subj")?.textContent?.trim() || "",
  };
});
await p.screenshot({ path: path.join(OUT, "final-explain.png"), fullPage: false });
if (R.render.hasFollowup) {
  await p.evaluate(() => document.querySelectorAll(".msg-card .followup .q-opt")[0].click());
  await p.waitForTimeout(500);
  R.chips = await p.evaluate(() => ({ conf: document.querySelectorAll("[data-conf]").length, err: document.querySelectorAll("[data-err]").length }));
  await p.evaluate(() => { document.querySelector('[data-conf="certain"]')?.click(); });
  await p.waitForTimeout(1200);
  R.note = await p.evaluate(() => document.querySelector(".quiz-note")?.innerText?.replace(/\n+/g, " ").slice(0, 120) || "");
  await p.screenshot({ path: path.join(OUT, "final-answered.png"), fullPage: false });
}
R.errors = errs;
console.log(JSON.stringify(R, null, 2));
await b.close();
