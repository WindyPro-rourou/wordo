import fs from "node:fs";
import path from "node:path";
import url from "node:url";
const HERE=path.dirname(url.fileURLToPath(import.meta.url));
const b=await import("./backend.mjs");
b.state.packsDir="F:/去中心化分布式跨平台自进化ai学习系统/packs";
b.state.domain=path.join(HERE,"domain-rules");
b.state.configPath=path.join(HERE,".config.json");
const R={};
fs.rmSync(b.state.domain,{recursive:true,force:true});
const rec=(kc,ok,conf,et)=>b.invoke("record_judged",{domain:"",packsDir:b.state.packsDir,pack:"english.high",kcId:kc,syntheticId:"t"+Date.now()+Math.random(),answered:"B",ok,source:"t",confidence:conf,errorType:et});
// 1) 蒙对：不该积累连对/长间隔
let r=await rec("kc_eng_0002",true,"guess");
R.guessOK={streak:r.kc.streak, intervalHours:Math.round((Date.parse(r.kc.due_ts)-Date.now())/3600000), mastery:r.kc.mastery};
// 2) 确定对 ×2 → 连对 1、24h
r=await rec("kc_eng_0004",true,"certain");
R.certainOK={streak:r.kc.streak, intervalHours:Math.round((Date.parse(r.kc.due_ts)-Date.now())/3600000), mastery:r.kc.mastery};
// 3) 看错题：不该降掌握度（先确定对一次，再一次 misread 错）
await rec("kc_hs_math_0003",true,"certain");
r=await rec("kc_hs_math_0003",false,"certain","misread");
R.misread={wrong:r.kc.wrong, mastery:r.kc.mastery};
// 4) 已掌握 → 低频抽查 ≥336h
for(let i=0;i<2;i++) r=await rec("kc_eng_0005",true,"certain");
R.mastered={mastered:r.kc.mastered, intervalHours:Math.round((Date.parse(r.kc.due_ts)-Date.now())/3600000)};
console.log(JSON.stringify(R,null,2));
