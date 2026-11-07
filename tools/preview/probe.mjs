// 精确探测：顶栏各元素几何 + 遮挡判定（elementFromPoint）
import path from "node:path";
import url from "node:url";
import { chromium } from "playwright-core";
const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = Number(process.argv[2] || 4310);
const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ["--no-sandbox"] });
for (const w of [1440, 1024, 768, 390]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const info = await page.evaluate(() => {
    const g = (sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right) }; };
    const at = (sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); const cx = Math.round(r.x + r.width / 2), cy = Math.round(r.y + r.height / 2); const top = document.elementFromPoint(cx, cy); return { cx, cy, top: top ? top.tagName.toLowerCase() + (top.id ? "#" + top.id : "." + String(top.className || "").split(/\s+/)[0]) : null }; };
    return {
      vw: window.innerWidth, header: g("header"), brand: g("header > div"), packsDir: g(".packs-dir"),
      input: g("#packs-dir"), refresh: g("#btn-refresh"), settings: g("#btn-settings"),
      settingsHit: at("#btn-settings"), refreshHit: at("#btn-refresh"),
      headerCS: (() => { const cs = getComputedStyle(document.querySelector("header")); return { display: cs.display, flexWrap: cs.flexWrap, overflow: cs.overflow, position: cs.position }; })(),
      packsCS: (() => { const cs = getComputedStyle(document.querySelector(".packs-dir")); return { display: cs.display, minWidth: cs.minWidth, overflow: cs.overflow }; })(),
      inputCS: (() => { const cs = getComputedStyle(document.querySelector("#packs-dir")); return { width: cs.width, position: cs.position, flex: cs.flex, minWidth: cs.minWidth }; })(),
    };
  });
  console.log(`\n===== viewport ${w} =====`);
  console.log(JSON.stringify(info, null, 2));
  await ctx.close();
}
await browser.close();
