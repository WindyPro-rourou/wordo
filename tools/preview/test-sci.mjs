// 学习科学验证：蒙对降权 / 信心档 / 错因档 / 混合练习
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { chromium } from "playwright-core";
const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 4310;
const DOMAIN = path.join(HERE, "domain");
const b = await import("./backend.mjs");
b.state.packsDir = path.resolve(HERE, "../../packs");
b.state.domain = DOMAIN;
b.state.configPath = path.join(HERE, ".config.json");

const R = {};

// ── 1) 蒙对降权（API 层，干净域） ──
fs.rmSync(DOMAIN, { recursive: true, force: true });
const certain = await b.invoke("record_judged", { domain: "", packsDir: b.state.packsDir, pack: "english.high", kcId: "kc_eng_0004", syntheticId: "x1", answered: "B", ok: true, source: "test", confidence: "certain" });
const guess = await b.invoke("record_judged", { domain: "", packsDir: b.state.packsDir, pack: "math.high", kcId: "kc_hs_math_0003", syntheticId: "x2", answered: "B", ok: true, source: "test", confidence: "guess" });
R.mastery = { certain: certain.kc && certain.kc.mastery, guess: guess.kc && guess.kc.mastery, ratio: (guess.kc.mastery / certain.kc.mastery).toFixed(2) };

// 事件里是否留下 confidence / error_type
function lastAnswerEvent() {
  const d = path.join(DOMAIN, "ledger");
  let last = null;
  for (const f of fs.existsSync(d) ? fs.readdirSync(d) : []) for (const line of fs.readFileSync(path.join(d, f), "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { const e = JSON.parse(line); if (e.kind === "answer" && e.source === "test") last = e; } catch {}
  }
  return last;
}
R.eventFields = (() => { const e = lastAnswerEvent(); return e ? { confidence: e.confidence, error_type: e.error_type } : null; })();

// ── 2) UI：混合练习 + 信心/错因选择 ──
fs.rmSync(DOMAIN, { recursive: true, force: true });
// 造 3 个薄弱点，供混合练习取材
for (const kc of ["kc_eng_0002","kc_eng_0004","kc_hs_math_0003"]) {
  await b.invoke("record_judged", { domain: "", packsDir: b.state.packsDir, pack: kc.startsWith("kc_eng")?"english.high":"math.high", kcId: kc, syntheticId: "seed-"+kc, answered: "A", ok: false, source: "seed", errorType: "concept_confused", confidence: "unsure" });
}
const br = await chromium.launch({ executablePath: EDGE, headless: true, args: ["--no-sandbox"] });
const ctx = await br.newContext({ viewport: { width: 1440, height: 1000 }, locale: "zh-CN" });
const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
await p.waitForSelector("#chat-input"); await p.waitForTimeout(900);
await p.fill("#chat-input", "混合练 3 个薄弱点");
await p.press("#chat-input", "Enter");
await p.waitForTimeout(2500);
R.mixed = await p.evaluate(() => ({ quizCards: document.querySelectorAll(".msg-card[data-item]").length, notes: [...document.querySelectorAll(".msg-note")].map((x) => x.textContent.trim().slice(0, 40)) }));

// 答第一题：选一个错误项 → 出现信心档与错因档 → 点「概念不清」+「蒙的」
if (R.mixed.quizCards > 0) {
  await p.evaluate(() => {
    const card = document.querySelector(".msg-card[data-item]");
    const opts = [...card.querySelectorAll(".q-opt[data-quiz-opt]")];
    const wrong = opts.find((o) => o.dataset.correct === "0") || opts[0];
    wrong.click();
  });
  await p.waitForTimeout(400);
  R.chips = await p.evaluate(() => ({ conf: document.querySelectorAll("[data-conf]").length, err: document.querySelectorAll("[data-err]").length }));
  await p.evaluate(() => {
    document.querySelector('[data-err="concept_confused"]')?.click();
    document.querySelector('[data-conf="guess"]')?.click();
  });
  await p.waitForTimeout(1200);
  R.noteAfter = await p.evaluate(() => document.querySelector(".quiz-note")?.innerText?.replace(/\n+/g, " ").slice(0, 120));
  R.ledgerAfter = (() => {
    const d = path.join(DOMAIN, "ledger"); let hit = null;
    for (const f of fs.existsSync(d) ? fs.readdirSync(d) : []) for (const line of fs.readFileSync(path.join(d, f), "utf8").split(/\r?\n/)) {
      if (!line.trim()) continue; try { const e = JSON.parse(line); if (e.kind === "answer") hit = e; } catch {}
    }
    return hit ? { source: hit.source, confidence: hit.confidence, error_type: hit.error_type, ok: hit.ok } : null;
  })();
}
R.errors = errs;
console.log(JSON.stringify(R, null, 2));
await br.close();
