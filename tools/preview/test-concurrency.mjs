import fs from "node:fs";
import path from "node:path";
import url from "node:url";
const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const b = await import("./backend.mjs");
b.state.packsDir = path.resolve(HERE, "../../packs");
b.state.domain = path.join(HERE, "domain-conc");
b.state.configPath = path.join(HERE, ".config.json");

const { spawn } = await import("node:child_process");
function run(node, n) {
  return new Promise((res, rej) => {
    const p = spawn(process.execPath, ["worker.mjs", node, String(n)], { cwd: HERE, stdio: ["ignore","pipe","pipe"] });
    let out = ""; p.stdout.on("data", d => out += d); p.stderr.on("data", d => out += d);
    p.on("exit", c => c === 0 ? res(out) : rej(new Error(out)));
  });
}
fs.rmSync(b.state.domain, { recursive: true, force: true });
const t0 = Date.now();
await Promise.all([run("nodeA", 120), run("nodeB", 120)]);   // 两个「设备」并发写
const elapsed = Date.now() - t0;

b.state.nodeOverride = "";
const v = await b.invoke("verify_ledger", { domain: "", packsDir: b.state.packsDir });
const st1 = await b.invoke("learn_due", { domain: "", packsDir: b.state.packsDir });
const st2 = await b.invoke("learn_due", { domain: "", packsDir: b.state.packsDir });
const evCount = (() => { const d = path.join(b.state.domain, "ledger"); let n = 0; for (const f of fs.existsSync(d)?fs.readdirSync(d):[]) n += fs.readFileSync(path.join(d,f),"utf8").split(/\r?\n/).filter(Boolean).length; return n; })();
console.log(JSON.stringify({
  elapsedMs: elapsed,
  eventsOnDisk: evCount,
  verify: v,
  deriveStable: JSON.stringify(st1) === JSON.stringify(st2),
  weak: st1.weak.length,
  todayAnswers: st1.today_answers,
  masterySample: (st1.weak[0]||{}).mastery,
}, null, 2));
