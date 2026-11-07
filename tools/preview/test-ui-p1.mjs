// UI 级验证：讲解检测题落账（P1）+ 手机端会话抽屉（P5）
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { chromium } from "playwright-core";
const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 4310;
const DOMAIN = path.join(HERE, "domain");
const R = {};

function ledgerHasChatFollowup() {
  const d = path.join(DOMAIN, "ledger");
  if (!fs.existsSync(d)) return { found: false, events: 0 };
  let n = 0, hit = null;
  for (const f of fs.readdirSync(d)) {
    for (const line of fs.readFileSync(path.join(d, f), "utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line);
        n++;
        if (e.kind === "answer" && (e.source === "chat-followup" || e.source === "learn-followup")) hit = e;
      } catch {}
    }
  }
  return { found: !!hit, events: n, sample: hit ? { source: hit.source, item_id: hit.item_id, kc_ids: hit.kc_ids, ok: hit.ok } : null };
}

const b = await chromium.launch({ executablePath: EDGE, headless: true, args: ["--no-sandbox", "--force-color-profile=srgb"] });

/* ---------- 桌面：讲解 → 答检测题 → 落账 ---------- */
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, locale: "zh-CN" });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
  await p.waitForSelector("#chat-input");
  await p.waitForTimeout(1000);
  await p.fill("#chat-input", "讲讲一般过去时");
  await p.press("#chat-input", "Enter");
  await p.waitForFunction(() => !!document.querySelector(".msg-card .followup .q-opt"), { timeout: 120000 });
  R.explainOk = true;
  // 答错第一个选项
  await p.evaluate(() => document.querySelectorAll(".msg-card .followup .q-opt")[0].click());
  await p.waitForTimeout(1500);
  R.noteAfterAnswer = await p.evaluate(() => document.querySelector(".quiz-note")?.innerText?.replace(/\n+/g, " ").slice(0, 160) || "");
  R.ledgerAfterFollowup = ledgerHasChatFollowup();
  R.explainEventInLedger = (() => {
    const d = path.join(DOMAIN, "ledger");
    let hit = false;
    for (const f of fs.existsSync(d) ? fs.readdirSync(d) : []) for (const line of fs.readFileSync(path.join(d, f), "utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      try { if (JSON.parse(line).kind === "explain") hit = true; } catch {}
    }
    return hit;
  })();
  R.deskErrors = errs;
  await p.screenshot({ path: path.join(HERE, "shots", "p1-followup.png"), fullPage: false });
  await ctx.close();
}

/* ---------- 手机：会话抽屉 ---------- */
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "zh-CN" });
  const p = await ctx.newPage();
  await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
  await p.waitForSelector("#chat-input");
  await p.waitForTimeout(800);
  R.mobile = await p.evaluate(() => {
    const btn = document.querySelector("#btn-chats");
    const cs = btn ? getComputedStyle(btn) : null;
    return { hasBtn: !!btn, btnVisible: cs && cs.display !== "none", btnSize: btn ? Math.round(btn.getBoundingClientRect().width) : 0 };
  });
  await p.click("#btn-chats");
  await p.waitForTimeout(500);
  R.drawer = await p.evaluate(() => {
    const d = document.querySelector("#chat-drawer");
    const items = document.querySelectorAll("#drawer-list .drawer-item").length;
    const x = document.querySelector("#drawer-list .drawer-item-x");
    return {
      visible: d && !d.classList.contains("hidden"),
      items,
      deleteBtnWidth: x ? Math.round(x.getBoundingClientRect().width) : 0,
      deleteVisible: !!x && getComputedStyle(x).opacity !== "0",
      newBtn: !!document.querySelector("#drawer-new"),
    };
  });
  await p.screenshot({ path: path.join(HERE, "shots", "p5-drawer.png"), fullPage: false });
  await ctx.close();
}

await b.close();
console.log(JSON.stringify(R, null, 2));
