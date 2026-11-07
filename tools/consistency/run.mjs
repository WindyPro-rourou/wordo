// 跨模型一致性测试：N 模型 × M 用例 → 格式合规率 + 客观字段一致率
// 用法: node run.mjs [--models auto/deepseek-v4.1-flash,auto/glm-5.3-flash]
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { normalizeExplain, normalizeClassify } from "../preview/backend.mjs";

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const H = process.env.DSH_HOME;
const KEY = (fs.readFileSync(path.join(H, ".env"), "utf8").match(/^MAGPIE_GATEWAY_KEY=(.*)$/m) || [])[1].trim();
const BASE = "http://127.0.0.1:3425/v1";
const PACKS = path.join(REPO, "packs");

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const MODELS = arg("models", "auto/deepseek-v4.1-flash,auto/glm-5.3-flash").split(",").map((s) => s.trim()).filter(Boolean);

/* ---------- 极简 JSON Schema 校验（够用即可） ---------- */
function validate(schema, v, p = "$") {
  const errs = [];
  const typeOf = (x) => (Array.isArray(x) ? "array" : x === null ? "null" : typeof x);
  if (schema.const !== undefined && v !== schema.const) errs.push(`${p} 应为 ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(v)) errs.push(`${p} 不在枚举内`);
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const t = typeOf(v);
    if (!types.includes(t)) errs.push(`${p} 类型应为 ${types.join("|")}，实际 ${t}`);
  }
  if (typeof v === "string") {
    if (schema.minLength && [...v].length < schema.minLength) errs.push(`${p} 太短`);
    if (schema.maxLength && [...v].length > schema.maxLength) errs.push(`${p} 太长`);
    if (schema.pattern && !new RegExp(schema.pattern).test(v)) errs.push(`${p} 不匹配 ${schema.pattern}`);
  }
  if (typeof v === "number") {
    if (schema.minimum !== undefined && v < schema.minimum) errs.push(`${p} < minimum`);
    if (schema.maximum !== undefined && v > schema.maximum) errs.push(`${p} > maximum`);
  }
  if (Array.isArray(v)) {
    if (schema.minItems && v.length < schema.minItems) errs.push(`${p} 少于 ${schema.minItems} 项`);
    if (schema.maxItems && v.length > schema.maxItems) errs.push(`${p} 多于 ${schema.maxItems} 项`);
    if (schema.items) v.forEach((it, i) => errs.push(...validate(schema.items, it, `${p}[${i}]`)));
  }
  if (typeOf(v) === "object") {
    for (const k of schema.required || []) if (!(k in v)) errs.push(`${p}.${k} 缺失`);
    for (const [k, sub] of Object.entries(schema.properties || {})) {
      if (k in v) errs.push(...validate(sub, v[k], `${p}.${k}`));
    }
  }
  return errs;
}

/* ---------- 用例（覆盖三种任务） ---------- */
const CASES = [
  { id: "explain-en-past", task: "explain", pack: "english.high", payload: { kc_id: "kc_eng_0002", kc_name: "一般过去时", learner: {} } },
  { id: "explain-math-mono", task: "explain", pack: "math.high", payload: { kc_id: "kc_hs_math_0003", kc_name: "函数的单调性", learner: {} } },
  { id: "explain-en-clause", task: "explain", pack: "english.high", payload: { kc_id: "kc_eng_0004", kc_name: "定语从句", learner: {} } },
  { id: "classify-1", task: "classify-error", pack: "english.high", payload: { item_id: "it_eng_0001", stem: "He ___ to Beijing last year.", options: [{ key: "A", text: "goes" }, { key: "B", text: "went" }, { key: "C", text: "has gone" }, { key: "D", text: "will go" }], correct: "B", answered: "A", kc_id: "kc_eng_0002" } },
  { id: "review-1", task: "review-wrong", pack: "english.high", payload: { from_node: "nodeX", date: "2026-11-07", items: [{ item_id: "it_eng_0001", kc_id: "kc_eng_0002", kc_name: "一般过去时", stem: "He ___ to Beijing last year.", options: [], answered: "A", correct: "B", analysis: "" }] } },
];

const SCHEMAS = {
  explain: JSON.parse(fs.readFileSync(path.join(REPO, "specs/output-schema/1/explain.schema.json"), "utf8")),
  "classify-error": JSON.parse(fs.readFileSync(path.join(REPO, "specs/output-schema/1/classify-error.schema.json"), "utf8")),
  "review-wrong": JSON.parse(fs.readFileSync(path.join(REPO, "specs/output-schema/1/review-wrong.schema.json"), "utf8")),
};

/* ---------- 提示词（走与产品同一份 PROMPT.md） ---------- */
const TPL = fs.readFileSync(path.join(REPO, "specs/prompt-pack/1/PROMPT.md"), "utf8");
function buildPrompt(task, packId, payload) {
  const packDir = path.join(PACKS, packId);
  const kcs = JSON.parse(fs.readFileSync(path.join(packDir, "tree/kc.json"), "utf8"));
  const items = fs.readdirSync(path.join(packDir, "items")).filter((f) => f.endsWith(".json")).sort()
    .map((f) => { const it = JSON.parse(fs.readFileSync(path.join(packDir, "items", f), "utf8")); return { id: it.id, kc_ids: it.kc_ids, stem: it.stem, answer: it.answer }; });
  const guide = fs.existsSync(path.join(packDir, "GUIDE.md")) ? fs.readFileSync(path.join(packDir, "GUIDE.md"), "utf8") : "";
  let mat = "";
  const kcIds = [payload.kc_id, ...(payload.items || []).map((i) => i.kc_id)].filter(Boolean);
  const matDir = path.join(packDir, "material");
  if (fs.existsSync(matDir)) for (const f of fs.readdirSync(matDir).filter((x) => x.endsWith(".md")).sort()) {
    const t = fs.readFileSync(path.join(matDir, f), "utf8");
    const kc = (t.match(/^kc_id:\s*(\S+)/m) || [])[1];
    if (kc && kcIds.includes(kc)) mat += `\n\n### 预置讲解素材（必须以它为准）\n${t}`;
  }
  const injected = `${guide}\n\n### 知识点表（kc.json）\n\`\`\`json\n${JSON.stringify(kcs, null, 2)}\n\`\`\`\n### 题目索引\n\`\`\`json\n${JSON.stringify(items, null, 2)}\n\`\`\`${mat}\n\n### 学习者状态\n（本轮为空）`;
  return { system: TPL.replace("{{READING_GUIDE}}", injected), user: JSON.stringify({ task, payload }) };
}

function extractJson(s) {
  const t = String(s || "").trim();
  try { return JSON.parse(t); } catch {}
  const f = t.replace(/^```(?:json)?/, "").replace(/```$/, "").trim();
  try { return JSON.parse(f); } catch {}
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch {} }
  return null;
}

async function callModel(model, task, packId, payload) {
  const { system, user } = buildPrompt(task, packId, payload);
  const t0 = Date.now();
  try {
    const r = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
      // 一致性测试固定 temperature=0、top_p=1
      body: JSON.stringify({ model, messages: [{ role: "system", content: system }, { role: "user", content: user }], temperature: 0, top_p: 1, max_tokens: 3000, stream: false }),
      signal: AbortSignal.timeout(240000),
    });
    const txt = await r.text();
    if (!r.ok) return { model, ok: false, err: `HTTP ${r.status}`, ms: Date.now() - t0 };
    const j = JSON.parse(txt);
    let data = extractJson(j.choices?.[0]?.message?.content || "");
    if (data && task === "explain") data = normalizeExplain(path.join(PACKS, packId), payload.kc_id || data.kc_id, data);
    if (data && task === "classify-error") data = normalizeClassify(data);
    return { model, ok: !!data, data, ms: Date.now() - t0 };
  } catch (e) {
    return { model, ok: false, err: String(e.message || e), ms: Date.now() - t0 };
  }
}

/* ---------- 客观字段抽取（只比这些；自由文本不进比较） ---------- */
function objective(task, d) {
  if (!d) return null;
  if (task === "explain") return { kc_id: d.kc_id, answer: String(d.followup_question?.answer || "").toUpperCase(), options: (d.followup_question?.options || []).length, tool_hints: (d.tool_hints || []).sort().join("|"), inferred: d.inferred };
  if (task === "classify-error") return { item_id: d.item_id, error_type: d.error_type, suggested_action: d.suggested_action, root_cause_kc_id: d.root_cause_kc_id ?? null, inferred: d.inferred };
  if (task === "review-wrong") return { item_ids: (d.reviews || []).map((r) => r.item_id).sort().join(","), count: (d.reviews || []).length, inferred: d.inferred };
  return null;
}

const results = [];
for (const c of CASES) {
  const calls = await Promise.allSettled(MODELS.map((m) => callModel(m, c.task, c.pack, c.payload)));
  const rows = calls.map((r, i) => {
    const v = r.status === "fulfilled" ? r.value : { model: MODELS[i], ok: false, err: String(r.reason) };
    const schemaErrs = v.ok ? validate(SCHEMAS[c.task], v.data) : [];
    return { model: v.model, ok: v.ok, ms: v.ms, err: v.err, schemaErrs, obj: v.ok ? objective(c.task, v.data) : null };
  });
  results.push({ case: c.id, task: c.task, rows });
  console.log(`[${c.id}] ` + rows.map((r) => `${r.model.split("/").pop()}=${r.ok ? (r.schemaErrs.length ? "格式X" : "合规") : "失败"}`).join("  "));
}

/* ---------- 汇总：口径拆分（结构一致 vs 主观判断一致） ---------- */
const SUBJECTIVE_FIELDS = new Set(["error_type", "inferred", "root_cause_kc_id", "confidence", "suggested_action", "tool_hints"]); // 主观/派生字段：不计入结构一致率
const perModel = {};
for (const m of MODELS) perModel[m] = { calls: 0, compliant: 0, failed: 0 };
const perCase = [];
for (const r of results) {
  for (const row of r.rows) {
    const pm = perModel[row.model] || (perModel[row.model] = { calls: 0, compliant: 0, failed: 0 });
    pm.calls++;
    if (!row.ok) pm.failed++;
    else if (!row.schemaErrs.length) pm.compliant++;
  }
  const vals = r.rows.filter((x) => x.ok && x.obj).map((x) => x.obj);
  let agree = 0, total = 0, sAgree = 0, sTotal = 0, diffs = [];
  if (vals.length >= 2) {
    for (const k of Object.keys(vals[0])) {
      total++;
      const same = new Set(vals.map((v) => JSON.stringify(v[k] ?? null))).size === 1;
      if (same) agree++; else diffs.push({ field: k, values: vals.map((v) => v[k]), subjective: SUBJECTIVE_FIELDS.has(k) });
      if (!SUBJECTIVE_FIELDS.has(k)) { sTotal++; if (same) sAgree++; }
    }
  }
  // 判断类一致（error_type）：模型对「错因」的判断是否一致（这是教学信号，不是格式问题）
  let judgment = null;
  if (r.task === "classify-error" && vals.length >= 2) {
    const ets = new Set(vals.map((v) => v.error_type));
    judgment = { agree: ets.size === 1, values: [...ets] };
  }
  perCase.push({ case: r.case, task: r.task, models: vals.length, judgment, fields: total, agree, rate: total ? Math.round((agree / total) * 1000) / 10 : null, structural: sTotal ? Math.round((sAgree / sTotal) * 1000) / 10 : null, sAgree, sTotal, diffs });
}

const summary = {
  at: new Date().toISOString(),
  models: MODELS,
  format: Object.fromEntries(Object.entries(perModel).map(([m, v]) => [m, `${v.compliant}/${v.calls}` + (v.failed ? ` (失败 ${v.failed})` : "")])),
  perCase,
  overallAgreement: (() => { const t = perCase.reduce((s, x) => s + x.fields, 0), a = perCase.reduce((s, x) => s + x.agree, 0); return t ? Math.round((a / t) * 1000) / 10 : null; })(),
  overallStructural: (() => { const t = perCase.reduce((s, x) => s + x.sTotal, 0), a = perCase.reduce((s, x) => s + x.sAgree, 0); return t ? Math.round((a / t) * 1000) / 10 : null; })(),
};

const outDir = path.join(REPO, "docs/评审");
fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().slice(0, 10);
fs.writeFileSync(path.join(outDir, `一致性报告-${stamp}.json`), JSON.stringify({ summary, results }, null, 2));

const md = [`# 跨模型一致性报告 ${stamp}`, "", `模型：${MODELS.join(" · ")}　（temperature=0, top_p=1）`, "", "## 格式合规率", "",
  "| 模型 | 合规/调用 |", "|---|---|", ...Object.entries(summary.format).map(([m, v]) => `| ${m} | ${v} |`), "",
  "## 客观字段一致率", "", "| 用例 | 任务 | 参与模型 | 结构一致 | 结构一致率 | 全字段一致率 |", "|---|---|---|---|---|---|",
  ...perCase.map((x) => `| ${x.case} | ${x.task} | ${x.models} | ${x.sAgree}/${x.sTotal} | ${x.structural ?? "-"}% | ${x.rate ?? "-"}% |`), "",
  `**结构一致率（剔除主观判断字段）：${summary.overallStructural ?? "-"}%**　｜　全字段一致率：${summary.overallAgreement ?? "-"}%`, "", "## 不一致明细", ""];
for (const x of perCase) if (x.diffs.length) { md.push(`### ${x.case}`); for (const d of x.diffs) md.push(`- \`${d.field}\`：${d.values.map((v) => JSON.stringify(v)).join(" / ")}`); md.push(""); }
fs.writeFileSync(path.join(outDir, `一致性报告-${stamp}.md`), md.join("\n"), "utf8");
console.log(JSON.stringify(summary, null, 2));
