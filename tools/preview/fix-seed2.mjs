import fs from "node:fs";
const P="tools/preview/seed.mjs";
let t=fs.readFileSync(P,"utf8");
t=t.replace("evs.forEach((e) => e.kc_ids.forEach((k) => (kcCount[k] = (kcCount[k] || 0) + 1)));","evs.forEach((e) => (e.kc_ids || []).forEach((k) => (kcCount[k] = (kcCount[k] || 0) + 1)));");
fs.writeFileSync(P,t,"utf8"); console.log("✅ seed 容错");
