// WORDO 最小节点桥 · 入库（import）
// 把极简设备产出的 answers.jsonl 合并进账号域账本（去重、自动补 seq、重算 user.md）。
// 设备侧无需理解账本格式，只要每答一题追加一行 JSON 即可。
//
// 用法：node import.mjs --domain <域目录> --in answers.jsonl [--packs <packs目录>]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appendEvent, readEvents, writeUserMd } from "../preview/backend.mjs";

export function importAnswers(domain, answers, packsDir) {
  const existing = new Set(readEvents(domain).map((e) => e.id));
  let imported = 0;
  let skipped = 0;
  const nodes = new Set();
  for (const ans of answers) {
    if (!ans || !ans.id || !ans.kind) { skipped++; continue; }
    if (existing.has(ans.id)) { skipped++; continue; }
    const ev = {
      id: ans.id,
      ts: ans.ts || new Date().toISOString(),
      node: ans.node || "mininode",
      kind: "answer",
      pack: ans.pack || "",
      item_id: ans.item_id || "",
      kc_ids: Array.isArray(ans.kc_ids) ? ans.kc_ids : [],
      answered: ans.answered ?? "",
      correct: ans.correct ?? "",
      ok: ans.ok === true,
      source: ans.source || "mininode",
      error_type: ans.error_type ?? null,
      confidence: ans.confidence ?? null,
    };
    appendEvent(domain, ev);
    existing.add(ev.id);
    nodes.add(ev.node);
    imported++;
  }
  if (packsDir) { try { writeUserMd(domain, packsDir); } catch {} }
  return { imported, skipped, nodes: [...nodes].sort() };
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
  if (!a.domain || !a.in) {
    console.error("用法: node import.mjs --domain <域目录> --in answers.jsonl [--packs <packs目录>]");
    process.exit(2);
  }
  const answers = fs
    .readFileSync(a.in, "utf8")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => JSON.parse(s));
  const r = importAnswers(a.domain, answers, a.packs || "");
  console.log(JSON.stringify({ ok: true, ...r }, null, 2));
}
