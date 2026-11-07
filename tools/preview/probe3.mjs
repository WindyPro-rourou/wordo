// 抓 ask_model 请求体，定位 packPath 为空的原因
import { chromium } from "playwright-core";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const b = await chromium.launch({ executablePath: EDGE, headless: true, args: ["--no-sandbox"] });
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
p.on("console", (m) => console.log("CONSOLE", m.type(), m.text().slice(0, 200)));
p.on("request", (r) => {
  if (r.url().includes("/api/ask_model")) console.log("REQ:", (r.postData() || "").slice(0, 400));
});
await p.goto("http://127.0.0.1:4310/", { waitUntil: "networkidle" });
await p.waitForSelector(".pack-btn");
await p.evaluate(() => document.querySelector(".pack-btn").click());
await p.waitForTimeout(1000);
await p.evaluate(() => {
  const t = document.querySelector('.tab[data-tab="learn"]');
  if (t) t.click();
});
await p.waitForTimeout(500);
const info = await p.evaluate(() => ({
  lessonHead: document.querySelector(".lesson-head h1")?.textContent || "(无)",
  hasBtnAi: !!document.querySelector("#btn-ai"),
  qCards: document.querySelectorAll(".q-card").length,
  packActive: document.querySelector(".pack-btn.active")?.innerText?.slice(0, 60) || "",
}));
console.log("DOM:", JSON.stringify(info));
await p.evaluate(() => {
  const x = document.querySelector("#btn-ai");
  if (x) x.click();
});
await p.waitForTimeout(7000);
console.log("ERR:", await p.evaluate(() => document.querySelector(".issue.err")?.textContent || null));
await b.close();
