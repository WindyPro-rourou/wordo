import fs from "node:fs";
const P = "tools/preview/backend.mjs";
let t = fs.readFileSync(P, "utf8");

/* ---------- 1) 会话：改为事件化（与 Rust chat.rs 同构） ---------- */
const startMark = "/* ══════════ 会话（chat-first） ══════════ */";
const endMark = "export async function invoke(name, args = {}) {";
const i0 = t.indexOf(startMark);
const i1 = t.indexOf(endMark);
if (i0 < 0 || i1 < 0) throw new Error("找不到会话区块边界");

const chatBlock = `/* ══════════ 会话（chat-first）：事件化存储，避免整文件覆盖丢消息 ══════════ */

const chatsRoot = (d) => path.join(domainRoot(d), "chats");
const chatDir = (d, id) => path.join(chatsRoot(d), id);
const safeId = (id) => !!id && id.length <= 80 && /^[A-Za-z0-9_-]+$/.test(id);
const newMsgId = (node) => \`m\${Date.now()}-\${node}\`;

function readChatEvents(dir) {
  const seen = new Set(), out = [];
  if (!exists(dir)) return out;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".jsonl")).sort()) {
    for (const line of fs.readFileSync(path.join(dir, f), "utf8").split(/\\r?\\n/)) {
      const s = line.trim(); if (!s) continue;
      try { const m = JSON.parse(s); if (!seen.has(m.id)) { seen.add(m.id); out.push(m); } } catch {}
    }
  }
  out.sort((a, b) => String(a.ts).localeCompare(String(b.ts)) || String(a.id).localeCompare(String(b.id)));
  return out;
}
const chatDeleted = (dir) => readChatEvents(dir).some((m) => m.kind === "__deleted");

function chatTitleOf(evs) {
  const rn = evs.filter((m) => m.kind === "__rename").pop();
  if (rn) return rn.text;
  const u = evs.find((m) => m.role === "user");
  return u ? [...String(u.text)].slice(0, 24).join("") : "";
}

export function chatList(domain) {
  const root = chatsRoot(domain);
  const out = [];
  if (!exists(root)) return { chats: [] };
  for (const id of fs.readdirSync(root)) {
    const dir = chatDir(domain, id);
    if (!exists(dir) || !fs.statSync(dir).isDirectory()) continue;
    if (!safeId(id) || chatDeleted(dir)) continue;
    const evs = readChatEvents(dir);
    if (!evs.length) continue;
    const pack = [...evs].reverse().map((m) => m.pack || "").find((p) => p) || "";
    out.push({ id, title: chatTitleOf(evs), updated: evs[evs.length - 1].ts, pack, count: evs.filter((m) => m.kind !== "__rename" && m.kind !== "__deleted").length });
  }
  out.sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
  return { chats: out };
}

export function chatGet(domain, id) {
  if (!safeId(id)) throw new Error("非法会话 id");
  const dir = chatDir(domain, id);
  if (!exists(dir)) throw new Error(\`找不到会话 \${id}\`);
  const evs = readChatEvents(dir);
  const messages = evs.filter((m) => m.kind !== "__rename" && m.kind !== "__deleted")
    .map((m) => ({ id: m.id, role: m.role, kind: m.kind, text: m.text, ts: m.ts, data: m.data ?? null, pack: m.pack || "", node: m.node || "" }));
  const metaPath = path.join(dir, "meta.json");
  const created = exists(metaPath) ? (readJson(metaPath).created || "") : "";
  const pack = [...evs].reverse().map((m) => m.pack || "").find((p) => p) || "";
  return { id, title: chatTitleOf(evs), pack, created, messages };
}

export function chatNew(domain, title) {
  const node = nodeId(domain);
  const id = \`c\${Date.now()}-\${node}\`;
  const dir = chatDir(domain, id);
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ id, created: nowIso() }));
  if (String(title || "").trim()) appendChatLine(dir, node, { role: "system", kind: "__rename", text: String(title).trim() });
  return chatGet(domain, id);
}

function appendChatLine(dir, node, msg) {
  ensureDir(dir);
  const m = { id: newMsgId(node), ts: nowIso(), role: "user", kind: "text", text: "", data: null, pack: "", node, ...msg };
  fs.appendFileSync(path.join(dir, \`\${node}.jsonl\`), JSON.stringify(m) + "\\n");
  return m;
}

export function chatAppend(domain, id, msg = {}) {
  const node = nodeId(domain);
  const cid = safeId(id) ? id : \`c\${Date.now()}-\${node}\`;
  const dir = chatDir(domain, cid);
  if (!exists(dir)) {
    ensureDir(dir);
    fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ id: cid, created: nowIso() }));
  }
  appendChatLine(dir, node, msg);
  return chatGet(domain, cid);
}

export function chatRename(domain, id, title) {
  if (!safeId(id)) throw new Error("非法会话 id");
  const dir = chatDir(domain, id);
  if (!exists(dir)) throw new Error(\`找不到会话 \${id}\`);
  appendChatLine(dir, nodeId(domain), { role: "system", kind: "__rename", text: String(title || "").trim() });
  return chatGet(domain, id);
}

export function chatDelete(domain, id) {
  if (!safeId(id)) throw new Error("非法会话 id");
  const dir = chatDir(domain, id);
  if (exists(dir)) appendChatLine(dir, nodeId(domain), { role: "system", kind: "__deleted", text: "" });
  return { deleted: true, id };
}

/** 从一句话判定学科：知识点名命中(5) > 学科名(3) > id(2) > 学科简称(1) */
export function detectSubject(domain, text, packsDir) {
  const tt = String(text || "").toLowerCase();
  const dir = packsDir || state.packsDir;
  let best = { pack: "", name: "", why: "", score: 0 };
  if (!exists(dir)) return best;
  for (const name of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, name);
    if (!exists(path.join(p, "subject.json"))) continue;
    let meta = {};
    try { meta = readJson(path.join(p, "subject.json")); } catch {}
    const nm = meta.name || "";
    let score = 0, why = "";
    try {
      for (const kc of readJson(path.join(p, "tree", "kc.json"))) {
        if (kc.name && [...kc.name].length >= 2 && tt.includes(String(kc.name).toLowerCase())) {
          score += 5;
          if (!why) why = \`命中知识点「\${kc.name}」\`;
        }
      }
    } catch {}
    if (nm && tt.includes(nm.toLowerCase())) { score += 3; if (!why) why = \`提到学科「\${nm}」\`; }
    const short = nm.replace("高中", "").replace("初中", "");
    if (short && tt.includes(short.toLowerCase())) score += 1;
    if (tt.includes(name.toLowerCase())) score += 2;
    if (score > best.score) best = { pack: name, name: nm || name, why, score };
  }
  return best;
}

`;
t = t.slice(0, i0) + chatBlock + t.slice(i1);

/* ---------- 2) invoke：补 record_judged / record_explain ---------- */
if (!t.includes('case "record_judged"')) {
  t = t.replace('    case "chat_list":', `    case "record_judged": {
      const node = nodeId(domain);
      const ev = {
        id: \`\${Date.now()}-0-\${node}\`, ts: nowIso(), node, kind: "answer",
        pack: args.pack || "", item_id: args.syntheticId || "", kc_ids: args.kcId ? [args.kcId] : [],
        answered: args.answered || "", correct: args.ok ? "(judged-correct)" : "(judged-wrong)",
        ok: !!args.ok, source: args.source || "followup", error_type: args.errorType || null,
      };
      appendEvent(domain, ev);
      try { writeUserMd(domain, packsDir); } catch {}
      const st = derive(domain);
      const kc = args.kcId ? st.kcs.get(args.kcId) || null : null;
      return { ok: !!args.ok, eventId: ev.id, kc, nextDue: kc ? kc.due_ts : null };
    }
    case "record_explain": {
      const node = nodeId(domain);
      const ev = { id: \`\${Date.now()}-0-\${node}\`, ts: nowIso(), node, kind: "explain", pack: args.pack || "", kc_ids: args.kcId ? [args.kcId] : [], model: args.model || "", source: args.source || "ai" };
      appendEvent(domain, ev);
      return { ok: true, eventId: ev.id };
    }
    case "chat_list":`);
  console.log("✅ backend 加 record_judged / record_explain");
}

/* ---------- 3) learn_plan list：改为从账本派生 ---------- */
const planOld = t.indexOf('case "learn_plan": {');
if (planOld > 0) {
  const listStart = t.indexOf('const done = new Set(readEvents(domain).filter((e) => e.kind === "plan_done").map((e) => e.task_id));', planOld);
  const retEnd = t.indexOf("return { plan: list };", planOld);
  if (listStart > 0 && retEnd > listStart) {
    const newList = `const done = new Set(readEvents(domain).filter((e) => e.kind === "plan_done").map((e) => e.task_id));
      const seen = new Set(); const list = [];
      for (const ev of readEvents(domain).filter((e) => e.kind === "plan_add")) {
        if (!ev.task_id || seen.has(ev.task_id)) continue;
        seen.add(ev.task_id);
        list.push({ id: ev.task_id, text: ev.note || "", done: done.has(ev.task_id), by: ev.node });
      }
      `;
    t = t.slice(0, listStart) + newList + t.slice(retEnd);
    console.log("✅ backend learn_plan 改为账本派生");
  }
}

fs.writeFileSync(P, t, "utf8");
console.log("backend.mjs 写入完成", t.length);
