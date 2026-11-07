import fs from "node:fs";
const R="tools/preview/review.mjs"; let r=fs.readFileSync(R,"utf8");
r=r.replace('const MODELS = ["auto/glm-5.3-flash", "auto/kimi-k3.1-pro"].slice(0, Number(arg("n", 2)));',
'const MODELS = arg("models", "auto/glm-5.3-flash,auto/kimi-k3.1-pro").split(",").map((s) => s.trim()).filter(Boolean).slice(0, Number(arg("n", 2)));');
fs.writeFileSync(R,r,"utf8"); console.log("✅ review 支持 --models");
