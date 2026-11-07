import fs from "node:fs";
// review.mjs 用可路由的 auto 组
let R="tools/preview/review.mjs"; let r=fs.readFileSync(R,"utf8");
r=r.replace('const MODELS = ["z-ai/glm-5.3-flash", "moonshotai/kimi-k2.6"]','const MODELS = ["auto/glm-5.3-flash", "auto/kimi-k3.1-pro"]');
fs.writeFileSync(R,r,"utf8");
// consistency runner 回到 auto 组 + 注明多次取样
let C="tools/consistency/run.mjs"; let c=fs.readFileSync(C,"utf8");
c=c.replace('const MODELS = arg("models", "deepseek-ai/deepseek-v4.1-flash,z-ai/glm-5.3-flash")','const MODELS = arg("models", "auto/deepseek-v4.1-flash,auto/glm-5.3-flash")');
fs.writeFileSync(C,c,"utf8");
console.log("✅ 改回 auto 组");
