import fs from "node:fs";
const P = "apps/desktop/src/app.js";
let t = fs.readFileSync(P, "utf8");

/* ---------- 1) 重写 bindQuiz：信心档 + 错因档 + 蒙对提示 ---------- */
const start = t.indexOf("function bindQuiz(view) {");
if (start < 0) throw new Error("bindQuiz 未找到");
// 找到函数结束
let depth = 0, i = t.indexOf("{", start), end = -1;
for (; i < t.length; i++) {
  if (t[i] === "{") depth++;
  else if (t[i] === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
}
const newBind = String.raw`function bindQuiz(view) {
  view.querySelectorAll(".q-opt[data-quiz-opt]").forEach((btn) => {
    btn.onclick = () => {
      const card = btn.closest(".msg-card");
      if (!card || card.dataset.done === "1") return;
      card.dataset.done = "1";
      const isItem = !!card.dataset.item;
      const correct = isItem ? btn.dataset.correct === "1" : String(btn.dataset.quizOpt) === String(btn.dataset.answer || "");
      card.querySelectorAll(".q-opt[data-quiz-opt]").forEach((b) => (b.disabled = true));
      btn.classList.add(correct ? "correct" : "wrong");
      const note = card.querySelector(".quiz-note");
      if (!note) return;
      const confChips = [["certain", "确定"], ["unsure", "说不准"], ["guess", "蒙的"]];
      const errChips = [["concept_confused", "概念不清"], ["calculation_slip", "算错/笔误"], ["misread", "看错题"]];
      note.innerHTML =
        '<div class="chip-row"><span class="chip-label">' + (correct ? "答对了 —— 你是怎么确定的？" : "答错了 —— 先自评一下：") + "</span>" +
        confChips.map(([v, l]) => '<button class="mini-chip" data-conf="' + v + '">' + l + "</button>").join("") +
        "</div>" +
        (correct ? "" : '<div class="chip-row"><span class="chip-label">错因：</span>' + errChips.map(([v, l]) => '<button class="mini-chip" data-err="' + v + '">' + l + "</button>").join("") + "</div>");
      let conf = null, err = null, sent = false;
      const submit = async () => {
        if (!conf || sent) return;
        sent = true;
        note.innerHTML = '<span class="mono muted">记账中…</span>';
        try {
          const kcId = isItem ? card.dataset.kc : currentKcIdFromChat();
          const packId = isItem ? card.dataset.pack : (state.chat && state.chat.pack) || "";
          let res;
          if (isItem) {
            res = await invoke("record_answer", { domain: getDomain(), packsDir: packsDirValue(), pack: packId, itemId: card.dataset.item, answered: btn.dataset.quizOpt, source: "chat" });
          } else {
            res = await invoke("record_judged", {
              domain: getDomain(), packsDir: packsDirValue(), pack: packId, kcId,
              syntheticId: packId + "::" + kcId + "::followup",
              answered: btn.dataset.quizOpt, ok: correct, source: "chat-followup",
              errorType: err || undefined, confidence: conf,
            });
          }
          const k = (res && res.kc) || {};
          const guessNote = conf === "guess" && correct ? "（蒙对已按 40% 计入）" : "";
          note.innerHTML =
            (correct ? CHECK_SVG : CROSS_SVG) +
            "<span>" + (correct ? "正确" : "正确答案 " + esc(String((res && res.correct) || btn.dataset.answer || ""))) +
            " · 对/错 " + (k.correct ?? 0) + "/" + (k.wrong ?? 0) + " · 掌握度 " + pct(k.mastery) + guessNote + "</span>";
          if (!correct) {
            const b = document.createElement("button");
            b.className = "btn btn-ghost";
            b.textContent = "让 AI 分析错因";
            b.onclick = () => askWhyWrong(card, btn.dataset.quizOpt);
            note.appendChild(b);
          }
          state.me.due = null;
        } catch (e) {
          note.textContent = "记账失败：" + readableErr(e);
        }
      };
      note.querySelectorAll("[data-conf]").forEach((b) => {
        b.onclick = () => {
          conf = b.dataset.conf;
          note.querySelectorAll("[data-conf]").forEach((x) => x.classList.toggle("sel", x === b));
          submit();
        };
      });
      note.querySelectorAll("[data-err]").forEach((b) => {
        b.onclick = () => {
          err = b.dataset.err;
          note.querySelectorAll("[data-err]").forEach((x) => x.classList.toggle("sel", x === b));
        };
      });
    };
  });
}`;
t = t.slice(0, start) + newBind + t.slice(end);
console.log("✅ bindQuiz 重写（信心档/错因档/蒙对提示）");

/* ---------- 2) 混合练习 ---------- */
if (!t.includes("async function doMixedQuiz")) {
  t = t.replace("async function doExplain(pack, text) {", String.raw`/** 交错练习：2–3 个薄弱点各出一题，混在一次练习里 */
async function doMixedQuiz(pack) {
  let due = null;
  try { due = await invoke("learn_due", { domain: getDomain(), packsDir: packsDirValue() }); state.me.due = due || null; } catch {}
  const pool = ((due && (due.weak || [])) || []).concat((due && due.due) || []);
  const uniq = [];
  const seen = new Set();
  for (const k of pool) { if (!seen.has(k.kc_id)) { seen.add(k.kc_id); uniq.push(k); } }
  const pick = uniq.slice(0, 3);
  if (!pick.length) return doGuide(pack, "还没有足够的数据做混合练习。先做几道题、攒出薄弱点再来。");
  const items = [];
  for (const k of pick) {
    try {
      const q = await invoke("learn_queue", { domain: getDomain(), packsDir: packsDirValue(), kcId: k.kc_id, n: 1 });
      if (q && q.items && q.items[0]) items.push({ item: q.items[0], kc: k, pack: k.pack || pack });
    } catch (e) {}
  }
  if (!items.length) return doGuide(pack, "这几个知识点暂时没有可出的题。");
  await appendAssistantNote("混合练习：" + items.map((x) => x.kc.kc_name).join(" / ") + "（交错出题，比重刷一个点更有效）");
  for (const x of items) {
    state.chat = await invoke("chat_append", {
      domain: getDomain(), id: state.currentChatId,
      msg: { role: "assistant", kind: "quiz", text: "来一道「" + x.kc.kc_name + "」的题：", data: { item: x.item, kc: x.kc }, pack: x.pack },
    });
  }
  for (const k of pick) if (!pack) { pack = k.pack; break; }
  if (pack) await ensurePack(pack);
}

async function doExplain(pack, text) {`);
  console.log("✅ doMixedQuiz");
}

/* ---------- 3) 意图：混合练习 ---------- */
t = t.replace(
  `  if (/(做题|练习|练一练|出题|出两道|测我|考我|几道|来一道|再来一题)/.test(t)) return "quiz";`,
  `  if (/(混合|交错|混着|换着练)/.test(t)) return "mixed";
  if (/(做题|练习|练一练|出题|出两道|测我|考我|几道|来一道|再来一题)/.test(t)) return "quiz";`
);
t = t.replace(
  `    if (intent === "quiz") await doQuiz(pack);`,
  `    if (intent === "quiz") await doQuiz(pack);
    else if (intent === "mixed") await doMixedQuiz(pack);`
);

/* ---------- 4) 欢迎语加「混合练」建议 ---------- */
t = t.replace(
  `  chips.push("给我出两道题");`,
  `  chips.push("给我出两道题");
  chips.push("混合练 3 个薄弱点");`
);

fs.writeFileSync(P, t, "utf8");
console.log("app.js 写入完成", t.length);
