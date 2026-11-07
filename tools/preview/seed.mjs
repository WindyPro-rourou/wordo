// 造一份「有历史」的演示账号域：多天作答 + 一道错题委托，让「我的」页有真实内容
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const DOMAIN = path.join(HERE, "domain");
const PACKS = path.join(REPO, "packs");

const pad = (n) => String(n).padStart(2, "0");
function iso(d) {
  const off = -d.getTimezoneOffset();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return `${local.toISOString().slice(0, 19)}${off >= 0 ? "+" : "-"}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
}
const now = new Date();
const daysAgo = (n, h = 19) => { const d = new Date(now); d.setDate(d.getDate() - n); d.setHours(h, 12, 0, 0); return d; };

// 收集真实题目的 id/kc/答案
function items() {
  const out = [];
  for (const name of fs.readdirSync(PACKS).sort()) {
    const d = path.join(PACKS, name, "items");
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d).filter((x) => x.endsWith(".json")).sort()) {
      const it = JSON.parse(fs.readFileSync(path.join(d, f), "utf8"));
      out.push({ id: it.id, kc_ids: it.kc_ids || [], answer: it.answer, pack: name, stem: it.stem });
    }
  }
  return out;
}

fs.rmSync(DOMAIN, { recursive: true, force: true });
fs.mkdirSync(path.join(DOMAIN, "ledger"), { recursive: true });
fs.mkdirSync(path.join(DOMAIN, "wrong"), { recursive: true });
fs.writeFileSync(path.join(DOMAIN, "settings.md"), "---\ndoc: wordo/settings/1\ndaily_goal: 20\ndifficulty_min: 0.2\ndifficulty_max: 0.7\nexplain_lang: zh\nreview_first: true\n---\n# 个性化设置\n");
fs.writeFileSync(path.join(DOMAIN, "plan.md"), "# 学习计划 / 任务清单\n\n- [ ] t1 · 三天内把「一般过去时」练到掌握\n- [ ] t2 · 整理定语从句的关系词选择判据\n");

const all = items();
const byKc = {};
for (const it of all) for (const k of it.kc_ids) (byKc[k] = byKc[k] || []).push(it);

const node = "demo-pc-a1b2";
fs.writeFileSync(path.join(DOMAIN, "node.json"), JSON.stringify({ node, host: "demo-pc", created: iso(daysAgo(6)) }, null, 2));

const evs = [];
let seq = 0;
const push = (ts, item, answered, ok, extra = {}) => {
  evs.push({ id: `${new Date(ts).getTime()}-${seq++}-${node}`, ts: iso(ts), node, kind: "answer", pack: item.pack, item_id: item.id, kc_ids: item.kc_ids, answered, correct: item.answer, ok, source: extra.source || "quiz", ...(extra.error_type ? { error_type: extra.error_type } : {}) });
};

// 英语：一般过去时 历史好坏参半（制造薄弱点），定语从句 已掌握，非谓语 未开始
const engPast = byKc["kc_eng_0002"] || [];
const engClause = byKc["kc_eng_0004"] || [];
const mathMono = byKc["kc_hs_math_0003"] || [];

// 6 天前：一般过去时 全错（薄弱）
engPast.slice(0, 2).forEach((it, i) => push(daysAgo(6, 9 + i), it, "A", false, { error_type: "concept_confused" }));
// 5 天前：一般过去时 又错一次
if (engPast[0]) push(daysAgo(5, 20), engPast[0], "A", false, { error_type: "concept_confused" });
// 4 天前：定语从句 连对 2 次（已掌握）
engClause.slice(0, 2).forEach((it, i) => push(daysAgo(4, 10 + i), it, it.answer, true));
// 2 天前：定语从句 再对 1 次
if (engClause[0]) push(daysAgo(2, 21), engClause[0], engClause[0].answer, true);
// 今天：数学单调性 错 1 次（新增薄弱）
if (mathMono[0]) push(daysAgo(0, 8), mathMono[0], "A", false, { error_type: "method_missing" });
// 今天：一般过去时 对 1 次（部分修复）
if (engPast[0]) push(daysAgo(0, 9), engPast[0], engPast[0].answer, true, { source: "review" });

fs.writeFileSync(path.join(DOMAIN, "ledger", `${node}.jsonl`), evs.map((e) => JSON.stringify(e)).join("\n") + "\n");

// ── 追加：模拟「另一台设备」发来的错题委托（用于验证界面里的跨设备处理）──
const otherNode = "demo-pad-c3d4";
const one = engPast[0];
if (one) {
  const payload = {
    items: [{ item_id: one.id, kc_id: (one.kc_ids || [])[0], kc_name: "一般过去时", stem: one.stem, options: one.options || [], answered: "A", correct: one.answer, analysis: one.analysis || "" }],
    from_node: otherNode,
    date: iso(now).slice(0, 10),
  };
  const fileName = `${payload.date}-${otherNode}.md`;
  fs.writeFileSync(
    path.join(DOMAIN, "wrong", fileName),
    `---\ndoc: wordo/delegation-wrong/1\ndate: ${payload.date}\nfrom_node: ${otherNode}\ncount: 1\n---\n# 今日错题委托（${payload.date}）\n\n> 请账号域内任一设备处理。\n\n## 1. 一般过去时 — \`${one.id}\`\n- 题干：${one.stem}\n- 我选：A　正确：${one.answer}\n\n<!-- MACHINE -->\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\`\n`
  );
  console.log(`  另生成一份他人委托: wrong/${fileName}`);
}
console.log(`已生成演示域: ${DOMAIN}`);
console.log(`  事件 ${evs.length} 条 · 节点 ${node}`);
const kcCount = {};
evs.forEach((e) => e.kc_ids.forEach((k) => (kcCount[k] = (kcCount[k] || 0) + 1)));
console.log("  各知识点作答次数:", kcCount);
