// 页面内探针：直接调 shim、观察「我的」页数据流与控制台错误
import { chromium } from "playwright-core";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 4310;
const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text().slice(0, 300)}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(600);

const direct = await page.evaluate(async () => {
  try {
    const st = await window.__TAURI__.core.invoke("learn_state", { domain: "", packsDir: "F:/去中心化分布式跨平台自进化ai学习系统/packs" });
    const due = await window.__TAURI__.core.invoke("learn_due", { domain: "", packsDir: "F:/去中心化分布式跨平台自进化ai学习系统/packs" });
    return { okState: true, stateKeys: Object.keys(st || {}), userMdLen: (st?.userMd || "").length, weak: (due?.weak || []).length, dueN: (due?.due || []).length, today: due?.today_answers };
  } catch (e) { return { okState: false, err: String(e) }; }
});

// 点「我的」，等，读 DOM
await page.evaluate(() => { const b = document.querySelector('.tab[data-tab="me"]'); if (b) b.click(); });
await page.waitForTimeout(2500);
const dom = await page.evaluate(() => {
  const t = (s) => (document.querySelector(s)?.textContent || "").trim().slice(0, 120);
  const statVals = [...document.querySelectorAll(".me-stat .n, .me-stat b, .me-kpi .n")].map((e) => e.textContent.trim());
  return {
    hasMeRoot: !!document.querySelector(".me, .me-page, #view"),
    bodyText: (document.querySelector("#view")?.innerText || "").slice(0, 500),
    stateMe: window.__state?.me ? Object.keys(window.__state.me) : null,
    err: [...document.querySelectorAll(".me-err")].map((e) => e.textContent.trim()),
  };
});
console.log("DIRECT INVOKE:", JSON.stringify(direct, null, 2));
console.log("DOM:", JSON.stringify(dom, null, 2));
console.log("LOGS:", logs.slice(-12).join("\n"));
await browser.close();
