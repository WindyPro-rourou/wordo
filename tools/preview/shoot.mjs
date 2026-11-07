// 无头巡检：多视口 × 多页签截图 + 客观缺陷采集（溢出/截断/过小字号/控制台报错）
// 用法: node shoot.mjs [--port 4310] [--round 1] [--tags learn,items,tree,report,me,settings]
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { chromium } from "playwright-core";

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "shots");
fs.mkdirSync(OUT, { recursive: true });

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const PORT = Number(arg("port", 4310));
const ROUND = String(arg("round", "0")).padStart(2, "0");
const BASE = `http://127.0.0.1:${PORT}`;
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

const VIEWPORTS = [
  { name: "desk", width: 1440, height: 900 },
  { name: "wide", width: 1920, height: 1080 },
  { name: "tab", width: 1024, height: 768 },
  { name: "phone", width: 390, height: 844, mobile: true },
  { name: "phone-s", width: 360, height: 740, mobile: true },
  { name: "phone-land", width: 844, height: 390, mobile: true, landscape: true },
];

// 点击并记录「是否被别的元素遮挡」——遮挡是真实可用性缺陷，必须捞出来
async function tap(page, sel, bucket) {
  const r = await page.evaluate((s) => {
    const e = document.querySelector(s);
    if (!e) return { found: false };
    e.scrollIntoView({ block: "center", inline: "center" });
    const rc = e.getBoundingClientRect();
    const cx = Math.round(rc.x + rc.width / 2), cy = Math.round(rc.y + rc.height / 2);
    const top = document.elementFromPoint(cx, cy);
    const occluded = !top || !(top === e || e.contains(top));
    e.click();
    return { found: true, x: cx, y: cy, w: Math.round(rc.width), occluded, top: top ? (top.tagName.toLowerCase() + (top.id ? "#" + top.id : "." + String(top.className || "").split(/\s+/)[0])) : null };
  }, sel);
  if (r.found && r.occluded) bucket.push(`${sel} @(${r.x},${r.y}) 被 ${r.top} 遮挡`);
  if (r.found && r.w === 0) bucket.push(`${sel} 宽度为 0（不可见）`);
  return r;
}

// 等待数据落位（「我的」页首屏异步取数）
async function waitMeReady(page) {
  try {
    await page.waitForFunction(
      () => {
        const n = document.querySelector(".me-stat .n");
        return n && n.textContent.trim() !== "…" && document.querySelectorAll(".me-stat").length > 0;
      },
      { timeout: 12000 }
    );
  } catch {}
  await page.waitForTimeout(300);
}

const TABS = [
  { key: "chat", label: "对话" },
  { key: "me", label: "我的" },
  { key: "items", label: "题库" },
  { key: "tree", label: "知识树" },
  { key: "report", label: "校验报告" },
  { key: "settings", label: "设置" },
];

function attachCollectors(page, bucket) {
  page.on("console", (m) => { if (m.type() === "error") bucket.console.push(m.text().slice(0, 400)); });
  page.on("pageerror", (e) => bucket.pageerror.push(String(e && e.message || e).slice(0, 400)));
  page.on("requestfailed", (r) => bucket.failed.push(`${r.method()} ${r.url().slice(0, 120)} ${r.failure()?.errorText || ""}`));
}

async function measure(page) {
  return page.evaluate(() => {
    const W = window.innerWidth;
    const doc = document.documentElement;
    const overflowX = doc.scrollWidth > W + 1;
    // 祖先里有横向滚动容器时，子元素超出视口是「设计内的滚动」，不算缺陷
    const inHScroller = (el) => {
      let p = el.parentElement;
      while (p) {
        const cs = getComputedStyle(p);
        if ((cs.overflowX === "auto" || cs.overflowX === "scroll") && p.scrollWidth > p.clientWidth + 1) return true;
        p = p.parentElement;
      }
      return false;
    };
    const offenders = [];
    const tinyFonts = [];
    const clipped = [];
    for (const el of document.querySelectorAll("body *")) {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if ((r.right > W + 2 || r.left < -2) && !inHScroller(el)) {
        offenders.push({ sel: el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : ""), left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width) });
      }
      const fs2 = parseFloat(cs.fontSize);
      const txt = (el.textContent || "").trim();
      if (txt && el.children.length === 0 && fs2 && fs2 < 11) tinyFonts.push({ sel: el.tagName.toLowerCase(), fs: fs2, txt: txt.slice(0, 24) });
      if (cs.overflowY === "hidden" && el.scrollHeight > el.clientHeight + 6 && txt) clipped.push({ sel: el.tagName.toLowerCase() + (typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\s+/)[0] : ""), sh: el.scrollHeight, ch: el.clientHeight });
    }
    // 去重
    const uniq = (arr, k) => { const s = new Set(); return arr.filter((x) => { const key = x[k]; if (s.has(key)) return false; s.add(key); return true; }); };
    return {
      overflowX,
      scrollWidth: doc.scrollWidth, innerWidth: W,
      offenders: uniq(offenders, "sel").slice(0, 8),
      tinyFonts: uniq(tinyFonts, "txt").slice(0, 6),
      clipped: uniq(clipped, "sel").slice(0, 6),
    };
  });
}

const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ["--no-sandbox", "--force-color-profile=srgb", "--font-render-hinting=none"] });
const report = { round: ROUND, startedAt: new Date().toISOString(), viewports: {}, tabsSeen: [], errors: [] };

try {
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, isMobile: !!vp.mobile, hasTouch: !!vp.mobile, locale: "zh-CN", timezoneId: "Asia/Shanghai" });
    const page = await ctx.newPage();
    const bucket = { console: [], pageerror: [], failed: [] };
    attachCollectors(page, bucket);
    await page.goto(BASE + "/", { waitUntil: "networkidle", timeout: 30000 });
    // 等首屏就绪：学科包列表出现
    try { await page.waitForSelector(".pack-btn, .empty", { timeout: 8000 }); } catch {}
    await page.waitForTimeout(400);

    const vres = { tabs: {}, occlusions: [] };

    for (const t of TABS) {
      // 手机端优先点底部导航；桌面点顶部页签；设置按钮在 header
      const barSel = `.tabbar-btn[data-tab="${t.key}"]`;
      const tabSel = `.tab[data-tab="${t.key}"]`;
      let picked = null;
      if (await page.locator(barSel).isVisible().catch(() => false)) picked = barSel;
      else if (await page.locator(tabSel).isVisible().catch(() => false)) picked = tabSel;
      else if (t.key === "settings") picked = "#btn-settings";
      if (!picked) { vres.tabs[t.key] = { skipped: "入口不可见" }; continue; }
      const r = await tap(page, picked, vres.occlusions);
      if (!r.found) { vres.tabs[t.key] = { skipped: "入口不存在" }; continue; }
      await page.waitForTimeout(500);
      if (t.key === "me") await waitMeReady(page);
      const m = await measure(page);
      const shot = path.join(OUT, `r${ROUND}-${vp.name}-${t.key}.png`);
      await page.screenshot({ path: shot, fullPage: false });
      vres.tabs[t.key] = { measure: m, shot: path.basename(shot) };
      if (!report.tabsSeen.includes(t.key)) report.tabsSeen.push(t.key);
    }

    // 交互：在对话里发一句「我该复习什么」→ 应出现 assistant 回复（不调模型，只读账本）
    try {
      const chatSel = (await page.locator('.tabbar-btn[data-tab="chat"]').isVisible().catch(() => false))
        ? '.tabbar-btn[data-tab="chat"]'
        : '.tab[data-tab="chat"]';
      await tap(page, chatSel, vres.occlusions);
      await page.waitForTimeout(500);
      const hasComposer = await page.evaluate(() => !!document.querySelector("#chat-input"));
      if (hasComposer) {
        // 每个视口用独立新会话，避免互相污染
        const nb = await page.$("#btn-new-chat");
        if (nb) { await page.evaluate(() => document.querySelector("#btn-new-chat").click()); await page.waitForTimeout(700); }
        const before = await page.evaluate(() => document.querySelectorAll(".msg").length);
        await page.fill("#chat-input", "我该复习什么");
        await page.press("#chat-input", "Enter");
        await page.waitForTimeout(2000);
        const after = await page.evaluate(() => document.querySelectorAll(".msg").length);
        vres.chat = {
          sent: true,
          before,
          after,
          lastAssistant: (await page.evaluate(() => {
            const arr = [...document.querySelectorAll(".msg.assistant")];
            return arr.length ? arr[arr.length - 1].innerText.slice(0, 120).replace(/\n+/g, " | ") : "";
          })) || "",
        };
        const shot2 = path.join(OUT, `r${ROUND}-${vp.name}-chat-sent.png`);
        await page.screenshot({ path: shot2, fullPage: false });
        vres.answeredShot = path.basename(shot2);
      } else {
        vres.chat = { sent: false, reason: "没有输入框" };
      }
    } catch (e) { vres.answerError = String(e.message || e); }

    vres.console = bucket.console; vres.pageerror = bucket.pageerror; vres.failed = bucket.failed;
    report.viewports[vp.name] = vres;
    await ctx.close();
  }
} finally {
  await browser.close();
}

// 汇总结论
const issues = [];
for (const [vp, v] of Object.entries(report.viewports)) {
  if (v.console?.length) issues.push(`${vp}: 控制台错误 ${v.console.length} 条`);
  if (v.pageerror?.length) issues.push(`${vp}: 页面异常 ${v.pageerror.length} 条`);
  if (v.occlusions?.length) issues.push(`${vp}: ${v.occlusions.length} 处控件被遮挡/不可见 → ${v.occlusions.slice(0, 3).join("; ")}`);
  for (const [tab, t] of Object.entries(v.tabs || {})) {
    if (t.measure?.overflowX) issues.push(`${vp}/${tab}: 横向溢出 (scrollWidth ${t.measure.scrollWidth} > ${t.measure.innerWidth})`);
    if (t.measure?.offenders?.length) issues.push(`${vp}/${tab}: ${t.measure.offenders.length} 个元素超出视口 → ${t.measure.offenders.map((o) => o.sel).slice(0, 3).join(", ")}`);
    if (t.measure?.clipped?.length) issues.push(`${vp}/${tab}: ${t.measure.clipped.length} 个元素文字被截断 → ${t.measure.clipped.map((o) => o.sel).slice(0, 3).join(", ")}`);
    if (t.measure?.tinyFonts?.length) issues.push(`${vp}/${tab}: 字号过小( <11px ) ${t.measure.tinyFonts.length} 处`);
  }
}
report.issues = [...new Set(issues)];
fs.writeFileSync(path.join(HERE, `report-r${ROUND}.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ round: ROUND, tabsSeen: report.tabsSeen, answerNote: Object.values(report.viewports).map((v) => v.answerNote).filter(Boolean)[0], issues: report.issues }, null, 2));
