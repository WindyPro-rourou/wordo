// WORDO 最小节点桥 · 设备端模拟（sim）
// 模拟一台极简设备（如 ESP32 单词机）：读 cardset.jsonl → 逐卡「作答」→ 追加写 answers.jsonl。
// 真实 ESP32 上这段逻辑就是：按键选 A/B/C/D、判对错、把结果追加成一行 JSON。
//
// 用法：node sim.mjs --cardset cardset.jsonl --out answers.jsonl [--node esp32-demo] [--p 0.7] [--seed 1]
// --p 是「答对概率」（模拟不同水平学习者），--seed 保证可复现。
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const nowIso = (d = new Date()) => {
  const off = -d.getTimezoneOffset();
  const pad = (n) => String(Math.floor(Math.abs(n))).padStart(2, "0");
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return `${local.toISOString().slice(0, 19)}${off >= 0 ? "+" : "-"}${pad(off / 60)}:${pad(off % 60)}`;
};

export function simulate(cards, opts = {}) {
  const node = opts.node || "esp32-demo";
  const p = opts.p ?? 0.7;
  const rand = mulberry32((opts.seed ?? 1) >>> 0);
  const out = [];
  for (const card of cards) {
    const ok = rand() < p;
    let answered;
    if (card.item && Array.isArray(card.item.options) && card.item.options.length) {
      const keys = card.item.options.map((o) => o.key);
      const correct = card.item.answer;
      if (ok) answered = correct;
      else {
        const wrong = keys.filter((k) => k !== correct);
        answered = wrong.length ? wrong[Math.floor(rand() * wrong.length)] : correct;
      }
    } else {
      answered = ok ? "known" : "unknown";
    }
    out.push({
      id: crypto.randomUUID(),
      ts: nowIso(),
      node,
      kind: "answer",
      pack: card.pack || "",
      item_id: (card.item && card.item.id) || `${card.pack || ""}::${card.kc_id}::mininode`,
      kc_ids: [card.kc_id],
      answered,
      correct: (card.item && card.item.answer) || "(self-judged)",
      ok,
      source: "esp32",
      error_type: ok ? null : (rand() < 0.5 ? "concept_confused" : "careless"),
      confidence: "certain",
    });
  }
  return out;
}

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k.startsWith("--")) a[k.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
  }
  return a;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const a = parseArgs(process.argv.slice(2));
  if (!a.cardset || !a.out) {
    console.error("用法: node sim.mjs --cardset cardset.jsonl --out answers.jsonl [--node esp32-demo] [--p 0.7] [--seed 1]");
    process.exit(2);
  }
  const cards = fs
    .readFileSync(a.cardset, "utf8")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => JSON.parse(s));
  const answers = simulate(cards, { node: a.node, p: a.p != null ? Number(a.p) : 0.7, seed: a.seed != null ? Number(a.seed) : 1 });
  const out = path.resolve(a.out);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, answers.map((x) => JSON.stringify(x)).join("\n") + (answers.length ? "\n" : ""), "utf8");
  console.log(JSON.stringify({ ok: true, out, answered: answers.length, correct: answers.filter((x) => x.ok).length, node: a.node || "esp32-demo" }, null, 2));
}
