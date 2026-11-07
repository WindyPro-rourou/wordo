import fs from "node:fs";
const P="apps/desktop/src/app.js"; let t=fs.readFileSync(P,"utf8");
t=t.replace(`res = await invoke("record_answer", { domain: getDomain(), packsDir: packsDirValue(), pack: packId, itemId: card.dataset.item, answered: btn.dataset.quizOpt, source: "chat" });`,
`res = await invoke("record_answer", { domain: getDomain(), packsDir: packsDirValue(), pack: packId, itemId: card.dataset.item, answered: btn.dataset.quizOpt, source: "chat", errorType: err || undefined, confidence: conf || undefined });`);
fs.writeFileSync(P,t,"utf8"); console.log("✅ 前端 record_answer 传参");
