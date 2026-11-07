// 抓 ask_model 的响应体 + 点击后 DOM 状态
import { chromium } from "playwright-core";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const b = await chromium.launch({ executablePath: EDGE, headless: true, args: ["--no-sandbox"] });
const p = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
p.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
p.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE-ERR:", m.text().slice(0, 240)); });
p.on("response", async (r) => {
  if (r.url().includes("/api/ask_model")) {
    const t = await r.text().catch(() => "");
    console.log("RESP status:", r.status(), "len:", t.length);
    console.log("RESP body head:", t.slice(0, 600));
  }
});
await p.goto("http://127.0.0.1:4310/", { waitUntil: "networkidle" });
await p.waitForSelector(".pack-btn");
await p.evaluate(() => document.querySelector(".pack-btn").click());
await p.waitForTimeout(900);
await p.evaluate(() => document.querySelector('.tab[data-tab="learn"]').click());
await p.waitForTimeout(400);
console.log("BEFORE:", await p.evaluate(() => ({ btn: !!document.querySelector("#btn-ai"), lesson: document.querySelector(".lesson-head h1")?.textContent })));
await p.evaluate(() => document.querySelector("#btn-ai").click());
await p.waitForTimeout(40000);
const snap = await p.evaluate(() => {
  const view = document.querySelector("#view");
  return {
    aiCard: !!document.querySelector(".lesson-block.ai-card"),
    anyCard: [...document.querySelectorAll(".ai-card")].length,
    errDiv: document.querySelector(".issue.err")?.textContent?.slice(0, 200) || null,
    errDivAny: [...document.querySelectorAll(".issue")].map((e) => e.className + ":" + e.textContent.slice(0, 80)),
    btnText: document.querySelector("#btn-ai")?.textContent,
    viewText: (view?.innerText || "").slice(0, 700),
  };
});
console.log("AFTER:", JSON.stringify(snap, null, 2));
await b.close();
