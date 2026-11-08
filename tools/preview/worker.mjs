import path from "node:path";
import url from "node:url";
const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const b = await import("./backend.mjs");
const node = process.argv[2], n = Number(process.argv[3] || 100);
b.state.packsDir = path.resolve(HERE, "../../packs");
b.state.domain = path.join(HERE, "domain-conc");
b.state.configPath = path.join(HERE, ".config.json");
b.state.nodeOverride = node;
for (let i = 0; i < n; i++) {
  await b.invoke("record_judged", { domain: "", packsDir: b.state.packsDir, pack: "english.high", kcId: "kc_eng_0002", syntheticId: `${node}-${i}`, answered: i % 3 === 0 ? "B" : "A", ok: i % 3 === 0, source: "stress", confidence: i % 5 === 0 ? "guess" : "certain" });
}
console.log("worker", node, "wrote", n);
