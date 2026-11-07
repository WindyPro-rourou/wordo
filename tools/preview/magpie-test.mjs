// 用 magpie 网关测试路由组（读 DSH_HOME/.env 的 MAGPIE_GATEWAY_KEY，不打印明文）
import fs from "node:fs";
import path from "node:path";

const H = process.env.DSH_HOME;
const envText = fs.readFileSync(path.join(H, ".env"), "utf8");
const key = (envText.match(/^MAGPIE_GATEWAY_KEY=(.*)$/m) || [])[1]?.trim();
const BASE = "http://127.0.0.1:3425/v1";
console.log("gateway:", BASE, "keyLen:", key?.length);

async function models() {
  const r = await fetch(`${BASE}/models`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  const ids = (j.data || []).map((m) => m.id);
  console.log("models:", r.status, ids.length);
  console.log(ids.filter((x) => /deepseek|auto\//i.test(x)).slice(0, 20).join("\n"));
}

async function chat(model, maxTokens = 64) {
  const s = Date.now();
  const r = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages: [{ role: "user", content: "用一句话解释：为什么天空是蓝色的？" }], max_tokens: maxTokens, stream: false }),
    signal: AbortSignal.timeout(120000),
  });
  const txt = await r.text();
  console.log(`\nmodel=${model} status=${r.status} ${Date.now() - s}ms`);
  if (!r.ok) return console.log("  err:", txt.slice(0, 300));
  const j = JSON.parse(txt);
  console.log("  reply:", (j.choices?.[0]?.message?.content || "").trim().slice(0, 160).replace(/\n/g, " "));
  console.log("  usage:", JSON.stringify(j.usage || {}));
}
try { await models(); } catch (e) { console.log("models failed:", e.message); }
for (const m of ["auto/deepseek-v4.1-flash", "deepseek-v4.1-flash"]) {
  try { await chat(m); } catch (e) { console.log(`model=${m} FAILED: ${e.message}`); }
}
