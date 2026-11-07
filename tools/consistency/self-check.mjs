// 自一致性基线：同一模型、同一输入、重复 N 次 → 字段级一致率（噪声地板）
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const H = process.env.DSH_HOME;
const KEY = (fs.readFileSync(path.join(H, ".env"), "utf8").match(/^MAGPIE_GATEWAY_KEY=(.*)$/m) || [])[1].trim();
const BASE = "http://127.0.0.1:3425/v1";
const MODEL = "auto/deepseek-v4.1-flash";
const REPEAT = 3;
const PACKS = path.join(REPO, "packs");
const TPL = fs.readFileSync(path.join(REPO, "specs/prompt-pack/1/PROMPT.md"), "utf8");

function buildPrompt(task, packId, payload) {
  const dir = path.join(PACKS, packId);
  const kcs = JSON.parse(fs.readFileSync(path.join(dir, "tree/kc.json"), "utf8"));
  const items = fs.readdirSync(path.join(dir, "items")).filter((f) => f.endsWith(".json")).sort().map((f) => { const i = JSON.parse(fs.readFileSync(path.join(dir, "items", f), "utf8")); return { id: i.id, kc_ids: i.kc_ids, stem: i.stem, answer: i.answer }; });
  const guide = fs.existsSync(path.join(dir, "GUIDE.md")) ? fs.readFileSync(path.join(dir, "GUIDE.md"), "utf8") : "";
  let mat = "";
  const matDir = path.join(dir, "material");
  if (fs.existsSync(matDir)) for (const f of fs.readdirSync(matDir).filter((x) => x.endsWith(".md")).sort()) {
    const t = fs.readFileSync(path.join(matDir, f), "utf8");
    if ((t.match(/^kc_id:\s*(\S+)/m) || [])[1] === payload.kc_id) mat += "\n\n### 预置讲解素材\n" + t;
  }
  const injected = `${guide}\n\n### 知识点表\n\`\`\`json\n${JSON.stringify(kcs, null, 2)}\n\`\`\`\n### 题目索引\n\`\`\`json\n${JSON.stringify(items, null, 2)}\n\`\`\`${mat}\n\n### 学习者状态\n（空）`;
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
async function once(task, packId, payload) {
  const { system, user } = buildPrompt(task, packId, payload);
  const r = await fetch(`${BASE}/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` }, body: JSON.stringify({ model: MODEL, messages: [{ role: "system", content: system }, { role: "user", content: user }], temperature: 0, top_p: 1, max_tokens: 2500, stream: false }), signal: AbortSignal.timeout(240000) });
  const j = JSON.parse(await r.text());
  return extractJson(j.choices?.[0]?.message?.content || "");
}

const CASES = [
  { id: "explain-en-past", task: "explain", pack: "english.high", payload: { kc_id: "kc_eng_0002", kc_name: "一般过去时" } },
  { id: "classify-1", task: "classify-error", pack: "english.high", payload: { item_id: "it_eng_0001", stem: "He ___ to Beijing last year.", options: [{ key: "A", text: "goes" }, { key: "B", text: "went" }, { key: "C", text: "has gone" }, { key: "D", text: "will go" }], correct: "B", answered: "A", kc_id: "kc_eng_0002" } },
];

const out = { model: MODEL, repeat: REPEAT, at: new Date().toISOString(), cases: [] };
for (const c of CASES) {
  const runs = [];
  for (let i = 0; i < REPEAT; i++) runs.push(await once(c.task, c.pack, c.payload));
  const objs = runs.filter(Boolean).map((d) => c.task === "explain" ? { kc_id: d.kc_id, options: (d.followup_question?.options || []).length, answer: d.followup_question?.answer } : { item_id: d.item_id, error_type: d.error_type });
  const fields = objs.length ? Object.keys(objs[0]) : [];
  const per = {};
  for (const f of fields) per[f] = new Set(objs.map((o) => JSON.stringify(o[f]))).size === 1;
  const agree = Object.values(per).filter(Boolean).length;
  out.cases.push({ case: c.id, runs: objs.length, fields: fields.length, agree, rate: fields.length ? Math.round((agree / fields.length) * 1000) / 10 : null, per, samples: objs });
  console.log(`${c.id}: ${agree}/${fields.length} 一致`, JSON.stringify(per));
}
const t = out.cases.reduce((s, x) => s + x.fields, 0), a = out.cases.reduce((s, x) => s + x.agree, 0);
out.overallSelf = t ? Math.round((a / t) * 1000) / 10 : null;
const dir = path.join(REPO, "docs/评审");
fs.writeFileSync(path.join(dir, "自一致性基线.json"), JSON.stringify(out, null, 2));
console.log("self-consistency:", out.overallSelf + "%");
