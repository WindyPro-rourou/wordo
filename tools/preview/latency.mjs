// 直接测 NVIDIA 端点延迟与可用性（不经过 UI）
import fs from "node:fs";
const cfg = JSON.parse(fs.readFileSync(".config.json", "utf8").replace(/^\uFEFF/, ""));
const p = cfg.providers[cfg.active || 0];
const t0 = Date.now();
async function chat(model, maxTokens) {
  const s = Date.now();
  const r = await fetch(`${p.base_url.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${p.api_key}` },
    body: JSON.stringify({ model, messages: [{ role: "user", content: "用一句话解释：为什么天空是蓝色的？" }], temperature: 0.3, max_tokens: maxTokens, stream: false }),
    signal: AbortSignal.timeout(120000),
  });
  const txt = await r.text();
  console.log(`model=${model} max=${maxTokens} status=${r.status} ${Date.now() - s}ms`);
  if (!r.ok) console.log("  body:", txt.slice(0, 300));
  else {
    const j = JSON.parse(txt);
    console.log("  reply:", (j.choices?.[0]?.message?.content || "").slice(0, 120).replace(/\n/g, " "));
    console.log("  usage:", JSON.stringify(j.usage || {}));
  }
}
for (const m of ["deepseek-ai/deepseek-v4.1-flash", "nvidia/nemotron-3.5-lightning-30b-a3b", "z-ai/glm-5.3-flash"]) {
  try { await chat(m, 64); } catch (e) { console.log(`model=${m} FAILED: ${e.message}`); }
}
console.log("total", Date.now() - t0, "ms");
