// tools/ingest/validate.mjs
// 纯 JS 复刻 core/src/validate.rs 的 subject-pack/1 校验规则。
// 用途：无 Rust 环境的本地快速校验（Rust `wordo validate-pack` 仍为权威校验）。
// 导出 validatePack / validateModel，供 ingest.mjs 与 test.mjs 复用；也可作 CLI：
//   node validate.mjs <包目录> [--json]
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const SCHEMA_VERSION = "subject-pack/1";
export const ITEM_TYPES = ["single_choice", "multi_choice", "fill_blank", "short_answer", "judge"];
export const SOURCE_TYPES = ["scraped", "generated", "user_note", "licensed"];
export const STRENGTHS = ["hard", "soft"];
export const BLOOM_LEVELS = ["记忆", "理解", "应用", "分析", "评价", "创造"];

const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const str = (x) => (typeof x === "string" ? x : "");
const arr = (x) => (Array.isArray(x) ? x : []);

/** id 规则：小写字母/数字开头，仅含小写字母、数字、点、连字符、下划线（与 Rust valid_id 一致） */
export function validId(s) {
  const t = str(s);
  return /^[a-z0-9][a-z0-9._-]*$/.test(t);
}
/** 宽松 semver：x.y.z，各段非负整数 */
export function validVersion(s) {
  return /^\d+\.\d+\.\d+$/.test(str(s));
}

const mkIssue = (level, file, code, msg) => ({ level, file, code, msg });

/** 先修图环检测（DFS 三色标记），返回一个环路径（若有）。与 Rust find_cycle 语义一致。 */
export function findCycle(nodes, adj) {
  const color = new Map(); // 0=white 1=gray 2=black
  for (const n of nodes) color.set(n, 0);
  const stack = [];
  const dfs = (u) => {
    color.set(u, 1);
    stack.push(u);
    const vs = adj.get(u) || [];
    for (const v of vs) {
      const st = color.has(v) ? color.get(v) : 0;
      if (st === 1) {
        const start = stack.indexOf(v);
        const cyc = stack.slice(start >= 0 ? start : 0);
        cyc.push(v);
        return cyc;
      }
      if (st === 0) {
        const c = dfs(v);
        if (c) return c;
      }
    }
    stack.pop();
    color.set(u, 2);
    return null;
  };
  for (const n of nodes) {
    if ((color.get(n) || 0) === 0) {
      const c = dfs(n);
      if (c) return c;
    }
  }
  return null;
}

/**
 * 校验一个「已解析进内存」的学科包模型。
 * model = {
 *   dir: string,
 *   meta:   { ok:true, value:object } | { ok:false, error:string },
 *   guide:  { exists:boolean, text:string },
 *   kc:     { ok:true, value:[] } | { ok:false, error:string },
 *   prereq: { ok:true, value:[] } | { ok:false, error:string },
 *   items:  [{ filename, ok:true, value } | { filename, ok:false, error }],
 *   itemsDirExists: boolean,
 * }
 * 返回 { packPath, errors:[], warnings:[], issues:[], stats:{...} }
 */
export function validateModel(model) {
  const errors = [];
  const warnings = [];
  const E = (file, code, msg) => errors.push(mkIssue("error", file, code, msg));
  const W = (file, code, msg) => warnings.push(mkIssue("warning", file, code, msg));

  const finish = (kc_count = 0, edge_count = 0, item_count = 0, coverage_pct = 0, dangling = [], per_kc = {}) => {
    // 与 Rust 一致：错误在前、警告在后，同级别按 code 排序
    errors.sort((a, b) => a.code.localeCompare(b.code));
    warnings.sort((a, b) => a.code.localeCompare(b.code));
    const coverage = item_count ? Math.round((coverage_pct / 100) * 1000) / 1000 : 0;
    return {
      packPath: model.dir || "",
      subjectId: model.meta && model.meta.ok ? model.meta.value.id ?? null : null,
      subjectVersion: model.meta && model.meta.ok ? model.meta.value.version ?? null : null,
      errors,
      warnings,
      issues: [...errors, ...warnings],
      stats: {
        kc: kc_count,
        edges: edge_count,
        items: item_count,
        coverage, // 有 kc_ids 的题 / 总题（0-1，保留 3 位）
        coverage_pct: Math.round(coverage_pct * 10) / 10,
        dangling: dangling.slice(),
        per_kc,
      },
    };
  };

  // ---------- subject.json ----------
  if (!model.meta || !model.meta.ok) {
    E("subject.json", "meta-unreadable", (model.meta && model.meta.error) || "subject.json 无法解析");
    return finish();
  }
  const meta = isObj(model.meta.value) ? model.meta.value : {};
  // id
  if (typeof meta.id === "string" && meta.id.trim() !== "") {
    if (!validId(meta.id)) {
      E("subject.json", "bad-id",
        `id「${meta.id}」不合法：需小写字母/数字开头，仅含小写字母、数字、点、连字符、下划线`);
    }
  } else {
    E("subject.json", "missing-id", "缺少必需字段 id");
  }
  // name
  if (typeof meta.name !== "string" || meta.name.trim() === "") {
    E("subject.json", "missing-name", "缺少必需字段 name");
  }
  // version
  if (typeof meta.version === "string") {
    if (!validVersion(meta.version)) {
      E("subject.json", "bad-version", `version「${meta.version}」不是 x.y.z 形式`);
    }
  } else {
    E("subject.json", "missing-version", "缺少必需字段 version");
  }
  // schema
  if (typeof meta.schema === "string") {
    if (meta.schema !== SCHEMA_VERSION) {
      E("subject.json", "bad-schema", `schema「${meta.schema}」不受支持，本工具仅支持 ${SCHEMA_VERSION}`);
    }
  } else {
    E("subject.json", "missing-schema", "缺少必需字段 schema");
  }
  // license
  if (typeof meta.license !== "string" || meta.license.trim() === "") {
    E("subject.json", "missing-license", "缺少必需字段 license");
  }
  // depends（同级 packs/ 目录存在性）——只警告
  const parentDir = model.dir ? path.dirname(model.dir) : "";
  for (const dep of arr(meta.depends)) {
    if (typeof dep !== "string" || !dep) continue;
    if (parentDir && !fs.existsSync(path.join(parentDir, dep, "subject.json"))) {
      W("subject.json", "dep-not-found", `依赖的学科包「${dep}」在同级 packs/ 下不存在`);
    }
  }

  // ---------- GUIDE.md ----------
  if (!model.guide || !model.guide.exists) {
    E("GUIDE.md", "missing-guide", "缺少 GUIDE.md（必需：资料阅读方法，一份文本两种消费）");
  } else {
    const t = str(model.guide.text);
    if (t.trim() === "") {
      E("GUIDE.md", "empty-guide", "GUIDE.md 是空的（必需：资料阅读方法）");
    } else if (Buffer.byteLength(t, "utf8") < 200) {
      W("GUIDE.md", "thin-guide",
        "GUIDE.md 过薄（<200 字节）——至少写清：包教什么、树怎么读、题怎么读、字段词典、示例");
    }
  }

  // ---------- tree/kc.json ----------
  if (!model.kc || !model.kc.ok) {
    E("tree/kc.json", "kc-unreadable", (model.kc && model.kc.error) || "tree/kc.json 无法解析");
    return finish();
  }
  const kcs = arr(model.kc.value);
  const kcIds = [];
  const kcNames = new Map(); // id -> name
  const seenKc = new Set();
  for (const kc of kcs) {
    if (!isObj(kc)) {
      E("tree/kc.json", "kc-bad-entry", "知识点数组元素必须是对象");
      continue;
    }
    const id = typeof kc.id === "string" ? kc.id : null;
    if (id === null) {
      E("tree/kc.json", "kc-missing-id", `存在缺少 id 的知识点（name=${JSON.stringify(kc.name ?? null)}）`);
      continue;
    }
    if (seenKc.has(id)) {
      E("tree/kc.json", "kc-duplicate", `知识点 id 重复: ${id}`);
      continue;
    }
    seenKc.add(id);
    if (typeof kc.name !== "string" || kc.name.trim() === "") {
      E("tree/kc.json", "kc-missing-name", `${id}: 缺少 name`);
    }
    if (arr(kc.toc).length === 0) {
      E("tree/kc.json", "kc-missing-toc", `${id}: toc 为空（章节路径必需，教材改版只改它）`);
    }
    if (typeof kc.difficulty === "number") {
      if (!(kc.difficulty >= 0 && kc.difficulty <= 1)) {
        W("tree/kc.json", "kc-bad-difficulty", `${id}: difficulty=${kc.difficulty} 超出 0–1`);
      }
    }
    if (typeof kc.bloom === "string") {
      if (!BLOOM_LEVELS.includes(kc.bloom)) {
        W("tree/kc.json", "kc-bad-bloom", `${id}: bloom「${kc.bloom}」不在枚举内（${JSON.stringify(BLOOM_LEVELS)}）`);
      }
    }
    kcIds.push(id);
    kcNames.set(id, typeof kc.name === "string" ? kc.name : "");
  }
  const kcCount = kcIds.length;

  // ---------- tree/prereq.json ----------
  const edges = [];
  if (!model.prereq || !model.prereq.ok) {
    E("tree/prereq.json", "prereq-unreadable", (model.prereq && model.prereq.error) || "tree/prereq.json 无法解析");
  } else {
    const seenEdge = new Set();
    for (const p of arr(model.prereq.value)) {
      if (!isObj(p)) {
        E("tree/prereq.json", "edge-bad-entry", "先修边元素必须是对象");
        continue;
      }
      const from = typeof p.from === "string" ? p.from : "";
      const to = typeof p.to === "string" ? p.to : "";
      if (from === "" || to === "") {
        E("tree/prereq.json", "edge-incomplete", "存在缺少 from/to 的先修边");
        continue;
      }
      if (!kcNames.has(from)) {
        E("tree/prereq.json", "edge-bad-from", `先修边 from「${from}」不在 kc.json 中`);
      }
      if (!kcNames.has(to)) {
        E("tree/prereq.json", "edge-bad-to", `先修边 to「${to}」不在 kc.json 中`);
      }
      if (from === to) {
        E("tree/prereq.json", "edge-self", `自环: ${from} → ${to}`);
      }
      const key = `${from}→${to}`;
      if (seenEdge.has(key)) {
        W("tree/prereq.json", "edge-duplicate", `重复先修边: ${from} → ${to}`);
        continue;
      }
      seenEdge.add(key);
      if (typeof p.strength === "string") {
        if (!STRENGTHS.includes(p.strength)) {
          E("tree/prereq.json", "edge-bad-strength", `${from}→${to}: strength「${p.strength}」不在枚举（hard/soft）`);
        }
      } else {
        E("tree/prereq.json", "edge-missing-strength", `${from}→${to}: 缺少 strength（hard/soft）`);
      }
      if (typeof p.reason !== "string" || p.reason.trim() === "") {
        E("tree/prereq.json", "edge-missing-reason", `${from}→${to}: 缺少 reason（必须是一句人话，供复核）`);
      }
      edges.push([from, to]);
    }
  }
  const edgeCount = edges.length;

  // DAG 检查
  const adj = new Map();
  for (const [from, to] of edges) {
    if (!adj.has(from)) adj.set(from, []);
    adj.get(from).push(to);
  }
  const cyc = findCycle(kcIds, adj);
  if (cyc) {
    E("tree/prereq.json", "cycle", `先修关系存在环: ${cyc.join(" → ")}`);
  }

  // ---------- items/ ----------
  let itemCount = 0;
  let itemsWithKc = 0;
  const perKc = new Map();

  if (!model.itemsDirExists) {
    E("items/", "missing-items-dir", "缺少 items/ 目录");
  } else {
    const files = (model.items || []).slice().sort((a, b) => a.filename.localeCompare(b.filename));
    for (const entry of files) {
      const rel = `items/${entry.filename}`;
      if (!entry.ok) {
        E(rel, "item-unreadable", entry.error || "无法解析");
        continue;
      }
      const item = entry.value;
      if (!isObj(item)) {
        E(rel, "item-parse", "题目文件顶层应为对象");
        continue;
      }
      itemCount++;
      const stem = entry.filename.replace(/\.json$/, "");

      // id 与文件名一致
      if (typeof item.id === "string") {
        if (item.id !== stem) {
          E(rel, "item-id-mismatch", `id「${item.id}」与文件名「${stem}」不一致`);
        }
      } else {
        E(rel, "item-missing-id", "缺少 id");
      }

      // 题型
      const ty = typeof item.type === "string" ? item.type : "";
      if (!ITEM_TYPES.includes(ty)) {
        E(rel, "item-bad-type", `type「${ty}」不在枚举（${JSON.stringify(ITEM_TYPES)}）`);
      }

      // kc_ids
      const itemKc = arr(item.kc_ids);
      if (itemKc.length === 0) {
        E(rel, "item-no-kc", "题目未挂载知识点（kc_ids 为空）——诊断链路会因此断裂");
      } else {
        itemsWithKc++;
        for (const k of itemKc) {
          if (!kcNames.has(k)) {
            E(rel, "item-bad-kc", `kc_ids 引用不存在的知识点: ${k}`);
          }
          perKc.set(k, (perKc.get(k) || 0) + 1);
        }
      }

      // 题干
      if (typeof item.stem !== "string" || item.stem.trim() === "") {
        E(rel, "item-missing-stem", "缺少题干 stem");
      }

      // 选项 / 答案
      const options = arr(item.options);
      if (ty === "single_choice" || ty === "multi_choice") {
        if (options.length < 2) {
          E(rel, "item-few-options", `选择题至少 2 个选项，实际 ${options.length}`);
        }
        const keys = [];
        options.forEach((o, idx) => {
          if (isObj(o) && typeof o.key === "string" && o.key.trim() !== "") keys.push(o.key);
          else E(rel, "option-missing-key", `第 ${idx + 1} 个选项缺少 key`);
        });
        const uniq = new Set(keys);
        if (uniq.size !== keys.length) {
          E(rel, "option-duplicate-key", "选项 key 重复");
        }
        const answer = typeof item.answer === "string" ? item.answer : null;
        if (ty === "single_choice") {
          if (answer === null) E(rel, "missing-answer", "缺少 answer");
          else if (!keys.some((k) => k === answer)) {
            E(rel, "answer-not-in-options", `answer「${answer}」不在选项 key（${JSON.stringify(keys)}）中`);
          }
        } else {
          if (!answer) {
            E(rel, "missing-answer", "缺少 answer");
          } else {
            const chars = new Set([...answer]);
            for (const c of chars) {
              if (!keys.some((k) => k.includes(c))) {
                E(rel, "answer-not-in-options", `answer「${answer}」含不在选项中的 key「${c}」`);
              }
            }
          }
        }
        if (typeof item.analysis !== "string" || item.analysis.trim() === "") {
          W(rel, "missing-analysis", "缺少解析 analysis");
        }
      } else if (ty === "fill_blank" || ty === "short_answer" || ty === "judge") {
        const hasText = typeof item.answer_text === "string" && item.answer_text.trim() !== "";
        const hasAns = typeof item.answer === "string" && item.answer.trim() !== "";
        if (!hasText && !hasAns) {
          E(rel, "missing-answer", "缺少 answer/answer_text");
        }
      }

      // difficulty
      if (typeof item.difficulty === "number") {
        if (!(item.difficulty >= 0 && item.difficulty <= 1)) {
          W(rel, "item-bad-difficulty", `difficulty=${item.difficulty} 超出 0–1`);
        }
      }

      // origin（工具中立：只提醒不拦截）
      const st = isObj(item.origin) ? item.origin.source_type : undefined;
      if (typeof st !== "string" || !SOURCE_TYPES.includes(st)) {
        W(rel, "origin-unset", "origin.source_type 未设置（建议标注，便于追溯与分享时声明）");
      }
    }
  }

  // ---------- 统计 ----------
  const coveragePct = itemCount === 0 ? 0 : (itemsWithKc / itemCount) * 100;
  if (itemCount > 0 && coveragePct < 85) {
    W("items/", "low-coverage", `题目→知识点挂载率 ${coveragePct.toFixed(0)}% < 85%（低于此值诊断链路不可靠）`);
  }
  if (itemCount === 0) {
    W("items/", "no-items", "包内没有任何题目");
  }

  // 无题挂载的 KC（粒度信号）
  const dangling = [];
  for (const id of kcIds) {
    if (!perKc.has(id)) dangling.push(id);
  }
  for (const d of dangling) {
    const name = kcNames.get(d) || "";
    W("items/", "dangling-kc", `知识点 ${d}（${name}）没有任何题目挂载——粒度过细或缺题`);
  }

  const perKcObj = {};
  for (const [id, n] of perKc) perKcObj[id] = n;

  return finish(kcCount, edgeCount, itemCount, coveragePct, dangling, perKcObj);
}

/** 从磁盘读取一个学科包并校验。 */
export function validatePack(packDir) {
  const dir = path.resolve(packDir);
  const readFile = (p) => {
    try {
      return fs.readFileSync(p, "utf8");
    } catch {
      return null;
    }
  };
  const parseJson = (txt) => {
    try {
      return { ok: true, value: JSON.parse(String(txt).replace(/^\uFEFF/, "")) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  };

  const metaText = readFile(path.join(dir, "subject.json"));
  let meta;
  if (metaText == null) {
    meta = { ok: false, error: "subject.json 不存在或无法读取" };
  } else {
    const pj = parseJson(metaText);
    meta = pj.ok ? { ok: true, value: pj.value } : { ok: false, error: "JSON 解析失败: " + pj.error };
  }

  const guideText = readFile(path.join(dir, "GUIDE.md"));
  const guide = guideText == null ? { exists: false, text: "" } : { exists: true, text: guideText };

  const kcText = readFile(path.join(dir, "tree", "kc.json"));
  let kc;
  if (kcText == null) {
    kc = { ok: false, error: "无法读取 tree/kc.json" };
  } else {
    const pj = parseJson(kcText);
    kc = pj.ok
      ? (Array.isArray(pj.value) ? { ok: true, value: pj.value } : { ok: false, error: "tree/kc.json 顶层应为数组" })
      : { ok: false, error: "JSON 解析失败: " + pj.error };
  }

  const prText = readFile(path.join(dir, "tree", "prereq.json"));
  let prereq;
  if (prText == null) {
    prereq = { ok: false, error: "无法读取 tree/prereq.json" };
  } else {
    const pj = parseJson(prText);
    prereq = pj.ok
      ? (Array.isArray(pj.value) ? { ok: true, value: pj.value } : { ok: false, error: "tree/prereq.json 顶层应为数组" })
      : { ok: false, error: "JSON 解析失败: " + pj.error };
  }

  const itemsDir = path.join(dir, "items");
  let itemsDirExists = false;
  try {
    itemsDirExists = fs.statSync(itemsDir).isDirectory();
  } catch {
    itemsDirExists = false;
  }
  const items = [];
  if (itemsDirExists) {
    const files = fs.readdirSync(itemsDir).filter((x) => x.endsWith(".json")).sort();
    for (const f of files) {
      const t = readFile(path.join(itemsDir, f));
      if (t == null) {
        items.push({ filename: f, ok: false, error: "无法读取" });
        continue;
      }
      const pj = parseJson(t);
      items.push(pj.ok ? { filename: f, ok: true, value: pj.value } : { filename: f, ok: false, error: "JSON 解析失败: " + pj.error });
    }
  }

  return validateModel({ dir, meta, guide, kc, prereq, items, itemsDirExists });
}

export function formatReport(report) {
  const s = report.stats;
  const L = [];
  L.push(`学科包：${report.packPath}`);
  L.push(`  kc=${s.kc}  先修边=${s.edges}  题=${s.items}  覆盖率=${s.coverage_pct}%  悬空知识点=${s.dangling.length}`);
  L.push(`  错误 ${report.errors.length} 条，警告 ${report.warnings.length} 条`);
  if (report.errors.length) {
    L.push("", "错误：");
    for (const e of report.errors) L.push(`  [ERROR] ${e.file} (${e.code}): ${e.msg}`);
  }
  if (report.warnings.length) {
    L.push("", "警告：");
    for (const w of report.warnings) L.push(`  [WARN] ${w.file} (${w.code}): ${w.msg}`);
  }
  if (!report.errors.length && !report.warnings.length) L.push("", "✅ 完全通过：无错误、无警告。");
  else if (!report.errors.length) L.push("", "✅ 通过：无错误（有警告）。");
  else L.push("", "❌ 未通过：存在错误。");
  return L.join("\n");
}

function main(argv) {
  const jsonOut = argv.includes("--json");
  const dir = argv.find((a) => !a.startsWith("--"));
  if (!dir) {
    console.error("用法: node validate.mjs <包目录> [--json]");
    process.exit(2);
  }
  let report;
  try {
    report = validatePack(dir);
  } catch (e) {
    console.error("校验时发生异常:", e && e.stack ? e.stack : e);
    process.exit(2);
  }
  if (jsonOut) {
    console.log(JSON.stringify({ errors: report.errors, warnings: report.warnings, stats: report.stats }, null, 2));
  } else {
    console.log(formatReport(report));
  }
  if (report.errors.length) process.exitCode = 1;
}

// 仅当作为脚本直接运行时执行 CLI（被 import 时不执行）
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
