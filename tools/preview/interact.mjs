// 交互回归（chat-first）：对话讲解 / 检测题判分 / 侧栏会话 / 我的页域操作
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
await p.waitForSelector("#chat-input");
await p.waitForTimeout(1200);

// 1) 初始状态：新对话 + 侧栏
R.initial = await p.evaluate(() => ({
  title: document.querySelector(".chat-title")?.textContent?.trim(),
  welcome: !!document.querySelector(".chat-welcome"),
  chatItems: document.querySelectorAll(".chat-item").length,
  newChatBtn: !!document.querySelector("#btn-new-chat"),
}));

// 2) 说「讲讲一般过去时」→ 自动判定学科 + 出讲解卡
await p.fill("#chat-input", "讲讲一般过去时");
await p.press("#chat-input", "Enter");
const okExplain = await p.waitForFunction(() => !!document.querySelector(".msg-card"), { timeout: 120000 }).then(() => true).catch(() => false);
await p.waitForTimeout(600);
R.explain = await p.evaluate(() => {
  const card = document.querySelector(".msg-card");
  const note = document.querySelector(".msg-note");
  return {
    ok: !!card,
    subjectNote: note ? note.textContent.trim().slice(0, 60) : null,
    head: card?.querySelector(".msg-card-head")?.textContent?.trim() || "",
    h3: [...(card?.querySelectorAll("h3") || [])].map((x) => x.textContent.trim()),
    hasFollowup: !!card?.querySelector(".followup .q-opt"),
    len: (card?.innerText || "").length,
    chatSubj: document.querySelector(".chat-subj")?.textContent?.trim(),
  };
});
await p.screenshot({ path: path.join(OUT, "chat-explain.png"), fullPage: false });

// 3) 检测题：点一个选项 → 判定文案
if (R.explain.hasFollowup) {
  await p.evaluate(() => {
    const opts = [...document.querySelectorAll(".msg-card .followup .q-opt")];
    if (opts[0]) opts[0].click();
  });
  await p.waitForTimeout(700);
  R.followupAnswer = await p.evaluate(() => document.querySelector(".quiz-note")?.textContent?.trim().slice(0, 80) || null);
}

// 4) 侧栏：新建对话 → 列表 +1，且回到欢迎态
const beforeNew = await p.evaluate(() => document.querySelectorAll(".chat-item").length);
await p.click("#btn-new-chat");
await p.waitForTimeout(1200);
R.newChat = await p.evaluate(() => ({
  before: 0,
  after: document.querySelectorAll(".chat-item").length,
  welcome: !!document.querySelector(".chat-welcome"),
  title: document.querySelector(".chat-title")?.textContent?.trim(),
}));
R.newChat.before = beforeNew;

// 5) 回到上一个会话 → 消息恢复
await p.evaluate(() => { const items = [...document.querySelectorAll(".chat-item")]; if (items[1]) items[1].click(); });
await p.waitForTimeout(1500);
R.reopen = await p.evaluate(() => ({ msgs: document.querySelectorAll(".msg").length, title: document.querySelector(".chat-title")?.textContent?.trim() }));

// 6) 我的页：计划 / 同步 / 导出 / 处理委托
await p.evaluate(() => document.querySelector('.tab[data-tab="me"]').click());
await p.waitForFunction(() => document.querySelectorAll(".me-stat").length > 0 && document.querySelector(".me-stat .n")?.textContent.trim() !== "…", { timeout: 15000 });
await p.waitForTimeout(300);
await p.fill("#me-plan-input", "重做「函数的单调性」错题");
await p.click("#me-plan-add");
await p.waitForTimeout(1200);
R.plan = await p.evaluate(() => [...document.querySelectorAll(".me-plan li span")].map((x) => x.textContent.trim()));
await p.evaluate(() => document.querySelector("#me-sync").click());
await p.waitForTimeout(1800);
R.sync = await p.evaluate(() => [...document.querySelectorAll(".me-block")].some((b) => b.innerText.includes("同步结果")));
await p.evaluate(() => document.querySelector("#me-delegate").click());
await p.waitForTimeout(2000);
R.delegate = await p.evaluate(() => document.querySelector(".me-msg")?.textContent?.trim().slice(0, 90) || null);
await p.evaluate(() => document.querySelector("#me-review").click());
await p.waitForTimeout(35000);
R.review = await p.evaluate(() => [...document.querySelectorAll(".me-block")].map((b) => b.innerText.replace(/\n+/g, " | ")).find((t) => t.includes("委托处理"))?.slice(0, 200) || null);
await p.screenshot({ path: path.join(OUT, "chat-me.png"), fullPage: false });

// 7) 教师视图（设置里的入口）
await p.evaluate(() => document.querySelector('.tab[data-tab="settings"]').click());
await p.waitForTimeout(800);
R.teacherView = await p.evaluate(() => {
  const btn = [...document.querySelectorAll("[data-goto]")][0];
  if (btn) btn.click();
  return { clicked: !!btn };
});
await p.waitForTimeout(900);
R.teacherView.rendered = await p.evaluate(() => ({ viewItems: document.querySelectorAll(".acc").length, head: document.querySelector("#view")?.innerText.slice(0, 40) }));

R.errors = errs;
console.log(JSON.stringify(R, null, 2));
await b.close();
