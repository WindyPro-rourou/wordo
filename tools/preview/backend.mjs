// WORDO 预览后端：实现与 core/src/api.rs **完全相同的契约**（字段名一致），
// 直接读真实 packs/ 与同格式 append-only 账本，模型调用走真实 NVIDIA。
// 仅开发期使用；不随应用发布。
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/* ══════════ 基础工具 ══════════ */

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const exists = (p) => { try { return fs.existsSync(p); } catch { return false; } };
const ensureDir = (p) => fs.mkdirSync(p, { recursive: true });
const nowIso = (d = new Date()) => {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const pad = (n) => String(Math.floor(Math.abs(n))).padStart(2, "0");
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return `${local.toISOString().slice(0, 19)}${sign}${pad(off / 60)}:${pad(off % 60)}`;
};
const todayStr = () => nowIso().slice(0, 10);

export const state = { packsDir: "", domain: "", configPath: "", nodeOverride: "" };

/* ══════════ 学科包读取（对应 load.rs） ══════════ */

function splitFrontMatter(text) {
  const t = text.replace(/^\uFEFF/, "").trimStart();
  if (!t.startsWith("---")) return [null, text];
  const rest = t.slice(3);
  const end = rest.indexOf("\n---");
  if (end < 0) return [null, text];
  const yaml = rest.slice(0, end);
  const body = rest.slice(end + 4).replace(/^[-\n]+/, "");
  const obj = {};
  for (const line of yaml.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || !s.includes(":")) continue;
    const i = s.indexOf(":");
    const k = s.slice(0, i).trim();
    let v = s.slice(i + 1).trim().replace(/^\[|\]$/g, "").trim();
    obj[k] = v === "" ? [] : v.split(",").map((x) => x.trim()).filter(Boolean);
  }
  return [obj, body];
}

function listMaterials(packDir) {
  const dir = path.join(packDir, "material");
  if (!exists(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort().map((f) => {
    const [front, body] = splitFrontMatter(fs.readFileSync(path.join(dir, f), "utf8"));
    return { file: f, front, body };
  });
}

function packIssues(packDir) {
  // 轻量校验：只做会产生 error/warning 的关键项（与 validate.rs 的语义对齐）
  const issues = [];
  let kcCount = 0, itemCount = 0, edgeCount = 0;
  const kcIds = new Set();
  try {
    const meta = readJson(path.join(packDir, "subject.json"));
    for (const f of ["id", "name", "version", "schema", "license"]) if (!meta[f]) issues.push({ level: "error", code: "meta", file: "subject.json", msg: `缺少必填字段 ${f}` });
  } catch { issues.push({ level: "error", code: "meta", file: "subject.json", msg: "subject.json 无法解析" }); }
  if (!exists(path.join(packDir, "GUIDE.md"))) issues.push({ level: "error", code: "guide", file: "GUIDE.md", msg: "缺少 GUIDE.md" });
  try {
    const kcs = readJson(path.join(packDir, "tree", "kc.json"));
    kcCount = kcs.length;
    for (const k of kcs) kcIds.add(k.id);
  } catch { issues.push({ level: "error", code: "kc", file: "tree/kc.json", msg: "kc.json 无法解析" }); }
  try { edgeCount = readJson(path.join(packDir, "tree", "prereq.json")).length; } catch { edgeCount = 0; }
  const covered = new Set();
  const itemsDir = path.join(packDir, "items");
  if (exists(itemsDir)) {
    const files = fs.readdirSync(itemsDir).filter((f) => f.endsWith(".json")).sort();
    itemCount = files.length;
    for (const f of files) {
      try {
        const it = readJson(path.join(itemsDir, f));
        if (it.id !== f.replace(/\.json$/, "")) issues.push({ level: "error", code: "item-id", file: `items/${f}`, msg: "id 与文件名不一致" });
        for (const k of it.kc_ids || []) { covered.add(k); if (!kcIds.has(k)) issues.push({ level: "error", code: "item-kc", file: `items/${f}`, msg: `引用不存在的知识点 ${k}` }); }
        if (!it.analysis) issues.push({ level: "warning", code: "no-analysis", file: `items/${f}`, msg: "缺少解析" });
      } catch { issues.push({ level: "error", code: "item", file: `items/${f}`, msg: "无法解析" }); }
    }
  }
  const dangling = [...kcIds].filter((k) => !covered.has(k));
  for (const k of dangling) issues.push({ level: "warning", code: "dangling-kc", file: "items/", msg: `知识点 ${k} 没有任何题目挂载——粒度过细或缺题` });
  const coverage = kcCount ? Math.round((covered.size / kcCount) * 1000) / 10 : 0;
  const errors = issues.filter((i) => i.level === "error").length;
  const warnings = issues.filter((i) => i.level === "warning").length;
  return { issues, kcCount, itemCount, edgeCount, coverage, errors, warnings, dangling };
}

export function list_packs(packsDir) {
  const dir = packsDir || state.packsDir;
  const packs = [];
  if (exists(dir)) {
    for (const name of fs.readdirSync(dir).sort()) {
      const p = path.join(dir, name);
      if (!exists(path.join(p, "subject.json"))) continue;
      let meta = {};
      try { meta = readJson(path.join(p, "subject.json")); } catch {}
      const v = packIssues(p);
      packs.push({ path: p, subjectId: meta.id ?? null, name: meta.name ?? null, version: meta.version ?? null, description: meta.description ?? null, errors: v.errors, warnings: v.warnings, kcCount: v.kcCount, itemCount: v.itemCount, coveragePct: v.coverage });
    }
  }
  return { packsDir: dir, packs };
}

export function load_pack(packPath) {
  const meta = readJson(path.join(packPath, "subject.json"));
  const kcs = readJson(path.join(packPath, "tree", "kc.json"));
  let prereqs = [];
  try { prereqs = readJson(path.join(packPath, "tree", "prereq.json")); } catch {}
  let items = [];
  const itemsDir = path.join(packPath, "items");
  if (exists(itemsDir)) for (const f of fs.readdirSync(itemsDir).filter((x) => x.endsWith(".json")).sort()) {
    try { items.push(readJson(path.join(itemsDir, f))); } catch {}
  }
  const materials = listMaterials(packPath);
  const v = packIssues(packPath);
  const report = {
    pack_path: packPath,
    subject_id: meta.id ?? null, subject_version: meta.version ?? null, schema: meta.schema ?? null,
    kc_count: v.kcCount, edge_count: v.edgeCount, item_count: v.itemCount, coverage_pct: v.coverage,
    error_count: v.errors, warning_count: v.warnings,
    issues: v.issues, dangling_kcs: v.dangling,
    per_kc_items: kcs.map((k) => ({ kc_id: k.id, items: items.filter((i) => (i.kc_ids || []).includes(k.id)).length })),
  };
  return { meta, kcs, prereqs, items, materials, report };
}

/* ══════════ 新建学科（scaffold_pack，与 core::api::scaffold_pack 同契约） ══════════ */

export function scaffoldPack(packsDir, args = {}) {
  const dir = packsDir || state.packsDir;
  const id = String(args.id || "").trim();
  const name = String(args.name || "").trim();
  const description = String(args.description || "");
  const author = String(args.author || "");
  const license = String(args.license || "CC-BY-SA-4.0");
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(id)) throw new Error("学科 id 只能用小写字母/数字开头，且仅含小写字母、数字、点、连字符、下划线（如 my.chinese、chinese.junior）");
  if (!name) throw new Error("显示名不能为空");
  const dest = path.join(dir, id);
  if (exists(dest)) throw new Error(`学科包已存在：${id}`);
  ensureDir(path.join(dest, "tree"));
  ensureDir(path.join(dest, "items"));
  ensureDir(path.join(dest, "material"));
  const meta = { id, name, version: "0.1.0", schema: "subject-pack/1", license, author, description, depends: [], language: "zh-CN", presentation: ["teaching", "qa"] };
  fs.writeFileSync(path.join(dest, "subject.json"), JSON.stringify(meta, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(dest, "tree", "kc.json"), "[]\n", "utf8");
  fs.writeFileSync(path.join(dest, "tree", "prereq.json"), "[]\n", "utf8");
  fs.writeFileSync(path.join(dest, "items", ".gitkeep"), "", "utf8");
  fs.writeFileSync(path.join(dest, "material", ".gitkeep"), "", "utf8");
  fs.writeFileSync(path.join(dest, "GUIDE.md"), guideTemplate(name), "utf8");
  return { ok: true, path: dest, pack: id, name };
}

function guideTemplate(name) {
  const lines = [
    "# " + name + " · 资料阅读方法（GUIDE）",
    "",
    "> 本文件是本学科包的说明书：人读是手册，喂给模型就是前置提示词的正文。",
    "",
    "## 1. 这个包教什么、给谁用",
    "",
    "（两句话说明学科范围与目标学习者。）",
    "",
    "## 2. 知识树怎么读",
    "",
    "知识点在 `tree/kc.json`，字段：`id`（包内唯一，永不复用）、`name`、`toc`（章节路径数组）、`difficulty`、`bloom`、`aliases`。规范见 `specs/subject-pack/1/SPEC.md`。",
    "",
    "## 3. 题目怎么读",
    "",
    "每题一文件 `items/it_<id>.json`：`type`、`kc_ids`（≥1）、`stem`、`options`、`answer`/`answer_text`、`analysis`、`difficulty`、`origin`、`verification`。",
    "",
    "## 4. 先修关系怎么读",
    "",
    "`tree/prereq.json` 每条边 {from,to,strength,reason}：`hard`=不会先修就学不会，`soft`=有帮助。先修图必须是 DAG（有环校验失败）。",
    "",
    "## 5. 字段词典",
    "",
    "（本包自定义字段，若无写「无」。）",
    "",
    "## 6. 一个完整示例",
    "",
    "某知识点 → 挂该知识点的题目 → 讲解素材 `material/<kc_id>.md`。",
    "",
  ];
  return lines.join("\n");
}

function kcIndex(packsDir) {
  const m = new Map();
  const dir = packsDir || state.packsDir;
  if (!exists(dir)) return m;
  for (const name of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, name);
    const kcj = path.join(p, "tree", "kc.json");
    if (!exists(kcj)) continue;
    try {
      for (const k of readJson(kcj)) m.set(k.id, { name: k.name, pack: name });
    } catch {}
  }
  return m;
}

function loadItems(packsDir) {
  const out = [];
  const dir = packsDir || state.packsDir;
  if (!exists(dir)) return out;
  // 参数既可能是「包根目录」也可能是「单个学科包目录」
  if (exists(path.join(dir, "subject.json"))) {
    const itemsDir = path.join(dir, "items");
    if (exists(itemsDir)) for (const f of fs.readdirSync(itemsDir).filter((x) => x.endsWith(".json")).sort()) {
      try { const it = readJson(path.join(itemsDir, f)); it.pack = path.basename(dir); out.push(it); } catch {}
    }
    return out;
  }
  for (const name of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, name);
    const itemsDir = path.join(p, "items");
    if (!exists(itemsDir)) continue;
    for (const f of fs.readdirSync(itemsDir).filter((x) => x.endsWith(".json")).sort()) {
      try { const it = readJson(path.join(itemsDir, f)); it.pack = name; out.push(it); } catch {}
    }
  }
  return out;
}

/* ══════════ 账本与派生（对应 learn.rs） ══════════ */

const MASTERY_OK = 0.8, STREAK_OK = 2, MAX_INTERVAL = 720, MIN_INTERVAL = 4;

function domainRoot(domain) { return domain || state.domain; }
function ledgerDir(d) { return path.join(domainRoot(d), "ledger"); }

export function nodeId(domain) {
  if (state.nodeOverride) return state.nodeOverride; // 测试用：模拟不同设备
  const d = domainRoot(domain);
  const f = path.join(d, "node.json");
  ensureDir(d);
  if (exists(f)) { try { const j = readJson(f); if (j.node) return j.node; } catch {} }
  const host = process.env.COMPUTERNAME || "node";
  const slug = (host.toLowerCase().replace(/[^a-z0-9]/g, "") || "node").slice(0, 12);
  const hash = (crypto.createHash("sha1").update(host + todayStr()).digest("hex").slice(0, 4));
  const node = `${slug}-${hash}`;
  fs.writeFileSync(f, JSON.stringify({ node, host, created: nowIso() }, null, 2));
  return node;
}

export function readEvents(domain) {
  const dir = ledgerDir(domain);
  if (!exists(dir)) return [];
  const seen = new Set(); const out = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".jsonl")).sort()) {
    for (const line of fs.readFileSync(path.join(dir, f), "utf8").split(/\r?\n/)) {
      const s = line.trim(); if (!s) continue;
      try { const ev = JSON.parse(s); if (!seen.has(ev.id)) { seen.add(ev.id); out.push(ev); } } catch {}
    }
  }
  out.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  return out;
}

function nextSeq(file) {
  let max = 0;
  if (exists(file)) for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const s = line.trim(); if (!s) continue;
    try { const v = JSON.parse(s); if (v.seq && v.seq > max) max = v.seq; } catch {}
  }
  return max + 1;
}

export function appendEvent(domain, ev) {
  const dir = ledgerDir(domain); ensureDir(dir);
  const file = path.join(dir, `${ev.node}.jsonl`);
  const out = { ...ev };
  if (!out.seq) out.seq = nextSeq(file);
  fs.appendFileSync(file, JSON.stringify(out) + "\n");
}

function parseTs(s) { const d = new Date(s); return isNaN(d) ? new Date() : d; }

export function derive(domain, at = new Date()) {
  const events = readEvents(domain);
  const kcs = new Map(); const items = new Map();
  let todayAnswers = 0, todayWrong = 0;
  const d0 = todayStr();
  const nodes = [...new Set(events.map((e) => e.node))].sort();

  for (const ev of events) {
    if (ev.kind !== "answer") continue;
    const ok = ev.ok === true;
    if (String(ev.ts).startsWith(d0)) { todayAnswers++; if (!ok) todayWrong++; }
    for (const kc of ev.kc_ids || []) {
      if (!kcs.has(kc)) kcs.set(kc, { kc_id: kc, attempts: 0, correct: 0, wrong: 0, streak: 0, last_ok: null, last_ts: null, mastery: 0, interval_hours: 0, due_ts: null, mastered: false, error_types: {}, _w: 0, _o: 0, _hist: [] });
      const st = kcs.get(kc);
      st.attempts++;
      const guess = ev.confidence === "guess", unsure = ev.confidence === "unsure", misread = ev.error_type === "misread";
      if (ok) {
        st.correct++;
        if (guess) { st.streak = 0; st.interval_hours = MIN_INTERVAL; }
        else { st.streak++; const g = unsure ? 1.4 : 2; st.interval_hours = st.streak === 1 ? 24 : Math.min(st.interval_hours * g, MAX_INTERVAL); }
      } else {
        st.wrong++; st.streak = 0;
        st.interval_hours = st.interval_hours <= 0 ? MIN_INTERVAL : Math.max(st.interval_hours / 2, MIN_INTERVAL);
      }
      st.last_ok = ok; st.last_ts = ev.ts;
      const hours = (at - parseTs(ev.ts)) / 3600000;
      const w = Math.pow(0.5, hours / 72);
      if (!(!ok && misread)) {
        st._w += w;
        if (ok) st._o += w * (guess ? 0.15 : unsure ? 0.7 : 1);
      }
      if (!ok && ev.error_type && ev.error_type !== "none") st.error_types[ev.error_type] = (st.error_types[ev.error_type] || 0) + 1;
    }
    if (ev.item_id) items.set(ev.item_id, ok);
  }
  for (const st of kcs.values()) {
    st.mastery = st._w > 0 ? Math.round((st._o / st._w) * 100) / 100 : 0;
    st.mastered = st.mastery >= MASTERY_OK && st.streak >= STREAK_OK;
    if (st.mastered && st.interval_hours < 336) st.interval_hours = 336; // 已掌握→低频抽查
    if (st.last_ts) st.due_ts = nowIso(new Date(parseTs(st.last_ts).getTime() + st.interval_hours * 3600000));
    delete st._w; delete st._o; delete st._hist;
  }
  return { node: nodeId(domain), events_total: events.length, nodes, kcs, items, today_answers: todayAnswers, today_wrong: todayWrong };
}

function dueList(st, at = new Date()) {
  return [...st.kcs.values()]
    .filter((k) => k.attempts > 0 && !k.mastered) // 已掌握不占每日配额
    .filter((k) => k.due_ts && parseTs(k.due_ts) <= at)
    .sort((a, b) => (b.error_types && b.error_types.concept_confused ? 1 : 0) - (a.error_types && a.error_types.concept_confused ? 1 : 0) || b.wrong - a.wrong || String(a.due_ts).localeCompare(String(b.due_ts)));
}
function weakList(st) {
  return [...st.kcs.values()].filter((k) => k.wrong > 0 && !k.mastered)
    .sort((a, b) => b.wrong - a.wrong || a.mastery - b.mastery);
}

const round2 = (x) => Math.round(x * 100) / 100;
function decorate(packsDir, list) {
  const idx = kcIndex(packsDir);
  return list.map((k) => {
    const m = idx.get(k.kc_id) || { name: k.kc_id, pack: "" };
    return { kc_id: k.kc_id, kc_name: m.name, pack: m.pack, attempts: k.attempts, correct: k.correct, wrong: k.wrong, streak: k.streak, mastery: round2(k.mastery), due_ts: k.due_ts, mastered: k.mastered, error_types: k.error_types };
  });
}

function judge(item, answered) {
  const norm = (s) => String(s ?? "").replace(/[\s。,．]/g, "").toLowerCase();
  const correct = item.answer;
  if (item.type === "single_choice") return norm(correct) === norm(answered);
  if (item.type === "multi_choice") {
    const a = norm(answered).split("").sort().join("");
    const b = norm(correct).split("").sort().join("");
    return a === b;
  }
  return norm(correct) === norm(answered) || norm(item.answer_text) === norm(answered);
}

/* ══════════ user.md 派生 ══════════ */

function loadSettings(domain) {
  const f = path.join(domainRoot(domain), "settings.md");
  const m = {};
  if (exists(f)) for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
    const s = line.trim(); if (!s || s === "---") continue;
    const i = s.indexOf(":"); if (i < 0) continue;
    const k = s.slice(0, i).trim(); const v = s.slice(i + 1).trim();
    if (k && v && !k.startsWith("#")) m[k] = v;
  }
  return m;
}

export function renderUserMd(domain, packsDir, st) {
  const idx = kcIndex(packsDir);
  const nm = (id) => (idx.get(id) || { name: id }).name;
  const pf = (id) => (idx.get(id) || { pack: "" }).pack;
  const set = loadSettings(domain);
  const weak = weakList(st), due = dueList(st);
  const dueIds = new Set(due.map((k) => k.kc_id));
  const mastered = [...st.kcs.values()].filter((k) => k.mastered);
  const events = readEvents(domain);
  const wrongs = events.filter((e) => e.kind === "answer" && e.ok !== true).slice().reverse();
  const results = events.filter((e) => e.kind === "delegation_result").reverse();

  const L = [];
  L.push("---", `doc: wordo/user/1`, `node: ${st.node}`, `updated: ${nowIso()}`, `events: ${st.events_total}`, `nodes: [${st.nodes.join(", ")}]`, "---");
  L.push("# 学习者状态（由账本派生，请勿手改）", "");
  L.push("> 这是「我不会的东西」的权威记录：模型读它做个性化，人读它知道该复习什么。", "");
  L.push("## 个性化设置");
  for (const k of ["daily_goal", "difficulty_min", "difficulty_max", "explain_lang", "review_first"]) if (set[k] !== undefined) L.push(`- ${k}: ${set[k]}`);
  L.push("", "## 今日进度", `- 作答 ${st.today_answers} 次，其中错 ${st.today_wrong} 次`, "");
  L.push(`## 今日复习队列（${due.length} 项）`);
  if (!due.length) L.push("- （无到期项）");
  else { L.push("| 知识点 | 学科包 | 错次 | 掌握度 | 到期 |", "|---|---|---|---|---|"); for (const k of due) L.push(`| ${nm(k.kc_id)} | ${pf(k.kc_id)} | ${k.wrong} | ${round2(k.mastery).toFixed(2)} | ${k.due_ts || "-"} |`); }
  L.push("", `## 薄弱知识点（${weak.length} 项）`);
  if (!weak.length) L.push("- （暂无）");
  else {
    L.push("| 知识点 | 掌握度 | 对/错 | 连对 | 到期复习 | 主要错因 |", "|---|---|---|---|---|---|");
    for (const k of weak) {
      const et = Object.entries(k.error_types || {}).sort((a, b) => b[1] - a[1])[0];
      L.push(`| ${nm(k.kc_id)} | ${round2(k.mastery).toFixed(2)} | ${k.correct}/${k.wrong} | ${k.streak} | ${dueIds.has(k.kc_id) ? "已到期" : k.due_ts || "-"} | ${et ? `${et[0]}×${et[1]}` : "-"} |`);
    }
  }
  L.push("", `## 已掌握（${mastered.length} 项）`);
  if (!mastered.length) L.push("- （暂无）"); else for (const k of mastered) L.push(`- ${nm(k.kc_id)}（掌握度 ${round2(k.mastery).toFixed(2)}，连对 ${k.streak}）`);
  L.push("", "## 最近错题");
  if (!wrongs.length) L.push("- （暂无）");
  else for (const ev of wrongs.slice(0, 20)) L.push(`- ${String(ev.ts).slice(0, 16)} \`${ev.item_id}\` 我选 ${ev.answered || "?"} / 正确 ${ev.correct}（${(ev.kc_ids || []).map(nm).join("、")}）`);
  L.push("", "## 其他设备帮我处理的委托");
  if (!results.length) L.push("- （暂无）");
  else for (const ev of results.slice(0, 10)) L.push(`- ${String(ev.ts).slice(0, 16)} 由 \`${ev.by_node}\` 处理：${ev.file}（${ev.note}）`);
  L.push("");
  return L.join("\n");
}

export function ensureDomain(domain) {
  const d = domainRoot(domain);
  ensureDir(path.join(d, "ledger")); ensureDir(path.join(d, "wrong"));
  const settings = path.join(d, "settings.md");
  if (!exists(settings)) fs.writeFileSync(settings, "---\ndoc: wordo/settings/1\ndaily_goal: 20\ndifficulty_min: 0.2\ndifficulty_max: 0.7\nexplain_lang: zh\nreview_first: true\n---\n# 个性化设置\n");
  const plan = path.join(d, "plan.md");
  if (!exists(plan)) fs.writeFileSync(plan, "# 学习计划 / 任务清单\n\n> 任何设备都可以往这里追加任务（append-only）。\n\n");
  return d;
}

export function writeUserMd(domain, packsDir) {
  const d = ensureDomain(domain);
  const st = derive(domain);
  const content = renderUserMd(domain, packsDir, st);
  const p = path.join(d, "user.md");
  fs.writeFileSync(p, content);
  return { content, path: p };
}

/* ══════════ 委托流 ══════════ */

export function extractMachineJson(md) {
  const re = /```json\s*([\s\S]*?)```/g;
  let m, last = null;
  while ((m = re.exec(md))) { try { last = JSON.parse(m[1]); } catch {} }
  if (last) return last;
  const pos = md.lastIndexOf("MACHINE");
  if (pos >= 0) { const tail = md.slice(pos); const a = tail.indexOf("{"), b = tail.lastIndexOf("}"); if (a >= 0 && b > a) { try { return JSON.parse(tail.slice(a, b + 1)); } catch {} } }
  return null;
}

export function exportWrongDelegation(domain, packsDir, node, date) {
  const d = ensureDomain(domain);
  const events = readEvents(domain);
  const items = loadItems(packsDir); const byId = new Map(items.map((i) => [i.id, i]));
  const idx = kcIndex(packsDir);
  const seen = new Set();
  const wrongs = events.slice().reverse().filter((e) => e.kind === "answer" && e.ok !== true && String(e.ts).startsWith(date) && !seen.has(e.item_id) && seen.add(e.item_id));
  if (!wrongs.length) return { exported: false, reason: `${date} 没有错题` };
  const payloadItems = []; let body = "";
  wrongs.forEach((ev, n) => {
    const it = byId.get(ev.item_id); const kc = (ev.kc_ids || [])[0] || "";
    const kcName = (idx.get(kc) || { name: kc }).name;
    body += `## ${n + 1}. ${kcName} — \`${ev.item_id}\`\n- 题干：${it ? it.stem : ""}\n- 我选：${ev.answered || "?"}　正确：${ev.correct}\n`;
    if (it && it.options) body += `- 选项：${it.options.map((o) => `${o.key} ${o.text}`).join(" / ")}\n`;
    body += "\n";
    payloadItems.push({ item_id: ev.item_id, kc_id: kc, kc_name: kcName, stem: it ? it.stem : "", options: it ? it.options : [], answered: ev.answered, correct: ev.correct, analysis: it ? it.analysis || "" : "" });
  });
  const payload = { items: payloadItems, from_node: node, date };
  const fileName = `${date}-${node}.md`;
  const md = `---\ndoc: wordo/delegation-wrong/1\ndate: ${date}\nfrom_node: ${node}\ncount: ${wrongs.length}\n---\n# 今日错题委托（${date}）\n\n> 请账号域内**任一**设备处理。\n\n${body}<!-- MACHINE -->\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\`\n`;
  const out = path.join(d, "wrong", fileName);
  fs.writeFileSync(out, md);
  appendEvent(domain, { id: `${Date.now()}-0-${node}`, ts: nowIso(), node, kind: "delegation_out", file: `wrong/${fileName}`, note: `${wrongs.length} 道错题` });
  return { exported: true, file: out, count: wrongs.length, items: payloadItems };
}

export function pendingDelegations(domain, me) {
  const dir = path.join(domainRoot(domain), "wrong");
  if (!exists(dir)) return [];
  const all = fs.readdirSync(dir);
  return all.filter((n) => n.endsWith(".md") && !n.includes(".result-") && !n.endsWith(`-${me}.md`))
    .filter((n) => !all.some((x) => x.startsWith(`${n}.result-`)))
    .sort().map((n) => path.join(dir, n));
}

/* ══════════ API 分发（与 Tauri 命令同名同参） ══════════ */

const configPath = () => state.configPath || path.join(process.env.APPDATA || ".", "app.wordo.desktop", "config.json");

export function presets() {
  return [
    { id: "magpie", label: "本地网关 (magpie)", baseUrl: "http://127.0.0.1:3425/v1", models: ["auto/deepseek-v4.1-flash", "auto/glm-5.3-flash", "auto/kimi-k3.1-pro", "auto/step-5-preview"] },
    { id: "nvidia", label: "NVIDIA NIM", baseUrl: "https://integrate.api.nvidia.com/v1", models: ["deepseek-ai/deepseek-v4.1-flash", "nvidia/nemotron-3-super-120b-a12b", "nvidia/nemotron-3.5-lightning-30b-a3b", "moonshotai/kimi-k2.6", "z-ai/glm-5.3-flash", "openai/gpt-oss-20b", "mistralai/mistral-large-4-1t-a52b"] },
    { id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", models: ["deepseek-chat", "deepseek-reasoner"] },
    { id: "moonshot", label: "Kimi (Moonshot)", baseUrl: "https://api.moonshot.cn/v1", models: ["moonshot-v1-8k", "moonshot-v1-32k"] },
    { id: "dashscope", label: "通义千问", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", models: ["qwen-plus", "qwen-max"] },
    { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", models: ["gpt-4o-mini", "gpt-4o"] },
    { id: "custom", label: "自定义（OpenAI 兼容）", baseUrl: "", models: [] },
  ];
}

export function getConfig() {
  const p = configPath();
  let config = { providers: [], active: 0, thinking: "normal" };
  if (exists(p)) { try { config = readJson(p); } catch {} }
  return { config, presets: presets(), path: p, domain: domainRoot() };
}

export function setConfig(cfg) {
  const p = configPath(); ensureDir(path.dirname(p));
  const pr = (cfg.providers || [])[cfg.active || 0];
  if (!pr || !pr.base_url?.trim() || !pr.api_key?.trim() || !pr.model?.trim()) throw new Error("模型配置不完整：需要 baseURL / API Key / 模型名");
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
  return { saved: true, path: p };
}

/* ══════════ 模型调用（真实 NVIDIA，OpenAI 兼容） ══════════ */

export function buildPromptFor(task, packPath, payload) { return buildPromptPayload(task, packPath, payload); }

function buildPromptPayload(task, packPath, payload) {
  // 与前缀规范同源：直接读 specs/prompt-pack/1/PROMPT.md（与 Rust 的 include_str! 完全一致）
  const TPL = fs.readFileSync(path.join(REPO_ROOT, "specs/prompt-pack/1/PROMPT.md"), "utf8");
  const dirs = exists(path.join(packPath, "subject.json")) ? [packPath] : fs.readdirSync(packPath).map((n) => path.join(packPath, n)).filter((p) => exists(path.join(p, "subject.json"))).sort();
  const kcIds = [];
  const push = (x) => { if (x && !kcIds.includes(x)) kcIds.push(x); };
  push(payload?.kc_id); (payload?.kc_ids || []).forEach(push); (payload?.items || []).forEach((i) => push(i.kc_id));
  let guide = "", kcBlock = "", itemsBlock = "", mat = "", used = 0;
  for (const p of dirs) {
    let kcs = []; try { kcs = readJson(path.join(p, "tree", "kc.json")); } catch {}
    const ids = new Set(kcs.map((k) => k.id));
    if (dirs.length > 1 && kcIds.length && !kcIds.some((k) => ids.has(k))) continue;
    const nm = path.basename(p);
    if (exists(path.join(p, "GUIDE.md"))) guide += `\n\n#### 学科包 ${nm} 的 GUIDE.md\n${fs.readFileSync(path.join(p, "GUIDE.md"), "utf8")}`;
    kcBlock += `\n\`\`\`json\n${JSON.stringify(kcs, null, 2)}\n\`\`\`\n`;
    const items = loadItems(p).map((i) => ({ id: i.id, kc_ids: i.kc_ids, stem: i.stem, answer: i.answer }));
    itemsBlock += `\n// ${nm}\n${JSON.stringify(items, null, 2)}\n`;
    for (const m of listMaterials(p)) {
      const kc = m.front?.kc_id?.[0] || m.front?.kc_id;
      if (!kc || !kcIds.includes(kc)) continue;
      const block = `（文件：material/${m.file}）\n${m.body}`;
      if (used + block.length > 14000) { mat += `\n（${kc} 的素材超预算，未注入）\n`; continue; }
      used += block.length;
      mat += `\n\n### 预置讲解素材（**必须以它为准**）\n${block}`;
    }
  }
  if (!mat) mat = "\n\n### 预置讲解素材\n（本次涉及的知识点暂无素材——请依据 kc.json 与题目索引组织内容，并在 warnings 里说明）";
  const learner = payload?._learner_md ? String(payload._learner_md).slice(0, 6000) : "（本轮未注入）";
  const injected = `${guide}\n\n### 知识点表（kc.json）\n${kcBlock}\n### 题目索引\n\`\`\`json\n${itemsBlock}\n\`\`\`${mat}\n\n### 学习者状态（user.md，个性化依据）\n${learner}`;
  const system = TPL.replace("{{READING_GUIDE}}", injected);
  return { system, user: JSON.stringify({ task, payload }) };
}

function extractJson(s) {
  const t = String(s || "").trim();
  try { return JSON.parse(t); } catch {}
  const fenced = t.replace(/^```(?:json)?/, "").replace(/```$/, "").trim();
  try { return JSON.parse(fenced); } catch {}
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch {} }
  return null;
}

async function chat(prov, temperature, system, user) {
  const url = `${String(prov.base_url).replace(/\/$/, "")}/chat/completions`;
  const body = { model: prov.model, messages: [{ role: "system", content: system }, { role: "user", content: user }], temperature, max_tokens: 6000, stream: false };
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 180000);
  try {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${String(prov.api_key).trim()}` }, body: JSON.stringify(body), signal: ctl.signal });
    const text = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}：${text.slice(0, 500)}`);
    const j = JSON.parse(text);
    return j?.choices?.[0]?.message?.content || "";
  } finally { clearTimeout(timer); }
}

export async function askModel(req) {
  const task = req?.task || "explain";
  const packPath = req?.packPath || "";
  if (!exists(packPath)) throw new Error(`学科包目录不存在：${packPath}`);
  const cfg = getConfig().config;
  const prov = (cfg.providers || [])[cfg.active || 0];
  if (!prov) throw new Error("未配置模型提供方：请先在「设置」里选择提供方并填入 API Key");
  const payload = { ...(req?.payload || {}) };
  if (!payload._learner_md) { try { payload._learner_md = writeUserMd(req?.domain || "", req?.packsDir || "").content; } catch {} }
  const { system, user } = buildPromptPayload(task, packPath, payload);
  const temperature = cfg.thinking === "fast" ? 0.6 : cfg.thinking === "deep" ? 0.2 : 0.35;
  const kcIds = new Set(kcIndex(req?.packsDir || state.packsDir).keys());
  const check = (v) => checkOutput(task, v, kcIds);
  let raw = await chat(prov, temperature, system, user);
  let data = extractJson(raw);
  let issues = data ? check(data) : ["模型输出不是合法 JSON"];
  const firstIssues = [...issues];
  let attempts = 1;
  while (issues.length && attempts <= 2) {
    const fix = `${user}\n\n【上一次输出未通过校验，请严格修正后只输出 JSON】\n问题：\n${issues.map((s) => `- ${s}`).join("\n")}`;
    raw = await chat(prov, temperature, system, fix);
    data = extractJson(raw); issues = data ? check(data) : ["模型输出不是合法 JSON"];
    attempts++;
  }
  if (data && issues.length === 0) {
    // 确定性归一化：检测题取题库、建议动作由错因决定（跨模型一致 + 避免模型编错题）
    if (task === "explain") data = normalizeExplain(packPath, (req.payload && req.payload.kc_id) || data.kc_id, data);
    if (task === "classify-error") data = normalizeClassify(data);
  }
  return { ok: !!data && issues.length === 0, data, issues, first_issues: firstIssues, raw, model: prov.model, attempts };
}

/** 确定性归一化：把「模型自由发挥」的高风险字段改成可复现的值 */
export function normalizeExplain(packPath, kcId, data) {
  try {
    const itemsDir = path.join(packPath, "items");
    if (!exists(itemsDir)) return data;
    for (const f of fs.readdirSync(itemsDir).filter((x) => x.endsWith(".json")).sort()) {
      const it = readJson(path.join(itemsDir, f));
      if (!(it.kc_ids || []).includes(kcId)) continue;
      if (!it.options || !it.options.length) continue;
      const opts = it.options.map((o) => String(o.text ?? o).replace(/^[A-D][.、]\s*/, ""));
      data.followup_question = { stem: it.stem, options: opts, answer: String(it.answer || "").toUpperCase() };
      data.warnings = Array.isArray(data.warnings) ? data.warnings : [];
      data.warnings.push("检测题取自题库（确定性来源），非模型生成");
      return data;
    }
  } catch (e) {}
  return data;
}

const ACTION_BY_ERROR = { none: "none", knowledge_missing: "review_prereq", concept_confused: "split_concept", method_missing: "drill_similar", calculation_slip: "retry_later", misread: "re_explain" };
export function normalizeClassify(data) {
  const a = ACTION_BY_ERROR[data && data.error_type];
  if (a) data.suggested_action = a;
  return data;
}

function checkOutput(task, v, kcIds) {
  const e = [];
  if (v?.task !== task) e.push(`task 字段应为「${task}」`);
  if (!Array.isArray(v?.warnings)) e.push("缺少 warnings 数组");
  else if (v.warnings.some((w) => typeof w !== "string")) e.push("warnings 元素必须是字符串");
  if (v?.schema_ver !== "1") e.push('schema_ver 必须为 "1"');
  if (task === "explain") {
    for (const k of ["kc_id", "explanation_md", "worked_example", "misconceptions", "followup_question", "tool_hints", "inferred"]) if (v[k] === undefined) e.push(`缺少字段 ${k}`);
    if (v.kc_id && kcIds.size && !kcIds.has(v.kc_id)) e.push(`kc_id「${v.kc_id}」不在知识点表中`);
    if (v.explanation_md && String(v.explanation_md).length > 2000) e.push("explanation_md 超过 2000 字");
    if (Array.isArray(v.tool_hints) && v.tool_hints.some((h) => !["canvas-geometry","graph-plot","physics-sim","timeline","mindmap","answer-board","none"].includes(h))) e.push("tool_hints 含未知值");
    const q = v.followup_question;
    if (q) {
      if (!q.stem || !String(q.stem).trim()) e.push("followup_question.stem 为空");
      if (!Array.isArray(q.options) || q.options.length !== 4) e.push("followup_question.options 应为 4 项");
      if (!/^[A-D]$/i.test(String(q.answer || "").trim())) e.push("followup_question.answer 应为 A–D");
    } else e.push("缺少 followup_question");
  } else if (task === "classify-error") {
    if (v.secondary_factor !== undefined && v.secondary_factor !== null && !["knowledge_missing","concept_confused","method_missing","calculation_slip","misread"].includes(v.secondary_factor)) e.push("secondary_factor 枚举非法");
    for (const k of ["item_id", "answered", "correct", "error_type", "confidence", "suggested_action", "notes", "inferred"]) if (v[k] === undefined) e.push(`缺少字段 ${k}`);
  } else if (task === "review-wrong") {
    if (!Array.isArray(v.reviews) || !v.reviews.length) e.push("reviews 应非空数组");
    for (const [i, r] of (v.reviews || []).entries()) {
      for (const k of ["item_id", "kc_id", "why_wrong_md", "fix_md", "variant"]) if (r[k] === undefined) e.push(`reviews[${i}] 缺少 ${k}`);
      if (!r.variant?.stem) e.push(`reviews[${i}].variant.stem 为空`);
    }
  }
  return e;
}

/* ══════════ 会话（chat-first）：事件化存储，避免整文件覆盖丢消息 ══════════ */

const chatsRoot = (d) => path.join(domainRoot(d), "chats");
const chatDir = (d, id) => path.join(chatsRoot(d), id);
const safeId = (id) => !!id && id.length <= 80 && /^[A-Za-z0-9_-]+$/.test(id);
const newMsgId = (node) => `m${Date.now()}-${node}`;

function readChatEvents(dir) {
  const seen = new Set(), out = [];
  if (!exists(dir)) return out;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".jsonl")).sort()) {
    for (const line of fs.readFileSync(path.join(dir, f), "utf8").split(/\r?\n/)) {
      const s = line.trim(); if (!s) continue;
      try { const m = JSON.parse(s); if (!seen.has(m.id)) { seen.add(m.id); out.push(m); } } catch {}
    }
  }
  // 按「解析后的时间」排序（跨时区偏移时字符串序 != 时间序）
  out.sort((a, b) => (Date.parse(a.ts) || 0) - (Date.parse(b.ts) || 0) || String(a.id).localeCompare(String(b.id)));
  return out;
}
const chatDeleted = (dir) => readChatEvents(dir).some((m) => m.kind === "__deleted");

function chatTitleOf(evs) {
  const rn = evs.filter((m) => m.kind === "__rename").pop();
  if (rn) return rn.text;
  const u = evs.find((m) => m.role === "user");
  return u ? [...String(u.text)].slice(0, 24).join("") : "";
}

export function chatList(domain) {
  const root = chatsRoot(domain);
  const out = [];
  if (!exists(root)) return { chats: [] };
  for (const id of fs.readdirSync(root)) {
    const dir = chatDir(domain, id);
    if (!exists(dir) || !fs.statSync(dir).isDirectory()) continue;
    if (!safeId(id) || chatDeleted(dir)) continue;
    const evs = readChatEvents(dir);
    if (!evs.length) continue;
    const pack = [...evs].reverse().map((m) => m.pack || "").find((p) => p) || "";
    out.push({ id, title: chatTitleOf(evs), updated: evs[evs.length - 1].ts, pack, count: evs.filter((m) => m.kind !== "__rename" && m.kind !== "__deleted").length });
  }
  out.sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
  return { chats: out };
}

export function chatGet(domain, id) {
  if (!safeId(id)) throw new Error("非法会话 id");
  const dir = chatDir(domain, id);
  if (!exists(dir)) throw new Error(`找不到会话 ${id}`);
  const evs = readChatEvents(dir);
  const messages = evs.filter((m) => m.kind !== "__rename" && m.kind !== "__deleted")
    .map((m) => ({ id: m.id, role: m.role, kind: m.kind, text: m.text, ts: m.ts, data: m.data ?? null, pack: m.pack || "", node: m.node || "" }));
  const metaPath = path.join(dir, "meta.json");
  const created = exists(metaPath) ? (readJson(metaPath).created || "") : "";
  const pack = [...evs].reverse().map((m) => m.pack || "").find((p) => p) || "";
  return { id, title: chatTitleOf(evs), pack, created, messages };
}

export function chatNew(domain, title) {
  const node = nodeId(domain);
  const id = `c${Date.now()}-${node}`;
  const dir = chatDir(domain, id);
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ id, created: nowIso() }));
  if (String(title || "").trim()) appendChatLine(dir, node, { role: "system", kind: "__rename", text: String(title).trim() });
  return chatGet(domain, id);
}

function appendChatLine(dir, node, msg) {
  ensureDir(dir);
  const m = { id: newMsgId(node), ts: nowIso(), role: "user", kind: "text", text: "", data: null, pack: "", node, ...msg };
  fs.appendFileSync(path.join(dir, `${node}.jsonl`), JSON.stringify(m) + "\n");
  return m;
}

export function chatAppend(domain, id, msg = {}) {
  const node = nodeId(domain);
  const cid = safeId(id) ? id : `c${Date.now()}-${node}`;
  const dir = chatDir(domain, cid);
  if (!exists(dir)) {
    ensureDir(dir);
    fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ id: cid, created: nowIso() }));
  }
  appendChatLine(dir, node, msg);
  return chatGet(domain, cid);
}

export function chatRename(domain, id, title) {
  if (!safeId(id)) throw new Error("非法会话 id");
  const dir = chatDir(domain, id);
  if (!exists(dir)) throw new Error(`找不到会话 ${id}`);
  appendChatLine(dir, nodeId(domain), { role: "system", kind: "__rename", text: String(title || "").trim() });
  return chatGet(domain, id);
}

export function chatDelete(domain, id) {
  if (!safeId(id)) throw new Error("非法会话 id");
  const dir = chatDir(domain, id);
  if (exists(dir)) appendChatLine(dir, nodeId(domain), { role: "system", kind: "__deleted", text: "" });
  return { deleted: true, id };
}

/** 从一句话判定学科：知识点名命中(5) > 学科名(3) > id(2) > 学科简称(1) */
export function detectSubject(domain, text, packsDir) {
  const tt = String(text || "").toLowerCase();
  const dir = packsDir || state.packsDir;
  let best = { pack: "", name: "", why: "", score: 0 };
  if (!exists(dir)) return best;
  for (const name of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, name);
    if (!exists(path.join(p, "subject.json"))) continue;
    let meta = {};
    try { meta = readJson(path.join(p, "subject.json")); } catch {}
    const nm = meta.name || "";
    let score = 0, why = "";
    try {
      for (const kc of readJson(path.join(p, "tree", "kc.json"))) {
        if (kc.name && [...kc.name].length >= 2 && tt.includes(String(kc.name).toLowerCase())) {
          score += 5;
          if (!why) why = `命中知识点「${kc.name}」`;
        }
      }
    } catch {}
    if (nm && tt.includes(nm.toLowerCase())) { score += 3; if (!why) why = `提到学科「${nm}」`; }
    const short = nm.replace("高中", "").replace("初中", "");
    if (short && tt.includes(short.toLowerCase())) score += 1;
    if (tt.includes(name.toLowerCase())) score += 2;
    if (score > best.score) best = { pack: name, name: nm || name, why, score };
  }
  return best;
}

export function verifyLedger(domain, packsDir) {
  const dir = ledgerDir(domain);
  const dupIds = [];
  const seqByNode = {};
  const all = [];
  if (exists(dir)) for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".jsonl"))) {
    const node = f.replace(/\.jsonl$/, "");
    seqByNode[node] = seqByNode[node] || [];
    for (const line of fs.readFileSync(path.join(dir, f), "utf8").split(/\r?\n/)) {
      const s = line.trim(); if (!s) continue;
      try { const v = JSON.parse(s); all.push(v); if (v.seq) seqByNode[node].push(v.seq); } catch {}
    }
  }
  const seen = new Set();
  for (const v of all) { if (seen.has(v.id)) dupIds.push(v.id); else seen.add(v.id); }
  const seqIssues = [];
  for (const [node, seqs] of Object.entries(seqByNode)) {
    const uniq = new Set(seqs);
    const max = seqs.length ? Math.max(...seqs) : 0;
    let missing = 0;
    for (let i = 1; i <= max; i++) if (!uniq.has(i)) missing++;
    const duplicate = seqs.length - uniq.size;
    if (missing || duplicate) seqIssues.push({ node, max, missing, duplicate });
  }
  const known = new Set(kcIndex(packsDir || state.packsDir).keys());
  const badKc = [...new Set(all.flatMap((e) => e.kc_ids || []).filter((k) => known.size && !known.has(k)))];
  return { events: all.length, nodes: Object.keys(seqByNode), duplicate_ids: dupIds, seq_issues: seqIssues, unknown_kc_refs: badKc, ok: !dupIds.length && !seqIssues.length && !badKc.length };
}

/** 计划列表：从账本事件派生（与 Rust 一致） */
export function planList(domain) {
  const evs = readEvents(domain);
  const done = new Set(evs.filter((e) => e.kind === "plan_done").map((e) => e.task_id));
  const seen = new Set(); const list = [];
  for (const ev of evs.filter((e) => e.kind === "plan_add")) {
    if (!ev.task_id || seen.has(ev.task_id)) continue;
    seen.add(ev.task_id);
    list.push({ id: ev.task_id, text: ev.note || "", done: done.has(ev.task_id), by: ev.node });
  }
  return list;
}

export function exportReport(domain, packsDir) {
  const d = ensureDomain(domain);
  const st = derive(domain);
  const events = readEvents(domain);
  const idx = kcIndex(packsDir || state.packsDir);
  const nm = (id) => (idx.get(id) || { name: id }).name;
  const from = Date.now() - 7 * 86400000;
  let answers = 0, correct = 0;
  const wrongs = [];
  const kcSet = new Set();
  for (const e of events) {
    if ((Date.parse(e.ts) || 0) < from) continue;
    if (e.kind !== "answer") continue;
    answers++;
    if (e.ok) correct++; else wrongs.push(e);
    (e.kc_ids || []).forEach((k) => kcSet.add(k));
  }
  const plan = planList(domain);
  const planDone = plan.filter((x) => x.done).length;
  const weak = weakList(st), due = dueList(st);
  const fmt = (t) => new Date(t).toISOString().slice(0, 10);
  let md = "# WORDO 学习周报 · " + fmt(from) + " ~ " + fmt(Date.now()) + "\n\n";
  md += "节点 " + st.node + " ｜ 事件 " + events.length + " 条\n\n## 概览\n";
  md += "- 作答 **" + answers + "** 次，正确 **" + correct + "**（" + (answers ? Math.round((correct / answers) * 100) + "%" : "-") + "）\n";
  md += "- 涉及知识点 **" + kcSet.size + "** 个；薄弱 **" + weak.length + "**；今日到期 **" + due.length + "**\n";
  md += "- 计划完成 **" + planDone + "/" + plan.length + "**\n\n## 薄弱与到期\n";
  if (!weak.length) md += "- （无）\n";
  else {
    md += "| 知识点 | 掌握度 | 对 / 错 | 到期 |\n|---|---|---|---|\n";
    for (const k of weak.slice(0, 10)) md += "| " + nm(k.kc_id) + " | " + Math.round(k.mastery * 100) / 100 + " | " + k.correct + "/" + k.wrong + " | " + (k.due_ts || "-") + " |\n";
  }
  md += "\n## 本周错题\n";
  if (!wrongs.length) md += "- （无）\n";
  else for (const e of wrongs.reverse().slice(0, 20)) md += "- " + String(e.ts).slice(0, 16) + " " + e.item_id + " 我选 " + (e.answered || "?") + " / 正确 " + e.correct + "（" + (e.kc_ids || []).map(nm).join("、") + "）\n";
  md += "\n## 学习计划\n";
  if (!plan.length) md += "- （无）\n";
  else for (const x of plan) md += "- [" + (x.done ? "x" : " ") + "] " + x.text + "\n";
  md += "\n## 建议下一步\n";
  const sug = [];
  for (const k of weak.slice(0, 2)) sug.push("先补齐「" + nm(k.kc_id) + "」（掌握度 " + Math.round(k.mastery * 100) + "%）");
  for (const k of due.slice(0, 2)) sug.push("今日到期：「" + nm(k.kc_id) + "」");
  if (!sug.length) sug.push("保持节奏：说「混合练 3 个薄弱点」做一次交错练习");
  for (const s of sug) md += "- " + s + "\n";
  const dir = path.join(d, "reports");
  ensureDir(dir);
  const file = path.join(dir, "周报-" + new Date().toISOString().slice(0, 10) + ".md");
  fs.writeFileSync(file, md, "utf8");
  return { path: file, markdown: md };
}

export async function invoke(name, args = {}) {
  const packsDir = args.packsDir || state.packsDir;
  const domain = args.domain || state.domain;
  switch (name) {
    case "list_packs": return list_packs(packsDir);
    case "scaffold_pack": return scaffoldPack(packsDir, args);
    case "load_pack": return load_pack(args.packPath || "");
    case "get_config": return getConfig();
    case "set_config": return setConfig(args.config || {});
    case "build_prompt": { const { system, user } = buildPromptPayload(args.task || "explain", args.packPath || "", args.payload || {}); return { system, user, task: args.task || "explain" }; }
    case "ask_model": {
      // 前端按 Tauri 命令签名传 { req: {...} }，这里解包（与 Rust 的 ask_model(req) 一致）
      const req = args.req || args;
      return askModel({ ...req, packsDir: req.packsDir || packsDir, domain: req.domain ?? domain });
    }
    case "learn_state": { const { content, path: p } = writeUserMd(domain, packsDir); return { userMd: content, path: p, domain: domainRoot(domain) }; }
    case "learn_due": {
      const st = derive(domain);
      return { weak: decorate(packsDir, weakList(st)), due: decorate(packsDir, dueList(st)), today_answers: st.today_answers, today_wrong: st.today_wrong, nodes: st.nodes, events_total: st.events_total, domain: domainRoot(domain) };
    }
    case "learn_queue": {
      const st = derive(domain); const items = loadItems(packsDir).filter((i) => (i.kc_ids || []).includes(args.kcId));
      items.sort((a, b) => rank(st, a) - rank(st, b));
      return { items: items.slice(0, args.n || 3) };
    }
    case "record_answer": {
      const items = loadItems(packsDir); const it = items.find((i) => i.id === args.itemId);
      if (!it) throw new Error(`找不到题目 ${args.itemId}`);
      const ok = judge(it, args.answered);
      const node = nodeId(domain);
      const ev = { id: `${Date.now()}-0-${node}`, ts: nowIso(), node, kind: "answer", pack: args.pack || it.pack || "", item_id: it.id, kc_ids: it.kc_ids || [], answered: args.answered || "", correct: it.answer, ok, source: args.source || "quiz", error_type: args.errorType || null, confidence: args.confidence || null };
      appendEvent(domain, ev);
      const st = derive(domain); const kc = st.kcs.get((it.kc_ids || [])[0]);
      try { writeUserMd(domain, packsDir); } catch {}
      return { ok, correct: it.answer, kc, nextDue: kc?.due_ts || null, eventId: ev.id };
    }
    case "learn_sync": {
      writeUserMd(domain, packsDir);
      const st = derive(domain); const me = nodeId(domain);
      const perNode = {}; for (const e of readEvents(domain)) perNode[e.node] = (perNode[e.node] || 0) + 1;
      return { domain: domainRoot(domain), node: me, events_total: st.events_total, per_node: perNode, weak: weakList(st).length, due: dueList(st).length, pending_delegations: pendingDelegations(domain, me).map((p) => path.basename(p)), user_md: path.join(domainRoot(domain), "user.md") };
    }
    case "learn_delegate": return exportWrongDelegation(domain, packsDir, nodeId(domain), args.date || todayStr());
    case "learn_review": {
      const me = nodeId(domain); const cfg = getConfig().config;
      const pending = pendingDelegations(domain, me);
      const processed = [];
      for (const f of pending.slice(0, args.limit || 3)) {
        const payload = extractMachineJson(fs.readFileSync(f, "utf8")); if (!payload) continue;
        const res = await askModel({ task: "review-wrong", packPath: packsDir, packsDir, domain, payload });
        if (!res.data) continue;
        const srcName = path.basename(f);
        const out = path.join(domainRoot(domain), "wrong", `${srcName}.result-${me}.md`);
        let body = "";
        for (const r of res.data.reviews || []) {
          body += `## \`${r.item_id}\`（${r.kc_id}）\n**错因**：${r.why_wrong_md}\n\n**补讲**：${r.fix_md}\n\n`;
          if (r.variant) body += `**变式题**：${r.variant.stem}\n- 选项：${(r.variant.options || []).join(" / ")}\n- 答案：${r.variant.answer}\n\n`;
        }
        fs.writeFileSync(out, `---\ndoc: wordo/delegation-result/1\nfrom_node: ${payload.from_node}\nby_node: ${me}\ndate: ${payload.date}\ncount: ${(res.data.reviews || []).length}\n---\n# 委托处理结果\n\n${body}\n\`\`\`json\n${JSON.stringify(res.data, null, 2)}\n\`\`\`\n`);
        appendEvent(domain, { id: `${Date.now()}-0-${me}`, ts: nowIso(), node: me, kind: "delegation_result", file: `wrong/${srcName}.result-${me}.md`, by_node: me, note: `处理 ${payload.from_node} 的 ${(res.data.reviews || []).length} 道错题` });
        processed.push({ src: srcName, result: path.basename(out), ok: res.ok, attempts: res.attempts });
      }
      writeUserMd(domain, packsDir);
      return { processed, pending_before: pending.length };
    }
    case "record_judged": {
      const node = nodeId(domain);
      const ev = {
        id: `${Date.now()}-0-${node}`, ts: nowIso(), node, kind: "answer",
        pack: args.pack || "", item_id: args.syntheticId || "", kc_ids: args.kcId ? [args.kcId] : [],
        answered: args.answered || "", correct: args.ok ? "(judged-correct)" : "(judged-wrong)",
        ok: !!args.ok, source: args.source || "followup", error_type: args.errorType || null, confidence: args.confidence || null,
      };
      appendEvent(domain, ev);
      try { writeUserMd(domain, packsDir); } catch {}
      const st = derive(domain);
      const kc = args.kcId ? st.kcs.get(args.kcId) || null : null;
      return { ok: !!args.ok, eventId: ev.id, kc, nextDue: kc ? kc.due_ts : null };
    }
    case "record_explain": {
      const node = nodeId(domain);
      const ev = { id: `${Date.now()}-0-${node}`, ts: nowIso(), node, kind: "explain", pack: args.pack || "", kc_ids: args.kcId ? [args.kcId] : [], model: args.model || "", source: args.source || "ai" };
      appendEvent(domain, ev);
      return { ok: true, eventId: ev.id };
    }
    case "export_report": return exportReport(domain, packsDir);
    case "verify_ledger": return verifyLedger(domain, packsDir);
    case "chat_list": return chatList(domain);
    case "chat_get": return chatGet(domain, args.id);
    case "chat_new": return chatNew(domain, args.title);
    case "chat_append": return chatAppend(domain, args.id, args.msg);
    case "chat_rename": return chatRename(domain, args.id, args.title);
    case "chat_delete": return chatDelete(domain, args.id);
    case "detect_subject": return detectSubject(domain, args.text, packsDir);
    case "learn_plan": {
      const d = ensureDomain(domain); const me = nodeId(domain);
      if (args.action === "add") {
        const id = `t${Date.now()}`;
        fs.appendFileSync(path.join(d, "plan.md"), `- [ ] ${id} · ${args.text || ""}\n`);
        appendEvent(domain, { id: `${Date.now()}-0-${me}`, ts: nowIso(), node: me, kind: "plan_add", task_id: id, note: args.text || "" });
        return { added: id };
      }
      if (args.action === "done") { appendEvent(domain, { id: `${Date.now()}-0-${me}`, ts: nowIso(), node: me, kind: "plan_done", task_id: args.taskId || "" }); return { done: args.taskId }; }
      const done = new Set(readEvents(domain).filter((e) => e.kind === "plan_done").map((e) => e.task_id));
      const seen = new Set(); const list = [];
      for (const ev of readEvents(domain).filter((e) => e.kind === "plan_add")) {
        if (!ev.task_id || seen.has(ev.task_id)) continue;
        seen.add(ev.task_id);
        list.push({ id: ev.task_id, text: ev.note || "", done: done.has(ev.task_id), by: ev.node });
      }
      return { plan: list };
    }
    default: throw new Error(`未知 api: ${name}`);
  }
}

function rank(st, item) {
  const v = st.items.get(item.id);
  return v === false ? 0 : v === undefined ? 1 : 2;
}
