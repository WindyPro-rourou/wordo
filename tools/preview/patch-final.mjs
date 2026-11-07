import fs from "node:fs";
/* 1) 已掌握 → 不占每日队列（仍保留低频间隔，可另行抽查） */
let L="core/src/learn.rs"; let t=fs.readFileSync(L,"utf8");
t=t.replace(`        .filter(|k| k.attempts > 0)
        .filter(|k| match k.due_ts.as_deref().and_then(parse_ts) {`,`        .filter(|k| k.attempts > 0 && !k.mastered) // 已掌握不占每日复习配额（低频抽查，见 interval≥14d）
        .filter(|k| match k.due_ts.as_deref().and_then(parse_ts) {`);
fs.writeFileSync(L,t,"utf8"); console.log("✅ Rust due 排除已掌握");
let B="tools/preview/backend.mjs"; let b=fs.readFileSync(B,"utf8");
b=b.replace(`    .filter((k) => k.attempts > 0 && !k.mastered)
    .filter((k) => k.due_ts && parseTs(k.due_ts) <= at)`,`    .filter((k) => k.attempts > 0 && !k.mastered) // 已掌握不占每日配额
    .filter((k) => k.due_ts && parseTs(k.due_ts) <= at)`);
fs.writeFileSync(B,b,"utf8"); console.log("✅ backend due 排除已掌握（确认无双重过滤）");

/* 2) 连续两次答错 → 提供「换种讲法」 */
let P="apps/desktop/src/app.js"; let a=fs.readFileSync(P,"utf8");
if(!a.includes("换种讲法讲一遍")){
  a=a.replace(`          if (!correct) {
            const b = document.createElement("button");
            b.className = "btn btn-ghost";
            b.textContent = "让 AI 分析错因";
            b.onclick = () => askWhyWrong(card, btn.dataset.quizOpt);
            note.appendChild(b);
          }`,
`          if (!correct) {
            const b = document.createElement("button");
            b.className = "btn btn-ghost";
            b.textContent = "让 AI 分析错因";
            b.onclick = () => askWhyWrong(card, btn.dataset.quizOpt);
            note.appendChild(b);
            // 同一知识点连续两次答错 → 中断刷题，换一种讲法回看（评审建议）
            if ((k.wrong || 0) >= 2) {
              const b2 = document.createElement("button");
              b2.className = "btn btn-ghost";
              b2.textContent = "换种讲法讲一遍";
              b2.onclick = () => explainAlternate(kcId || (state.current && state.current.meta.id && ""), kcId);
              note.appendChild(b2);
            }
          }`);
  a=a.replace("async function doExplain(pack, text) {", `/** 换一种教学法重讲（避免「错→刷题→再错」死循环） */
async function explainAlternate(packId, kcId) {
  const pack = packId || (state.chat && state.chat.pack) || "";
  const kc = ((state.current && state.current.kcs) || []).find((x) => x.id === kcId) || null;
  if (!kc || !pack) return doGuide(pack, "先确认一下要重讲哪个知识点。");
  const p = packOf(pack);
  try {
    const res = await invoke("ask_model", {
      req: {
        task: "explain", packPath: p ? p.path : "", domain: getDomain(), packsDir: packsDirValue(),
        payload: { kc_id: kc.id, kc_name: kc.name, toc: kc.toc, learner: {}, style_hint: "请换一种讲法：不要重复上次的文字推导，改用生活类比或图示化的分步描述" },
      },
    });
    if (res && res.data) {
      state.chat = await invoke("chat_append", { domain: getDomain(), id: state.currentChatId, msg: { role: "assistant", kind: "explain", text: (res.data.explanation_md || "").slice(0, 60), data: { ...res.data, __meta: { model: res.model, attempts: res.attempts } }, pack } });
      await loadChats(); render();
    }
  } catch (e) { state.chatMsg = "重讲失败：" + readableErr(e); render(); }
}

async function doExplain(pack, text) {`);
  console.log("✅ 连续两次错→换种讲法");
}
fs.writeFileSync(P,a,"utf8");
