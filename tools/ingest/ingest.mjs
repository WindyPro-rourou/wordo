// tools/ingest/ingest.mjs
// 内容入库管线：把「教材 / OCR 文本 / 出卷 JSON」灌进一个 subject-pack/1 学科包。
//   node ingest.mjs --pack <包目录> --input <文件> [--format auto|md|json] [--prefix kc_xxx]
//
// 支持三类输入：
//   (a) Markdown 教材/OCR：按 #/##/### 标题层级解析 toc，生成/追加 kc，并把每节正文写成 material/<kc_id>.md
//   (b) 结构化 JSON：{ kcs:[{name,toc?,difficulty?,...}], items:[{kc?|kc_ids?,type,stem,options?,answer,...}], prereq:[{from,to,strength,reason}] }
//   (c) OCR 纯文本：等同 md（无标题则整篇一个 kc，文首首行作名）
//
// 幂等：kc 按 name/id 去重，item 按 id（无 id 则按 type+stem）去重，prereq 按 from→to 去重。
// 安全：先算好合并后的完整模型并跑 validateModel，有 error 则报出且「不写任何文件」。
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { validateModel } from "./validate.mjs";

/* ───────────── 小工具 ───────────── */
const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const str = (x) => (typeof x === "string" ? x : x === null || x === undefined ? "" : String(x));
const arr = (x) => (Array.isArray(x) ? x : []);
const pad4 = (n) => String(n).padStart(4, "0");
const escapeReg = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function slugify(s) {
  return (
    String(s)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "pack"
  );
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (typeof a === "string" && a.startsWith("--")) {
      const key = a.slice(2);
      if (key === "help" || key === "h") {
        out.help = true;
      } else {
        const v = argv[i + 1];
        if (v === undefined || (typeof v === "string" && v.startsWith("--"))) {
          out[key] = true;
        } else {
          out[key] = v;
          i++;
        }
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

function readJsonMaybe(p) {
  if (!fs.existsSync(p)) return { exists: false };
  const txt = fs.readFileSync(p, "utf8");
  try {
    return { exists: true, ok: true, value: JSON.parse(txt.replace(/^\uFEFF/, "")) };
  } catch (e) {
    return { exists: true, ok: false, error: e.message };
  }
}

/* ───────────── Markdown / OCR 解析 ───────────── */
function normalizeToc(toc, name) {
  if (Array.isArray(toc)) {
    const a = toc.map((x) => str(x).trim()).filter(Boolean);
    if (a.length) return a;
  } else if (typeof toc === "string" && toc.trim() !== "") {
    const parts = toc
      .split(/\s*(?:\/|>|／|→)\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length) return parts;
  }
  return [name];
}

/**
 * 解析 markdown 为若干「有正文的小节」。每个小节 { name, toc, body }。
 * 标题层级（#/##/###…）构成 toc；仅当某标题下「直接正文」非空时才成为一个知识点
 * （纯分类标题没有直接正文→不产生 KC；其子节各自成为 KC，toc 含父标题）。
 */
function parseMarkdown(text) {
  const lines = String(text).replace(/^\uFEFF/, "").split(/\r?\n/);
  const sections = [];
  const stack = []; // {level,title}
  let cur = null;
  const flush = () => {
    if (cur) {
      const body = cur.bodyLines.join("\n").trim();
      if (body !== "") sections.push({ name: cur.name, toc: cur.toc.slice(), body });
      cur = null;
    }
  };
  for (const line of lines) {
    const m = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (m) {
      const level = m[1].length;
      const title = m[2].trim();
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      stack.push({ level, title });
      flush();
      cur = { name: title, toc: stack.map((s) => s.title), bodyLines: [] };
    } else if (cur) {
      cur.bodyLines.push(line);
    }
  }
  flush();
  return sections;
}

function ocrFallback(text) {
  const lines = String(text).replace(/^\uFEFF/, "").split(/\r?\n/);
  const first = lines.find((l) => l.trim() !== "") || "未命名";
  const name = first.replace(/^#+\s*/, "").replace(/[`*_]/g, "").trim().slice(0, 60) || "未命名";
  return [{ name, toc: [name], body: String(text).trim() }];
}

function detectFormat(text, requested) {
  const r = str(requested).toLowerCase();
  if (r === "md" || r === "markdown") return "md";
  if (r === "json") return "json";
  const t = String(text).trim();
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      const j = JSON.parse(t);
      if (isObj(j) && (Array.isArray(j.kcs) || Array.isArray(j.items) || Array.isArray(j.prereq))) return "json";
    } catch {
      /* 不是合法 JSON，按 md 处理 */
    }
  }
  return "md";
}

/* ───────────── 核心入库 ───────────── */
export function ingestFile({ packDir: packArg, inputFile, format = "auto", prefix = "" }) {
  const packDir = path.resolve(str(packArg));
  const inputPath = path.resolve(str(inputFile));

  if (!fs.existsSync(packDir) || !fs.statSync(packDir).isDirectory()) {
    throw new Error(`学科包目录不存在：${packDir}`);
  }
  const subjPath = path.join(packDir, "subject.json");
  if (!fs.existsSync(subjPath)) {
    throw new Error(`不是有效的学科包（缺少 subject.json）：${packDir}\n请先用 scaffold.mjs 生成骨架。`);
  }
  if (!fs.existsSync(inputPath)) {
    throw new Error(`输入文件不存在：${inputPath}`);
  }

  // 读元数据
  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(subjPath, "utf8").replace(/^\uFEFF/, ""));
  } catch (e) {
    throw new Error(`subject.json 解析失败：${e.message}`);
  }
  if (!isObj(meta) || !meta.id) throw new Error("subject.json 缺少 id，无法派生 kc 前缀。");
  const slug = slugify(meta.id);
  const kcPrefix = str(prefix) && String(prefix).trim() ? String(prefix).trim() : `kc_${slug}`;

  // 读已有数据
  const kcRead = readJsonMaybe(path.join(packDir, "tree", "kc.json"));
  if (kcRead.exists && !kcRead.ok) throw new Error(`已有 tree/kc.json 无法解析：${kcRead.error}`);
  const existingKcs = kcRead.ok ? arr(kcRead.value) : [];

  const prRead = readJsonMaybe(path.join(packDir, "tree", "prereq.json"));
  if (prRead.exists && !prRead.ok) throw new Error(`已有 tree/prereq.json 无法解析：${prRead.error}`);
  const existingPrereq = prRead.ok ? arr(prRead.value) : [];

  const itemsDir = path.join(packDir, "items");
  const existingItems = []; // [{filename, value}]
  if (fs.existsSync(itemsDir) && fs.statSync(itemsDir).isDirectory()) {
    for (const f of fs.readdirSync(itemsDir).filter((x) => x.endsWith(".json")).sort()) {
      try {
        existingItems.push({ filename: f, value: JSON.parse(fs.readFileSync(path.join(itemsDir, f), "utf8").replace(/^\uFEFF/, "")) });
      } catch (e) {
        throw new Error(`已有题目 items/${f} 无法解析：${e.message}`);
      }
    }
  }

  const guidePath = path.join(packDir, "GUIDE.md");
  const guideExists = fs.existsSync(guidePath);
  const guideText = guideExists ? fs.readFileSync(guidePath, "utf8") : "";

  // 读输入
  const rawText = fs.readFileSync(inputPath, "utf8");
  const fmt = detectFormat(rawText, format);

  let incomingKcs = []; // 待合并知识点（md: 带 body）
  let incomingItems = [];
  let incomingPrereq = [];
  let modeLabel = fmt;

  if (fmt === "json") {
    let obj;
    try {
      obj = JSON.parse(rawText.replace(/^\uFEFF/, ""));
    } catch (e) {
      throw new Error(`--format json 但输入不是合法 JSON：${e.message}`);
    }
    if (!isObj(obj)) throw new Error("结构化 JSON 顶层必须是对象（含 kcs/items/prereq）。");
    incomingKcs = arr(obj.kcs).map((k) => (isObj(k) ? { ...k } : {}));
    incomingItems = arr(obj.items);
    incomingPrereq = arr(obj.prereq);
  } else {
    const sections = parseMarkdown(rawText);
    if (sections.length) {
      incomingKcs = sections; // {name,toc,body}
      modeLabel = "md";
    } else {
      incomingKcs = ocrFallback(rawText);
      modeLabel = "md(ocr)";
    }
  }

  /* ── 合并知识点（按 name 去重；新 id 依 kcPrefix 递增） ── */
  const usedKcIds = new Set(existingKcs.map((k) => k && k.id).filter((x) => typeof x === "string"));
  const nameToId = new Map();
  for (const k of existingKcs) {
    if (isObj(k) && typeof k.name === "string" && k.name && !nameToId.has(k.name)) nameToId.set(k.name, k.id);
  }
  // 现有前缀下的最大序号
  const kcSeqRe = new RegExp(`^${escapeReg(kcPrefix)}_(\\d+)$`);
  let kcSeq = 0;
  for (const id of usedKcIds) {
    const m = kcSeqRe.exec(id);
    if (m) kcSeq = Math.max(kcSeq, parseInt(m[1], 10));
  }
  const nextKcId = () => {
    let cand;
    do {
      kcSeq++;
      cand = `${kcPrefix}_${pad4(kcSeq)}`;
    } while (usedKcIds.has(cand));
    usedKcIds.add(cand);
    return cand;
  };

  const newKcs = [];
  const mergeErrors = [];
  let reusedKc = 0;
  const indexMap = []; // incomingKcs[i] -> resolved id

  incomingKcs.forEach((kc, i) => {
    const name = str(kc.name ?? kc.title ?? "").trim();
    if (!name) {
      mergeErrors.push(`第 ${i + 1} 个知识点缺少 name，已跳过`);
      indexMap[i] = null;
      return;
    }
    let resolvedId;
    if (nameToId.has(name)) {
      resolvedId = nameToId.get(name);
      reusedKc++;
    } else {
      resolvedId = nextKcId();
      const nk = { id: resolvedId, name, toc: normalizeToc(kc.toc, name) };
      if (kc.difficulty !== undefined && kc.difficulty !== null) nk.difficulty = kc.difficulty;
      if (kc.bloom !== undefined && kc.bloom !== null) nk.bloom = kc.bloom;
      if (Array.isArray(kc.aliases) && kc.aliases.length) nk.aliases = kc.aliases;
      newKcs.push(nk);
      nameToId.set(name, resolvedId);
    }
    indexMap[i] = resolvedId;
    kc._resolvedId = resolvedId; // 供 material 落盘使用（仅 md 有 body）
  });

  /* ── 合并题目（按 id；无 id 则按 type+stem 去重） ── */
  const resolveKcRef = (ref) => {
    if (ref === null || ref === undefined) return null;
    if (typeof ref === "number") {
      if (Number.isInteger(ref) && ref >= 1 && ref <= indexMap.length) return indexMap[ref - 1] || null;
      return null;
    }
    const s = String(ref).trim();
    if (!s) return null;
    if (/^\d+$/.test(s)) {
      const n = parseInt(s, 10);
      if (n >= 1 && n <= indexMap.length) return indexMap[n - 1] || null;
    }
    if (nameToId.has(s)) return nameToId.get(s);
    if (usedKcIds.has(s)) return s;
    return null;
  };

  const existingItemIds = new Set();
  const existingStemKeys = new Set();
  for (const e of existingItems) {
    const v = e.value;
    if (isObj(v)) {
      if (typeof v.id === "string") existingItemIds.add(v.id);
      if (typeof v.stem === "string") existingStemKeys.add(`${str(v.type)}|${v.stem}`);
    }
  }
  const itemSeqRe = new RegExp(`^it_${escapeReg(slug)}_(\\d+)$`);
  let itemSeq = 0;
  for (const id of existingItemIds) {
    const m = itemSeqRe.exec(id);
    if (m) itemSeq = Math.max(itemSeq, parseInt(m[1], 10));
  }
  const nextItemId = () => {
    let cand;
    do {
      itemSeq++;
      cand = `it_${slug}_${pad4(itemSeq)}`;
    } while (existingItemIds.has(cand) || newItems.some((n) => n.data.id === cand));
    return cand;
  };

  const newItems = [];
  let skippedItems = 0;

  for (const it of incomingItems) {
    if (!isObj(it)) {
      mergeErrors.push("存在非对象的题目，已跳过");
      continue;
    }
    // 解析知识点引用
    let refs = [];
    if (it.kc_ids !== undefined) refs = arr(it.kc_ids);
    else if (it.kcs !== undefined) refs = arr(it.kcs);
    else if (it.kc !== undefined) refs = [it.kc];
    if (!refs.length) {
      mergeErrors.push(`题目「${str(it.id) || str(it.stem).slice(0, 20)}」未提供知识点引用（kc/kc_ids）`);
      continue;
    }
    const kcIds = [];
    let refOk = true;
    for (const r of refs) {
      const rid = resolveKcRef(r);
      if (!rid) {
        mergeErrors.push(`题目「${str(it.id) || str(it.stem).slice(0, 20)}」的知识点引用「${str(r)}」无法解析`);
        refOk = false;
      } else if (!kcIds.includes(rid)) {
        kcIds.push(rid);
      }
    }
    if (!refOk || !kcIds.length) continue;

    // 组装 item
    const itemData = { id: null, type: it.type };
    itemData.kc_ids = kcIds;
    itemData.stem = str(it.stem);
    if (Array.isArray(it.options)) {
      itemData.options = it.options.map((o, idx) =>
        isObj(o)
          ? {
              key: o.key !== undefined && o.key !== null ? String(o.key) : undefined,
              text: o.text !== undefined && o.text !== null ? String(o.text) : undefined,
            }
          : { key: String.fromCharCode(65 + idx), text: str(o) }
      );
    }
    if (it.answer !== undefined && it.answer !== null) itemData.answer = str(it.answer);
    if (it.answer_text !== undefined && it.answer_text !== null) itemData.answer_text = str(it.answer_text);
    if (it.analysis !== undefined && it.analysis !== null) itemData.analysis = str(it.analysis);
    if (it.difficulty !== undefined && it.difficulty !== null) itemData.difficulty = it.difficulty;
    itemData.origin = isObj(it.origin)
      ? it.origin
      : { source_type: "generated", source_ref: "ingest", redistributable: true };
    itemData.verification = isObj(it.verification) ? it.verification : { answer_checked_by: "ingest", human_reviewed: false };

    // 定 id（幂等去重）
    const providedId = typeof it.id === "string" && it.id.trim() ? it.id.trim() : null;
    if (providedId) {
      if (existingItemIds.has(providedId) || newItems.some((n) => n.data.id === providedId)) {
        skippedItems++;
        continue;
      }
      itemData.id = providedId;
      existingItemIds.add(providedId);
      existingStemKeys.add(`${str(itemData.type)}|${itemData.stem}`);
    } else {
      const key = `${str(itemData.type)}|${itemData.stem}`;
      if (existingStemKeys.has(key)) {
        skippedItems++;
        continue;
      }
      itemData.id = nextItemId();
      existingItemIds.add(itemData.id);
      existingStemKeys.add(key);
    }
    newItems.push({ filename: `${itemData.id}.json`, data: itemData });
  }

  /* ── 合并先修边（按 from→to 去重） ── */
  const existingEdgeKeys = new Set();
  for (const p of existingPrereq) {
    if (isObj(p) && typeof p.from === "string" && typeof p.to === "string") existingEdgeKeys.add(`${p.from}→${p.to}`);
  }
  const newEdges = [];
  for (const e of incomingPrereq) {
    if (!isObj(e)) {
      mergeErrors.push("存在非对象的先修边，已跳过");
      continue;
    }
    const from = resolveKcRef(e.from);
    const to = resolveKcRef(e.to);
    if (!from || !to) {
      mergeErrors.push(`先修边 from/to 无法解析：${JSON.stringify(e.from)} → ${JSON.stringify(e.to)}`);
      continue;
    }
    const key = `${from}→${to}`;
    if (existingEdgeKeys.has(key)) continue;
    const edge = { from, to };
    if (e.strength !== undefined) edge.strength = e.strength;
    if (e.reason !== undefined) edge.reason = e.reason;
    newEdges.push(edge);
    existingEdgeKeys.add(key);
  }

  /* ── 组装合并后的完整模型并校验（先算好，不落盘） ── */
  if (mergeErrors.length) {
    return { ok: false, phase: "merge", errors: mergeErrors, newKcs: 0, newItems: 0, newEdges: 0 };
  }

  const mergedKcs = existingKcs.concat(newKcs);
  const mergedPrereq = existingPrereq.concat(newEdges);
  const mergedItems = existingItems
    .map((e) => ({ filename: e.filename, ok: true, value: e.value }))
    .concat(newItems.map((n) => ({ filename: n.filename, ok: true, value: n.data })));

  const report = validateModel({
    dir: packDir,
    meta: { ok: true, value: meta },
    guide: { exists: guideExists, text: guideText },
    kc: { ok: true, value: mergedKcs },
    prereq: { ok: true, value: mergedPrereq },
    items: mergedItems,
    itemsDirExists: true,
  });

  if (report.errors.length) {
    return {
      ok: false,
      phase: "validate",
      errors: report.errors.map((e) => `${e.file} (${e.code}): ${e.msg}`),
      warnings: report.warnings,
      stats: report.stats,
      newKcs: 0,
      newItems: 0,
      newEdges: 0,
    };
  }

  /* ── 落盘 ── */
  const written = [];
  fs.mkdirSync(path.join(packDir, "tree"), { recursive: true });
  fs.writeFileSync(path.join(packDir, "tree", "kc.json"), JSON.stringify(mergedKcs, null, 2) + "\n", "utf8");
  written.push("tree/kc.json");
  fs.writeFileSync(path.join(packDir, "tree", "prereq.json"), JSON.stringify(mergedPrereq, null, 2) + "\n", "utf8");
  written.push("tree/prereq.json");

  if (newItems.length) {
    fs.mkdirSync(itemsDir, { recursive: true });
    for (const n of newItems) {
      fs.writeFileSync(path.join(itemsDir, n.filename), JSON.stringify(n.data, null, 2) + "\n", "utf8");
      written.push(`items/${n.filename}`);
    }
  }

  // md 小节正文 → material/<kc_id>.md
  const materialPaths = [];
  const mdSections = fmt === "md" ? incomingKcs.filter((k) => k && k._resolvedId && typeof k.body === "string") : [];
  if (mdSections.length) {
    const matDir = path.join(packDir, "material");
    fs.mkdirSync(matDir, { recursive: true });
    for (const sec of mdSections) {
      const file = path.join(matDir, `${sec._resolvedId}.md`);
      const content = `---\nkc_id: ${sec._resolvedId}\nstyles: [intuitive]\n---\n# ${sec.name}\n\n${sec.body}\n`;
      fs.writeFileSync(file, content, "utf8");
      materialPaths.push(`material/${sec._resolvedId}.md`);
      written.push(`material/${sec._resolvedId}.md`);
    }
  }

  return {
    ok: true,
    packDir,
    metaId: meta.id,
    format: modeLabel,
    newKcs: newKcs.length,
    reusedKc,
    newItems: newItems.length,
    skippedItems,
    newEdges: newEdges.length,
    materialFiles: materialPaths.length,
    written,
    stats: report.stats,
    warnings: report.warnings,
  };
}

function main(argv) {
  const a = parseArgs(argv);
  if (a.help) {
    console.log("用法: node ingest.mjs --pack <包目录> --input <文件> [--format auto|md|json] [--prefix kc_xxx]");
    return;
  }
  const pack = typeof a.pack === "string" ? a.pack : "";
  const input = typeof a.input === "string" ? a.input : "";
  const format = typeof a.format === "string" ? a.format : "auto";
  const prefix = typeof a.prefix === "string" ? a.prefix : "";
  if (!pack || !input) {
    console.error("用法: node ingest.mjs --pack <包目录> --input <文件> [--format auto|md|json] [--prefix kc_xxx]");
    process.exitCode = 2;
    return;
  }
  try {
    const r = ingestFile({ packDir: pack, inputFile: input, format, prefix });
    if (!r.ok) {
      console.error(`❌ ingest 失败（${r.phase}）：未写入任何文件。`);
      for (const e of r.errors || []) console.error(`   - ${e}`);
      if (r.stats) console.error(`   （合并后统计：kc=${r.stats.kc} 题=${r.stats.items} 覆盖=${r.stats.coverage_pct}%）`);
      process.exitCode = 1;
      return;
    }
    console.log(`✅ ingest 完成：${r.metaId}   [格式 ${r.format}]`);
    console.log(`   新增知识点 ${r.newKcs} 个（复用 ${r.reusedKc} 个），新增题目 ${r.newItems} 道（跳过重复 ${r.skippedItems} 道），新增先修边 ${r.newEdges} 条`);
    console.log(`   写入文件：${r.written.join("、")}`);
    console.log(`   校验结果：错误 0，警告 ${r.warnings.length}，当前 kc=${r.stats.kc} 题=${r.stats.items} 覆盖率=${r.stats.coverage_pct}% 悬空知识点=${r.stats.dangling.length}`);
    if (r.warnings.length) {
      for (const w of r.warnings) console.log(`   [WARN] ${w.file} (${w.code}): ${w.msg}`);
    }
  } catch (e) {
    console.error(`❌ ${e.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
