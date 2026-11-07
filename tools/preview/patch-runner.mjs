import fs from "node:fs";
// 1) 一致性测试也套用产品同款归一化，测的就是真实行为
const R="tools/consistency/run.mjs";
let r=fs.readFileSync(R,"utf8");
if(!r.includes("normalizeExplain")){
  r=r.replace(`import url from "node:url";`, `import url from "node:url";
import { normalizeExplain, normalizeClassify } from "../preview/backend.mjs";`);
  r=r.replace(`    const data = extractJson(j.choices?.[0]?.message?.content || "");`,
`    let data = extractJson(j.choices?.[0]?.message?.content || "");
    if (data && task === "explain") data = normalizeExplain(path.join(PACKS, packId), payload.kc_id || data.kc_id, data);
    if (data && task === "classify-error") data = normalizeClassify(data);`);
  fs.writeFileSync(R,r,"utf8"); console.log("✅ runner 套用归一化");
}
