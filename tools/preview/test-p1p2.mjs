// 验证 P1（判分即落账 / explain 留痕）与 P2（会话事件化、删除墓碑、多节点合并）
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const b = await import("./backend.mjs");

b.state.packsDir = "F:/去中心化分布式跨平台自进化ai学习系统/packs";
b.state.domain = path.join(HERE, "domain-test");
b.state.configPath = path.join(HERE, ".config.json");
fs.rmSync(b.state.domain, { recursive: true, force: true });

const R = {};

// ── P1: 讲解检测题落账 ──
const r1 = await b.invoke("record_judged", {
  domain: "", packsDir: b.state.packsDir, pack: "english.high",
  kcId: "kc_eng_0002", syntheticId: "english.high::kc_eng_0002::followup",
  answered: "A", ok: false, source: "chat-followup", errorType: "concept_confused",
});
R.judged = { ok: r1.ok, eventId: !!r1.eventId, kc: r1.kc && r1.kc.kc_id, wrong: r1.kc && r1.kc.wrong, mastery: r1.kc && r1.kc.mastery };
// 再答对一次，看掌握度是否推进
const r2 = await b.invoke("record_judged", {
  domain: "", packsDir: b.state.packsDir, pack: "english.high",
  kcId: "kc_eng_0002", syntheticId: "english.high::kc_eng_0002::followup",
  answered: "B", ok: true, source: "chat-followup",
});
R.judged2 = { correct: r2.kc && r2.kc.correct, mastery: r2.kc && r2.kc.mastery, streak: r2.kc && r2.kc.streak };

const ex = await b.invoke("record_explain", { domain: "", pack: "english.high", kcId: "kc_eng_0002", model: "auto/x", source: "ai" });
R.explainEvent = { ok: ex.ok, eventId: !!ex.eventId };

// user.md 是否体现（讲解/薄弱）
const st = await b.invoke("learn_state", { domain: "", packsDir: b.state.packsDir });
R.userMdHasWeak = /薄弱知识点（1）/.test(st.userMd);
R.userMdHasTimeline = /一般过去时/.test(st.userMd);

// ── P2: 会话事件化 ──
const c1 = await b.invoke("chat_new", { domain: "", title: "" });
R.chatNew = { id: c1.id, idHasNode: /-/.test(c1.id) };
await b.invoke("chat_append", { domain: "", id: c1.id, msg: { role: "user", text: "讲讲一般过去时", pack: "english.high" } });
const c2 = await b.invoke("chat_append", { domain: "", id: c1.id, msg: { role: "assistant", kind: "text", text: "好的", pack: "english.high" } });
R.chatAppend = { msgs: c2.messages.length, title: c2.title, pack: c2.pack };

// 模拟第二台设备：直接往同一会话目录写另一个 node 的 jsonl（不经过 chat_append）
const dir = path.join(b.state.domain, "chats", c1.id);
const other = "demo-pad-x9";
fs.appendFileSync(path.join(dir, other + ".jsonl"), JSON.stringify({ id: `m${Date.now()}-${other}`, ts: new Date(Date.now() + 1000).toISOString(), role: "user", kind: "text", text: "我在平板上补一句", pack: "english.high", node: other }) + "\n");
const merged = await b.invoke("chat_get", { domain: "", id: c1.id });
R.mergedTwoNodes = { msgs: merged.messages.length, nodes: [...new Set(merged.messages.map((m) => m.node))], texts: merged.messages.map((m) => m.text) };

// 列表 & 删除墓碑
const before = await b.invoke("chat_list", { domain: "" });
await b.invoke("chat_delete", { domain: "", id: c1.id });
const after = await b.invoke("chat_list", { domain: "" });
R.deleteTombstone = { before: before.chats.length, after: after.chats.length, stillOnDisk: fs.existsSync(dir) };

// 重命名
const c3 = await b.invoke("chat_new", { domain: "", title: "" });
await b.invoke("chat_append", { domain: "", id: c3.id, msg: { role: "user", text: "原始标题" } });
const ren = await b.invoke("chat_rename", { domain: "", id: c3.id, title: "改过的标题" });
R.rename = { title: ren.title };

console.log(JSON.stringify(R, null, 2));
