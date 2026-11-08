// WORDO 最小节点桥 · 导出卡片集（export）
// 把账号域的「到期/薄弱/新」知识点导出成一张 cardset.jsonl，供极简设备（如 ESP32 单词机）离线学习。
// 设备只需：取题 → 写一行 JSON（answers.jsonl）→ 文件搬运回来（import.mjs 入库）。
//
// 用法：node export.mjs --domain <域目录> --packs <packs目录> --out cardset.jsonl [--limit 30] [--mode due|auto|all]
// 纯 Node，无依赖，跨平台。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { invoke } from "../preview/backend.mjs";

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));

function stripFm(md) {
  let t = String(md || "").replace(/^\uFEFF/, "").trimStart();
  if (t.startsWith("---")) {
    const end = t.indexOf("\n---", 3);
    if (end >= 0) t = t.slice(end + 1).replace(/^(-{3})?/, "").trimStart();
  }
  return t;
}
function excerpt(md, n = 180) {
  const body = stripFm(md)
    .split(/\r?\n/)
    .filter((l) => !/^#{1,6}\s/.test(l.trim()))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return body.slice(0, n);
}

export async function buildCardset(domain, packsDir, opts = {}) {
  const limit = opts.limit ?? 30;
  const mode = opts.mode ?? "auto";
  const packs = (await invoke("list_packs", { packsDir })).packs || [];

  // 全部知识点（含材料与代表题）
  const all = [];
  for (const p of packs) {
    let lp;
    try { lp = await invoke("load_pack", { packPath: p.path }); } catch { continue; }
    const matByKc = {};
    for (const m of lp.materials || []) {
      const kid = (m.front && m.front.kc_id && m.front.kc_id[0]) || (m.file || "").replace(/\.md$/, "");
      matByKc[kid] = m.body || "";
    }
    for (const k of lp.kcs || []) {
      const item = (lp.items || []).find((it) => (it.kc_ids || []).includes(k.id) && it.type === "single_choice");
      all.push({
        kc_id: k.id,
        kc_name: k.name,
        pack: p.subjectId || p.name,
        toc: k.toc || [],
        difficulty: k.difficulty ?? null,
        material: matByKc[k.id] || "",
        item: item ? { id: item.id, type: item.type, stem: item.stem, options: item.options, answer: item.answer, analysis: item.analysis } : null,
      });
    }
  }
  const byId = new Map(all.map((c) => [c.kc_id, c]));

  // 优先级：到期 > 薄弱 > 其余（新）
  let order = [];
  if (mode !== "all") {
    let due = [];
    try { due = (await invoke("learn_due", { domain, packsDir })).due || []; } catch {}
    const weak = (await invoke("learn_due", { domain, packsDir })).weak || [];
    const seen = new Set();
    for (const x of due) if (byId.has(x.kc_id) && !seen.has(x.kc_id)) { seen.add(x.kc_id); order.push(x.kc_id); }
    for (const x of weak) if (byId.has(x.kc_id) && !seen.has(x.kc_id)) { seen.add(x.kc_id); order.push(x.kc_id); }
    if (mode === "auto") for (const c of all) if (!seen.has(c.kc_id)) { seen.add(c.kc_id); order.push(c.kc_id); }
  } else {
    order = all.map((c) => c.kc_id);
  }

  const cards = order.slice(0, limit).map((id) => {
    const c = byId.get(id);
    const back = excerpt(c.material) || (c.item && c.item.analysis) || "（暂无讲解素材，可在学科包 material/ 补充）";
    return {
      kc_id: c.kc_id,
      kc_name: c.kc_name,
      pack: c.pack,
      front: c.kc_name,
      back,
      item: c.item, // 可选题；设备可直接做选择题，也可只当闪卡
    };
  });
  return { domain, packsDir, count: cards.length, cards };
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
  if (!a.packs || !a.out) {
    console.error("用法: node export.mjs --packs <packs目录> [--domain <域目录>] --out cardset.jsonl [--limit 30] [--mode auto|due|all]");
    process.exit(2);
  }
  const domain = a.domain || "";
  const { cards, count } = await buildCardset(domain, a.packs, { limit: a.limit ? Number(a.limit) : 30, mode: a.mode || "auto" });
  const out = path.resolve(a.out);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, cards.map((c) => JSON.stringify(c)).join("\n") + (cards.length ? "\n" : ""), "utf8");
  console.log(JSON.stringify({ ok: true, out, count, mode: a.mode || "auto" }, null, 2));
}
