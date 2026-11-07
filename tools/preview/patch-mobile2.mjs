import fs from "node:fs";
/* ---------- A. 手机键盘避让 + 发送键 ---------- */
let I="apps/desktop/src/index.html"; let h=fs.readFileSync(I,"utf8");
h=h.replace('content="width=device-width, initial-scale=1.0, viewport-fit=cover"','content="width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content"');
fs.writeFileSync(I,h,"utf8");
console.log("✅ viewport interactive-widget");

let P="apps/desktop/src/app.js"; let t=fs.readFileSync(P,"utf8");
// A1 visualViewport 监听
if(!t.includes("visualViewport")){
  t=t.replace(`  await loadConfig();`,`  // 软键盘避让：把键盘高度写进 CSS 变量（手机端）
  if (window.visualViewport) {
    const vv = window.visualViewport;
    const syncKb = () => {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty("--kb", kb + "px");
      const th = document.querySelector("#chat-thread");
      if (th && kb > 0) th.scrollTop = th.scrollHeight;
    };
    vv.addEventListener("resize", syncKb);
    vv.addEventListener("scroll", syncKb);
  }
  await loadConfig();`);
  console.log("✅ visualViewport");
}
// A2 发送键：空输入置灰 + 手机端 Enter 换行（已有）
t=t.replace(`      <button class="btn" type="submit" ${'${state.chatBusy ? "disabled" : ""}'}>发送</button>`,
`      <button class="btn" id="chat-send" type="submit" ${'${state.chatBusy ? "disabled" : ""}'}>发送</button>`);
t=t.replace(`    ta.oninput = () => { autoGrow(ta); state.chatDraft = ta.value; };`,
`    ta.oninput = () => {
      autoGrow(ta);
      state.chatDraft = ta.value;
      const sb = document.getElementById("chat-send");
      if (sb) sb.disabled = !String(ta.value || "").trim();
    };
    const sb0 = document.getElementById("chat-send");
    if (sb0) sb0.disabled = !String(ta.value || "").trim();`);
console.log("✅ 发送键置灰");

/* ---------- B. 学科胶囊：对话内纠错（写事件、不跳页） ---------- */
t=t.replace(`async function openPack(path) {`,`async function openPack(path, opts) {
  const stay = !!(opts && opts.stayInChat);`);
t=t.replace(`  state.learn = { kcId: null, ai: null, aiLoading: false, aiError: null, pick: null, classify: null, classifyLoading: false };
  renderPackList();
  setTab("learn");`,
`  state.learn = { kcId: null, ai: null, aiLoading: false, aiError: null, pick: null, classify: null, classifyLoading: false };
  if (stay && state.currentChatId) {
    // 对话内手动改学科：追加事件（不改历史），并提示用户
    const sid = state.current.meta.id;
    const nm = state.current.meta.name || sid;
    try {
      state.chat = await invoke("chat_append", { domain: getDomain(), id: state.currentChatId, msg: { role: "system", kind: "note", text: "手动指定学科：" + nm, pack: sid } });
    } catch (e) {}
    renderPackList();
    await loadChats();
    setTab("chat");
    return;
  }
  renderPackList();
  setTab("learn");`);
// 抽屉/浮层选学科时带 stayInChat
t=t.replace(`      b.onclick = () => { openPack(b.dataset.path); closeSubjectSheet(); };`,`      b.onclick = () => { openPack(b.dataset.path, { stayInChat: state.tab === "chat" }); closeSubjectSheet(); };`);
fs.writeFileSync(P,t,"utf8");
console.log("✅ 学科胶囊纠错");
