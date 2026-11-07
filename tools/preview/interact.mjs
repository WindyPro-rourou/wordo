// 交互回归：学习计划增/勾、开始复习跳转、同步域、导出错题
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
p.on("pageerror", (e) => errs.push("pageerror: " + e.message));
p.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text().slice(0, 160)); });

const R = {};
await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
await p.waitForSelector(".pack-btn");
await p.evaluate(() => document.querySelector(".pack-btn").click());
await p.waitForTimeout(700);
await p.evaluate(() => document.querySelector('.tab[data-tab="me"]').click());
await p.waitForFunction(() => document.querySelectorAll(".me-stat").length > 0 && document.querySelector(".me-stat .n")?.textContent.trim() !== "…", { timeout: 15000 });
await p.waitForTimeout(400);

// 1) 添加学习任务
const planBefore = await p.evaluate(() => document.querySelectorAll(".me-plan li").length);
await p.fill("#me-plan-input", "把「函数的单调性」错题重做一遍");
await p.click("#me-plan-add");
await p.waitForTimeout(1200);
const planAfter = await p.evaluate(() => [...document.querySelectorAll(".me-plan li span")].map((x) => x.textContent.trim()));
R.planAdd = { before: planBefore, after: planAfter, ok: planAfter.some((t) => t.includes("函数的单调性")) };

// 2) 勾选完成
const firstCb = await p.$(".me-plan input[data-plan]");
if (firstCb) {
  await firstCb.check();
  await p.waitForTimeout(1200);
  R.planCheck = await p.evaluate(() => ({ doneCount: document.querySelectorAll(".me-plan li.done").length }));
}

// 3) 开始复习 → 跳学习页
await p.evaluate(() => { const b2 = document.querySelector(".me-go"); if (b2) b2.click(); });
await p.waitForTimeout(1200);
R.startReview = await p.evaluate(() => ({
  learnActive: !!document.querySelector('.tab[data-tab="learn"].active'),
  lessonHead: document.querySelector(".lesson-head h1")?.textContent?.trim() || "",
  flag: document.querySelector(".lesson-flag")?.textContent?.trim() || "",
}));

// 4) 同步域
await p.evaluate(() => document.querySelector('.tab[data-tab="me"]').click());
await p.waitForTimeout(900);
await p.evaluate(() => document.querySelector("#me-sync").click());
await p.waitForTimeout(2000);
R.sync = await p.evaluate(() => {
  const blocks = [...document.querySelectorAll(".me-block")].map((b) => b.innerText);
  const syncBlock = blocks.find((t) => t.includes("同步结果")) || "";
  return { has: !!syncBlock, text: syncBlock.replace(/\n+/g, " | ").slice(0, 300) };
});

// 5) 导出今日错题
await p.evaluate(() => document.querySelector("#me-delegate").click());
await p.waitForTimeout(2200);
R.delegate = await p.evaluate(() => document.querySelector(".me-msg")?.textContent?.trim() || null);

// 6) 处理域内委托（来自另一台设备）
const hasReview = await p.$("#me-review");
if (hasReview) {
  await p.evaluate(() => document.querySelector("#me-review").click());
  await p.waitForTimeout(35000);
  R.review = await p.evaluate(() => {
    const blocks = [...document.querySelectorAll(".me-block")].map((b) => b.innerText.replace(/\n+/g, " | "));
    const blk = blocks.find((t) => t.includes("委托处理")) || "";
    return { has: !!blk, text: blk.slice(0, 320) };
  });
}
await p.screenshot({ path: path.join(OUT, "interact-me.png"), fullPage: false });

R.errors = errs;
console.log(JSON.stringify(R, null, 2));
await b.close();
