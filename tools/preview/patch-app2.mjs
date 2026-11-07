import fs from "node:fs";
const P = "apps/desktop/src/app.js";
let t = fs.readFileSync(P, "utf8");
const before = t.length;

/* 1) renderChatList 结束处同时渲染抽屉列表 */
if (!t.includes("function renderDrawerList")) {
  t = t.replace(
    `  el.querySelectorAll("[data-del]").forEach((x) => {
    x.onclick = async (e) => {
      e.stopPropagation();
      try {
        await invoke("chat_delete", { domain: getDomain(), id: x.dataset.del });
        const wasCurrent = state.currentChatId === x.dataset.del;
        await loadChats();
        if (wasCurrent) {
          if (state.chats[0]) await openChat(state.chats[0].id);
          else await newChat();
        } else if (state.tab === "chat") render();
      } catch (err) {
        state.chatMsg = "删除失败：" + readableErr(err);
        render();
      }
    };
  });
}`,
    `  el.querySelectorAll("[data-del]").forEach((x) => {
    x.onclick = async (e) => {
      e.stopPropagation();
      await deleteChat(x.dataset.del);
    };
  });
  renderDrawerList();
}

/** 手机端抽屉里的会话列表（删除按钮常显，触屏可点） */
function renderDrawerList() {
  const el = document.getElementById("drawer-list");
  if (!el) return;
  if (!state.chats.length) {
    el.innerHTML = \`<div class="chat-empty">还没有对话</div>\`;
    return;
  }
  el.innerHTML = state.chats
    .map(
      (c) => \`<div class="drawer-item \${c.id === state.currentChatId ? "active" : ""}">
        <button class="drawer-item-main" data-id="\${esc(c.id)}">
          <span class="drawer-item-t">\${esc(c.title || "新对话")}</span>
          <span class="drawer-item-m mono">\${c.pack ? esc(c.pack) : "未定学科"} · \${c.count} 条</span>
        </button>
        <button class="drawer-item-x" data-del2="\${esc(c.id)}" aria-label="删除">×</button>
      </div>\`
    )
    .join("");
  el.querySelectorAll(".drawer-item-main").forEach((b) => {
    b.onclick = () => { closeDrawer(); openChat(b.dataset.id); };
  });
  el.querySelectorAll("[data-del2]").forEach((b) => {
    b.onclick = async (e) => { e.stopPropagation(); await deleteChat(b.dataset.del2); };
  });
}

async function deleteChat(id) {
  try {
    await invoke("chat_delete", { domain: getDomain(), id });
    const wasCurrent = state.currentChatId === id;
    await loadChats();
    if (wasCurrent) {
      if (state.chats[0]) await openChat(state.chats[0].id);
      else await newChat();
    } else if (state.tab === "chat") render();
  } catch (err) {
    state.chatMsg = "删除失败：" + readableErr(err);
    render();
  }
}

function openDrawer() {
  const d = document.getElementById("chat-drawer");
  if (!d) return;
  renderDrawerList();
  d.classList.remove("hidden");
  document.body.classList.add("drawer-open");
}
function closeDrawer() {
  const d = document.getElementById("chat-drawer");
  if (d) d.classList.add("hidden");
  document.body.classList.remove("drawer-open");
}`
  );
  console.log("✅ 抽屉列表与删除共用");
}

/* 2) boot：绑定抽屉 */
if (!t.includes('getElementById("btn-chats")')) {
  t = t.replace(
    `  const newChatBtn = document.getElementById("btn-new-chat");
  if (newChatBtn) newChatBtn.onclick = () => newChat();`,
    `  const newChatBtn = document.getElementById("btn-new-chat");
  if (newChatBtn) newChatBtn.onclick = () => newChat();
  const chatsBtn = document.getElementById("btn-chats");
  if (chatsBtn) chatsBtn.onclick = openDrawer;
  const drawClose = document.getElementById("drawer-close");
  if (drawClose) drawClose.onclick = closeDrawer;
  const drawNew = document.getElementById("drawer-new");
  if (drawNew) drawNew.onclick = async () => { closeDrawer(); await newChat(); };
  const drawer = document.getElementById("chat-drawer");
  if (drawer) drawer.addEventListener("click", (e) => { if (e.target === drawer) closeDrawer(); });
  document.querySelectorAll("#chat-drawer [data-tab]").forEach((b) => {
    b.onclick = () => { closeDrawer(); setTab(b.dataset.tab); };
  });`
  );
  console.log("✅ boot 绑定抽屉");
}

/* 3) 讲解检测题：判完即落账（record_judged）；讲解展示也留痕（record_explain） */
if (!t.includes("record_judged")) {
  // 3a. 非 item 分支
  t = t.replace(
    `      if (!isQuizMsg) {
        // 讲解里的检测题：只判对错，不写账本（没有 item id）
        if (note) note.innerHTML = correct ? \`<span class="ok-mark">回答正确</span>\` : \`<span class="no-mark">不对，正确答案是 \${esc(btn.dataset.answer || "")}</span>\`;
        card.dataset.done = "1";
        return;
      }`,
    `      if (!isQuizMsg) {
        // 讲解里的检测题：也要落账（合成 id），否则掌握度/薄弱/到期永远看不到它
        card.dataset.done = "1";
        const packId = (state.chat && state.chat.pack) || "";
        const kcId = (state.current && state.current.kcs && currentKcIdFromChat()) || "";
        if (note) note.innerHTML = correct ? \`<span class="ok-mark">回答正确</span>\` : \`<span class="no-mark">不对，正确答案是 \${esc(btn.dataset.answer || "")}</span>\`;
        try {
          const res = await invoke("record_judged", {
            domain: getDomain(),
            packsDir: packsDirValue(),
            pack: packId,
            kcId,
            syntheticId: \`\${packId}::\${kcId}::followup\`,
            answered: btn.dataset.quizOpt,
            ok: correct,
            source: "chat-followup",
          });
          const k = (res && res.kc) || null;
          if (note && k) note.innerHTML += \` <span class="mono muted">· 本知识点 对/错 \${k.correct ?? 0}/\${k.wrong ?? 0} · 掌握度 \${pct(k.mastery)}</span>\`;
          state.me.due = null;
        } catch (e) {
          if (note) note.innerHTML += \` <span class="no-mark">（记账失败）</span>\`;
        }
        return;
      }`
  );
  console.log("✅ 讲解检测题落账");
}

/* 4) explain 成功后留痕 */
if (!t.includes('invoke("record_explain"')) {
  t = t.replace(
    `  const meta = { model: res.model, attempts: res.attempts, __meta: undefined };`,
    `  const meta = { model: res.model, attempts: res.attempts, __meta: undefined };
  // A3 留痕：记一笔「讲解已展示」（失败不影响主流程）
  try { await invoke("record_explain", { domain: getDomain(), pack, kcId: kc.id, model: res.model, source: "ai" }); } catch (e) {}`
  );
  console.log("✅ explain 留痕");
}

/* 5) 手机端 Enter 换行（用按钮发送），桌面 Enter 发送 */
if (!t.includes("isPhone() ? null : undefined")) {
  t = t.replace(
    `    ta.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (form) form.requestSubmit(); } };`,
    `    ta.onkeydown = (e) => {
      // 手机端软键盘回车=换行（避免误发），桌面 Enter 发送
      if (e.key === "Enter" && !e.shiftKey && !isPhone()) { e.preventDefault(); if (form) form.requestSubmit(); }
    };`
  );
  console.log("✅ 移动端 Enter 换行");
}

/* 6) 会话内当前知识点的兜底：从 chat 的 pack 找最近讲过的 KC */
if (!t.includes("function currentKcIdFromChat")) {
  t += `
/** 从当前会话推断「正在讲的 KC」：取最后一条 explain/quiz 消息的 kc */
function currentKcIdFromChat() {
  const msgs = (state.chat && state.chat.messages) || [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.kind === "explain" && m.data && m.data.kc_id) return m.data.kc_id;
    if (m.kind === "quiz" && m.data && m.data.kc && m.data.kc.kc_id) return m.data.kc.kc_id;
  }
  const k = (state.current && state.current.kcs && state.current.kcs[0]) || null;
  return k ? k.id : "";
}
`;
  console.log("✅ currentKcIdFromChat");
}

fs.writeFileSync(P, t, "utf8");
console.log("app.js 写入完成", before, "→", t.length);
