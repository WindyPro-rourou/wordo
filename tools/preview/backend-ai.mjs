// 直接在后端层调用 ask_model（不经过浏览器），测完整链路耗时与校验结果
import path from "node:path";
import url from "node:url";
const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const b = await import("./backend.mjs");

b.state.packsDir = "F:/去中心化分布式跨平台自进化ai学习系统/packs";
b.state.domain = path.join(HERE, "domain");
b.state.configPath = path.join(HERE, ".config.json");

const req = {
  task: "explain",
  packPath: "F:/去中心化分布式跨平台自进化ai学习系统/packs/english.high",
  domain: "",
  packsDir: b.state.packsDir,
  payload: { kc_id: "kc_eng_0002", kc_name: "一般过去时", learner: {} },
};
const t0 = Date.now();
try {
  const r = await b.invoke("ask_model", { req });
  console.log("elapsed", ((Date.now() - t0) / 1000).toFixed(1) + "s");
  console.log("ok:", r.ok, "attempts:", r.attempts, "model:", r.model);
  console.log("issues:", JSON.stringify(r.issues));
  console.log("dataKeys:", Object.keys(r.data || {}));
  console.log("explanation_md len:", (r.data?.explanation_md || "").length);
  console.log("followup:", JSON.stringify(r.data?.followup_question));
  console.log("raw head:", (r.raw || "").slice(0, 200).replace(/\n/g, " "));
} catch (e) {
  console.log("THROW after", ((Date.now() - t0) / 1000).toFixed(1) + "s:", e.message);
}
