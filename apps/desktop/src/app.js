/* WORDO 桌面壳 —— 前端逻辑（薄壳：全部能力在 wordo-core） */
"use strict";

const DEFAULT_PACKS_DIR = "F:/去中心化分布式跨平台自进化ai学习系统/packs";
const { invoke } = window.__TAURI__.core;

const state = {
  packs: [],
  current: null,
  tab: "learn",
  config: null,
  presets: [],
  configPath: "",
  learn: { kcId: null, ai: null, aiLoading: false, aiError: null, pick: null, classify: null, classifyLoading: false },
  /* 「我的」= 学习账本视图：state(user.md) / due(薄弱+今日队列) / sync(域同步结果) / msg(操作反馈) */
  me: { state: null, due: null, sync: null, review: null, msg: "", error: null, loading: false, busy: null, seq: 0, view: null },
};

/* ══════════ 启动 ══════════ */
async function boot() {
  const input = document.getElementById("packs-dir");
  input.value = localStorage.getItem("packsDir") || DEFAULT_PACKS_DIR;
  document.getElementById("btn-refresh").onclick = refreshPacks;
  document.getElementById("btn-settings").onclick = () => {
    setTab("settings");
  };
  document.querySelectorAll(".tab").forEach((t) => {
    t.onclick = () => setTab(t.dataset.tab);
  });
  await loadConfig();
  await refreshPacks();
  if (state.packs.length) {
    await openPack(state.packs[0].path);
  } else {
    // 没有学科包时也让页签可见：「我的」读的是账本，不依赖具体学科包
    document.getElementById("tabs").classList.remove("hidden");
  }
}

function setTab(tab) {
  state.tab = tab;
  document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x.dataset.tab === tab));
  document.getElementById("tabs").classList.toggle("hidden", !state.current && tab !== "settings" && tab !== "me");
  render();
}

async function loadConfig() {
  try {
    const res = await invoke("get_config");
    state.config = res.config || {};
    state.presets = res.presets || [];
    state.configPath = res.path || "";
  } catch (e) {
    state.config = {};
    state.presets = [];
  }
}

async function refreshPacks() {
  const dir = document.getElementById("packs-dir").value.trim();
  localStorage.setItem("packsDir", dir);
  try {
    const res = await invoke("list_packs", { packsDir: dir });
    state.packs = res.packs || [];
  } catch (e) {
    state.packs = [];
  }
  renderPackList();
}

/* ══════════ 左侧学科包列表 ══════════ */
function renderPackList() {
  const el = document.getElementById("pack-list");
  el.innerHTML = "";
  if (!state.packs.length) {
    el.innerHTML = `<div class="empty">该目录下没有发现学科包</div>`;
    return;
  }
  state.packs.forEach((p, i) => {
    const btn = document.createElement("button");
    const isActive = state.current && state.current.meta.id === p.subjectId;
    btn.className = "pack-btn reveal" + (isActive ? " active" : "");
    btn.style.setProperty("--i", i);
    const badge =
      p.errors > 0
        ? `<span class="badge err">${p.errors} 错误</span>`
        : p.warnings > 0
        ? `<span class="badge warn">${p.warnings} 警告</span>`
        : `<span class="badge ok">通过</span>`;
    btn.innerHTML = `
      <div class="pack-name">${esc(p.name || p.subjectId || "未命名")}</div>
      <div class="pack-sub">
        <span>${esc(p.subjectId || "")}</span>${badge}
        <span style="margin-left:auto">${p.kcCount} KC · ${p.itemCount} 题</span>
      </div>`;
    btn.onclick = () => openPack(p.path);
    el.appendChild(btn);
  });
  observeReveals(el);
}

async function openPack(path) {
  try {
    state.current = await invoke("load_pack", { packPath: path });
  } catch (e) {
    viewMessage("加载失败: " + e);
    return;
  }
  state.learn = { kcId: null, ai: null, aiLoading: false, aiError: null, pick: null, classify: null, classifyLoading: false };
  renderPackList();
  setTab("learn");
}

/* ══════════ 主视图分发 ══════════ */
function render() {
  const view = document.getElementById("view");
  if (state.tab === "settings") return renderSettings(view);
  if (state.tab === "me") return renderMe(view);
  if (!state.current) return viewMessage("从左侧选择一个学科包");
  if (state.tab === "learn") renderLearn(view);
  else if (state.tab === "items") renderItems(view);
  else if (state.tab === "tree") renderTree(view);
  else renderReport(view);
}

/* ══════════ 学习（内容呈现） ══════════ */
function currentKc() {
  const kcs = state.current.kcs || [];
  return kcs.find((k) => k.id === state.learn.kcId) || kcs[0] || null;
}

function materialOf(kcId) {
  const mats = state.current.materials || [];
  return mats.find((m) => arrOf(m.front && m.front.kc_id).includes(kcId)) || null;
}

function renderLearn(view) {
  const { kcs, items } = state.current;
  if (!kcs || !kcs.length) return viewMessage("该包没有知识点");

  // 默认落在「有预置讲解」的第一个知识点上，保证一进来就有内容可看
  if (!state.learn.kcId) {
    const withMat = kcs.find((k) => !!materialOf(k.id));
    state.learn.kcId = (withMat || kcs[0]).id;
  }
  const kc = currentKc();
  if (!kc) return viewMessage("没有可学习的知识点");

  const mat = materialOf(kc.id);
  const kcItems = (items || []).filter((it) => arrOf(it.kc_ids).includes(kc.id));
  const ai = state.learn.ai;

  const chips = kcs
    .map((k) => {
      const n = (items || []).filter((it) => arrOf(it.kc_ids).includes(k.id)).length;
      const has = !!materialOf(k.id);
      return `<button class="chip ${k.id === kc.id ? "active" : ""}" data-kc="${esc(k.id)}">
        ${esc(k.name)}<span class="chip-n">${has ? "有讲解" : "无讲解"} · ${n} 题</span>
      </button>`;
    })
    .join("");

  let body = `
    <div class="chips">${chips}</div>
    <div class="lesson-head">
      <h1>${esc(kc.name)}</h1>
      <div class="lesson-meta">${esc(arrOf(kc.toc).join(" › "))}${kc.difficulty != null ? " · 难度 " + kc.difficulty : ""}${kc.bloom ? " · " + esc(kc.bloom) : ""}</div>
    </div>`;

  // 预置讲解
  if (mat) {
    // 素材自带的一级标题与页头重复，去掉
    const bodyMd = String(mat.body || "").replace(/^\s*#\s+.*(?:\r?\n|$)/, "");
    body += `<section class="lesson-block"><div class="block-label">预置讲解</div>${mdToHtml(bodyMd)}</section>`;
  } else {
    body += `<section class="lesson-block"><div class="hint">本知识点还没有预置讲解。点下面的按钮让模型现场讲一遍。</div></section>`;
  }

  // AI 动作区
  const keyReady = hasKey();
  body += `<div class="actions">
      <button class="btn" id="btn-ai" ${state.learn.aiLoading ? "disabled" : ""}>${state.learn.aiLoading ? "生成中…" : "让 AI 讲一遍"}</button>
      <span class="mono muted">${keyReady ? "模型：" + esc(activeModelLabel()) : "未配置 API Key —— 请先到「设置」填入"}</span>
    </div>`;

  if (state.learn.aiError) {
    body += `<div class="issue err">${esc(state.learn.aiError)}</div>`;
  }

  // AI 讲解结果
  if (ai && ai.data) {
    const d = ai.data;
    body += `<section class="lesson-block ai-card">
      <div class="block-label">AI 讲解 <span class="mono muted">· ${esc(ai.model || "")} · 尝试 ${ai.attempts || 1} 次${ai.ok ? "" : " · 校验未通过"}</span></div>
      ${
        ai.first_issues && ai.first_issues.length
          ? `<div class="issue warn">首轮被校验拦下（已自动重试修正）：${ai.first_issues.map(esc).join("；")}</div>`
          : ""
      }
      ${ai.issues && ai.issues.length ? ai.issues.map((s) => `<div class="issue warn">${esc(s)}</div>`).join("") : ""}
      ${d.prereq_gap ? `<div class="issue warn">先修缺口：${esc(kcName(d.prereq_gap))}</div>` : ""}
      ${mdToHtml(d.explanation_md || "")}
      ${d.worked_example ? `<h3>例题</h3>${mdToHtml(d.worked_example)}` : ""}
      ${
        arrOf(d.misconceptions).length
          ? `<h3>常见误解</h3><ul>${arrOf(d.misconceptions).map((m) => `<li>${esc(m)}</li>`).join("")}</ul>`
          : ""
      }
      ${
        hasTools(d.tool_hints)
          ? `<div class="tool-hint">建议教具：${arrOf(d.tool_hints).filter((t) => t !== "none").map((t) => `<span class="kc-tag">${esc(t)}</span>`).join("")}</div>`
          : ""
      }
      ${
        d.followup_question
          ? `<div class="followup">
               <div class="block-label">检测题</div>
               <div class="q-stem">${esc(d.followup_question.stem || "")}</div>
               ${arrOf(d.followup_question.options)
                 .map((o, i) => {
                   const key = "ABCD"[i];
                   const picked = state.learn.pick === key;
                   const isAns = String(d.followup_question.answer || "").toUpperCase().startsWith(key);
                   const cls = picked ? (isAns ? "correct" : "wrong") : "";
                   return `<button class="q-opt ${cls}" data-pick="${key}"><span class="key">${key}</span>${esc(String(o).replace(/^[A-D][.、]\s*/, ""))}${picked && isAns ? ' <span class="ok-mark">正确</span>' : ""}${picked && !isAns ? ' <span class="no-mark">不对</span>' : ""}</button>`;
                 })
                 .join("")}
               ${
                 state.learn.pick && !String(d.followup_question.answer || "").toUpperCase().startsWith(state.learn.pick)
                   ? `<div class="actions"><button class="btn btn-ghost" id="btn-classify" ${state.learn.classifyLoading ? "disabled" : ""}>${state.learn.classifyLoading ? "分析中…" : "让 AI 分析错因"}</button></div>`
                   : ""
               }
               ${state.learn.classify && state.learn.classify.data ? renderClassify(state.learn.classify) : ""}
             </div>`
          : ""
      }
    </section>`;
  }

  // 练习题（点击即判）
  if (kcItems.length) {
    body += `<section class="lesson-block"><div class="block-label">练习（${kcItems.length} 题，点击选项即判）</div>${kcItems
      .map((it, idx) => renderQuizItem(it, idx))
      .join("")}</section>`;
  }

  view.innerHTML = body;
  bindLearn(view);
  observeReveals(view);
}

function renderClassify(res) {
  const d = res.data;
  if (!d) return "";
  return `<div class="ai-card" style="margin-top:12px">
    <div class="block-label">错因分析 <span class="mono muted">· ${esc(res.model || "")}</span></div>
    <div class="kv"><span>类型</span><b>${esc(labelErrorType(d.error_type))}</b></div>
    ${d.root_cause_kc_id ? `<div class="kv"><span>根因知识点</span><b>${esc(kcName(d.root_cause_kc_id))}</b></div>` : ""}
    <div class="kv"><span>建议动作</span><b>${esc(labelAction(d.suggested_action))}</b></div>
    ${d.confidence != null ? `<div class="kv"><span>置信度</span><b>${d.confidence}</b></div>` : ""}
    ${d.notes ? `<p class="muted">${esc(d.notes)}</p>` : ""}
    ${res.issues && res.issues.length ? res.issues.map((s) => `<div class="issue warn">${esc(s)}</div>`).join("") : ""}
  </div>`;
}

function renderQuizItem(it, idx) {
  const isChoice = it.type === "single_choice" || it.type === "multi_choice";
  const opts = isChoice
    ? arrOf(it.options)
        .map((o) => {
          const correct = o.key === it.answer;
          return `<button class="q-opt" data-correct="${correct ? "1" : "0"}" data-ans="${esc(o.key)}">
            <span class="key">${esc(o.key)}</span>${esc(o.text)}
          </button>`;
        })
        .join("")
    : `<div class="q-opt static">${esc(it.answer_text || it.answer || "")}</div>`;
  return `<div class="q-card reveal" style="--i:${idx}" data-item="${esc(it.id || "")}" data-kc="${esc(arrOf(it.kc_ids)[0] || "")}">
    <div class="q-stem">${idx + 1}. ${esc(it.stem)}</div>
    ${opts}
    <div class="q-reveal hidden">${it.analysis ? `<div class="analysis"><b>解析</b>　${esc(it.analysis)}</div>` : ""}</div>
  </div>`;
}

function bindLearn(view) {
  view.querySelectorAll(".chip").forEach((c) => {
    c.onclick = () => {
      state.learn.kcId = c.dataset.kc;
      state.learn.ai = null;
      state.learn.aiError = null;
      state.learn.pick = null;
      state.learn.classify = null;
      render();
    };
  });

  const btnAi = view.querySelector("#btn-ai");
  if (btnAi)
    btnAi.onclick = () => {
      runExplain();
    };

  view.querySelectorAll(".q-opt[data-correct]").forEach((b) => {
    b.onclick = () => {
      answerQuiz(b);
    };
  });

  view.querySelectorAll(".q-opt[data-pick]").forEach((b) => {
    b.onclick = () => {
      state.learn.pick = b.dataset.pick;
      render();
    };
  });

  const btnCls = view.querySelector("#btn-classify");
  if (btnCls)
    btnCls.onclick = () => {
      runClassify();
    };
}

/* 点选项 = 判分 + 记账（写一条账本事件，并显示该 KC 更新后的状态） */
async function answerQuiz(btn) {
  const card = btn.closest(".q-card");
  if (!card) return;
  const ok = btn.dataset.correct === "1";
  // 原有配色与解析展示保持不变
  btn.classList.add(ok ? "correct" : "wrong");
  card.querySelector(".q-reveal")?.classList.remove("hidden");

  // 同一题已记账：只给配色，不重复写入账本
  if (card.dataset.done === "1") return;

  const itemId = card.dataset.item || "";
  const pack = state.current?.meta?.id || "";
  if (!itemId || !pack) {
    showAnsNote(card, "无法记账：缺少题目 ID 或学科包 ID。", "err");
    return;
  }

  card.dataset.busy = "1";
  showAnsNote(card, "记账中…", "pending");
  try {
    const res = await invoke("record_answer", {
      domain: getDomain(),
      packsDir: packsDirValue(),
      pack,
      itemId,
      answered: btn.dataset.ans || "",
      source: "quiz",
    });
    const k = (res && res.kc) || {};
    showAnsNote(
      card,
      `${ok ? CHECK_SVG : CROSS_SVG}<span>正确答案 ${esc(String((res && res.correct) || ""))} · 本知识点 对/错 ${esc(String(k.correct ?? 0))}/${esc(String(k.wrong ?? 0))} · 连对 ${esc(String(k.streak ?? 0))} · 掌握度 ${esc(pct(k.mastery))} · 下次复习 ${esc(dueLabel(res && res.nextDue, false) || "待安排")}</span>`,
      ok ? "ok" : "no",
      true
    );
    card.dataset.done = "1";
    // 账本变了：清掉「我的」页缓存，下次进入重新拉取
    state.me.due = null;
  } catch (e) {
    showAnsNote(card, "记账失败：" + readableErr(e), "err");
  }
  card.dataset.busy = "";
}

function showAnsNote(card, content, kind, isHtml) {
  let el = card.querySelector(".me-ans");
  if (!el) {
    el = document.createElement("div");
    el.className = "me-ans";
    card.appendChild(el);
  }
  el.className = "me-ans" + (kind ? " me-ans-" + kind : "");
  el.innerHTML = isHtml ? content : esc(content);
}

/* ---- 模型调用 ---- */
async function runExplain() {
  const kc = currentKc();
  if (!kc) return;
  state.learn.aiLoading = true;
  state.learn.aiError = null;
  render();
  try {
    const res = await invoke("ask_model", {
      req: {
        task: "explain",
        packPath: state.current.report.pack_path,
        domain: getDomain(),
        packsDir: packsDirValue(),
        payload: { kc_id: kc.id, kc_name: kc.name, toc: kc.toc, learner: {} },
      },
    });
    state.learn.ai = res;
  } catch (e) {
    state.learn.aiError = String(e);
  }
  state.learn.aiLoading = false;
  render();
}

async function runClassify() {
  const kc = currentKc();
  const q = state.learn.ai?.data?.followup_question;
  if (!kc || !q) return;
  state.learn.classifyLoading = true;
  render();
  try {
    const res = await invoke("ask_model", {
      req: {
        task: "classify-error",
        packPath: state.current.report.pack_path,
        domain: getDomain(),
        packsDir: packsDirValue(),
        payload: {
          item_id: "followup",
          stem: q.stem,
          options: q.options,
          correct: q.answer,
          answered: state.learn.pick,
          kc_id: kc.id,
        },
      },
    });
    state.learn.classify = res;
  } catch (e) {
    state.learn.classify = { data: null, issues: [String(e)] };
  }
  state.learn.classifyLoading = false;
  render();
}

function hasKey() {
  const c = state.config || {};
  const p = (c.providers || [])[c.active || 0];
  return !!(p && p.api_key && p.api_key.trim());
}
function activeModelLabel() {
  const c = state.config || {};
  const p = (c.providers || [])[c.active || 0];
  return p ? p.model || "(未选模型)" : "(未配置)";
}

/* ══════════ 我的（学习账本：user.md / 薄弱 / 今日复习 / 域操作） ══════════ */
function getDomain() {
  try {
    return localStorage.getItem("wordoDomain") || "";
  } catch (e) {
    return "";
  }
}
function packsDirValue() {
  const el = document.getElementById("packs-dir");
  return el && typeof el.value === "string" ? el.value.trim() : "";
}
function readableErr(e) {
  const s = e && e.message ? e.message : String(e == null ? "" : e);
  return s.trim() || "未知错误（后端未返回原因）";
}
function pct(m) {
  const n = Number(m);
  return isFinite(n) ? Math.round(n * 100) + "%" : "—";
}
/* 到期时间：兼容 RFC3339 字符串与秒/毫秒时间戳；过期则标注 */
function fmtWhen(v) {
  if (v == null || v === "") return "";
  const s = String(v);
  let d;
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    d = new Date(n < 1e12 ? n * 1000 : n);
  } else {
    d = new Date(s);
  }
  if (isNaN(d.getTime())) return s;
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function dueLabel(ts, mastered) {
  if (mastered) return "已掌握";
  const s = fmtWhen(ts);
  if (!s) return "待安排";
  const t = new Date(String(ts)).getTime();
  if (!isNaN(t) && t <= Date.now()) return s + " · 已到期";
  return s;
}
/* user.md 的 front-matter（--- ... ---）不是正文，渲染前去掉 */
function stripFrontMatter(md) {
  const s = String(md || "");
  const m = s.match(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/);
  return m ? s.slice(m[0].length) : s;
}

async function renderMe(view) {
  state.me.view = view;
  paintMe(view);
  await loadMe();
  if (state.me.view === view && state.tab === "me") paintMe(view);
}

async function loadMe() {
  const domain = getDomain();
  const packsDir = packsDirValue();
  const seq = ++state.me.seq;
  state.me.loading = true;
  state.me.error = null;
  try {
    const [st, due] = await Promise.all([
      invoke("learn_state", { domain, packsDir }),
      invoke("learn_due", { domain, packsDir }),
    ]);
    if (seq !== state.me.seq) return;
    state.me.state = st || null;
    state.me.due = due || null;
  } catch (e) {
    if (seq !== state.me.seq) return;
    state.me.error = "读取学习账本失败：" + readableErr(e);
  } finally {
    if (seq === state.me.seq) state.me.loading = false;
  }
}

function refreshMe() {
  if (state.tab === "me" && state.me.view) paintMe(state.me.view);
}

function paintMe(view) {
  const st = state.me.state;
  const d = state.me.due;
  const weak = (d && d.weak) || [];
  const due = (d && d.due) || [];
  const domain = getDomain();
  const busy = state.me.busy;

  let html = `<div class="me">
    <div class="me-head">
      <h1>我的</h1>
      <div class="me-sub mono muted">${domain ? "域：" + esc(domain) : "默认账号域"}${st && st.domain ? " · " + esc(st.domain) : ""}</div>
      ${st && st.path ? `<div class="me-path mono muted">user.md：${esc(st.path)}</div>` : ""}
    </div>`;

  if (state.me.error) html += `<div class="me-err">${esc(state.me.error)}</div>`;
  if (state.me.msg) html += `<div class="me-msg">${esc(state.me.msg)}</div>`;

  html += `<div class="me-stats">${[
    ["今日作答", d ? d.today_answers : "—"],
    ["今日错题", d ? d.today_wrong : "—"],
    ["薄弱知识点", d ? weak.length : "—"],
    ["今日待复习", d ? due.length : "—"],
  ]
    .map(([l, n], i) => `<div class="me-stat reveal" style="--i:${i}"><div class="n">${esc(String(n))}</div><div class="l">${esc(l)}</div></div>`)
    .join("")}</div>`;

  html += `<div class="actions">
    <button class="btn" id="me-sync" ${busy ? "disabled" : ""}>${busy === "sync" ? "同步中…" : "同步域"}</button>
    <button class="btn btn-ghost" id="me-delegate" ${busy ? "disabled" : ""}>${busy === "delegate" ? "导出中…" : "导出今日错题"}</button>
    <button class="btn btn-ghost" id="me-review" ${busy ? "disabled" : ""}>${busy === "review" ? "处理中…（调用模型，较慢）" : "处理域内委托"}</button>
    <span class="mono muted">${state.me.loading ? "读取中…" : d ? "事件 " + esc(String(d.events_total ?? 0)) + " 条 · 节点 " + esc(String(arrOf(d.nodes).length)) + " 个" : ""}</span>
  </div>`;

  const sy = state.me.sync;
  if (sy) {
    const per = sy.per_node || {};
    const keys = Object.keys(per);
    html += `<section class="me-block">
      <div class="block-label">同步结果</div>
      <div class="me-kv"><span>节点</span><b class="mono">${esc(sy.node || "—")}</b></div>
      <div class="me-kv"><span>域</span><b class="mono">${esc(sy.domain || "")}</b></div>
      <div class="me-kv"><span>事件总数</span><b>${esc(String(sy.events_total ?? 0))}</b></div>
      <div class="me-kv"><span>薄弱 / 待复习</span><b>${esc(String(sy.weak ?? 0))} / ${esc(String(sy.due ?? 0))}</b></div>
      <div class="me-kv"><span>user.md</span><b class="mono">${esc(sy.user_md || "—")}</b></div>
      <div class="me-kv"><span>待处理委托</span><b>${arrOf(sy.pending_delegations).length ? arrOf(sy.pending_delegations).map(esc).join("、") : "无"}</b></div>
      <div class="me-pernode">${
        keys.length ? keys.map((k) => `<span class="me-tag">${esc(k)} <b>${esc(String(per[k]))}</b></span>`).join("") : `<span class="muted">（尚无节点账本）</span>`
      }</div>
    </section>`;
  }

  const rv = state.me.review;
  if (rv) {
    const done = arrOf(rv.processed);
    html += `<section class="me-block">
      <div class="block-label">委托处理</div>
      <div class="me-kv"><span>处理前待办</span><b>${esc(String(rv.pending_before ?? 0))}</b></div>
      ${
        done.length
          ? done
              .map(
                (x, i) =>
                  `<div class="me-kv"><span>${esc(String(x.src || "委托 " + (i + 1)))}</span><b>${esc(x.ok ? "已生成" : "校验未通过")} · 尝试 ${esc(String(x.attempts ?? 1))} 次 → ${esc(String(x.result || ""))}</b></div>`
              )
              .join("")
          : `<div class="hint">没有处理任何委托。</div>`
      }
    </section>`;
  }

  html += `<section class="me-block">
    <div class="block-label">薄弱知识点（${weak.length}）</div>
    ${weak.length ? meTable(weak, false) : `<div class="hint">还没有薄弱项 —— 先去学习页做几道题，答错的会自动进这张表。</div>`}
  </section>`;

  html += `<section class="me-block">
    <div class="block-label">今日复习队列（${due.length}）</div>
    ${due.length ? meTable(due, true) : `<div class="hint">今日没有到期的复习。</div>`}
  </section>`;

  const md = st && st.userMd ? stripFrontMatter(st.userMd) : "";
  html += `<section class="me-block">
    <details class="me-md" open>
      <summary><span class="block-label">user.md 全文</span><span class="mono muted">${md ? esc(String(String(st.userMd).length)) + " 字符" : "尚未生成"}</span></summary>
      <div class="me-md-body">${md ? mdToHtml(md) : `<div class="hint">还没有学员档案。做几道题后会自动生成。</div>`}</div>
    </details>
  </section>`;

  view.innerHTML = html + "</div>";

  const bSync = view.querySelector("#me-sync");
  if (bSync) bSync.onclick = runMeSync;
  const bDel = view.querySelector("#me-delegate");
  if (bDel) bDel.onclick = runMeDelegate;
  const bRev = view.querySelector("#me-review");
  if (bRev) bRev.onclick = runMeReview;
  view.querySelectorAll(".me-go").forEach((b) => {
    b.onclick = () => startReview(b.dataset.pack, b.dataset.kc);
  });
  observeReveals(view);
}

function meTable(rows, withAction) {
  return `<div class="me-table-wrap"><table class="me-table">
    <thead><tr><th>知识点</th><th>掌握度</th><th>对 / 错</th><th>连对</th><th>下次到期</th>${withAction ? "<th></th>" : ""}</tr></thead>
    <tbody>${rows
      .map((k) => {
        const m = Math.max(0, Math.min(100, Math.round((Number(k.mastery) || 0) * 100)));
        return `<tr>
        <td><div class="me-kc">${esc(k.kc_name || k.kc_id || "")}</div><div class="me-kc-sub mono">${esc(k.pack || "")}${k.attempts != null ? " · 作答 " + esc(String(k.attempts)) : ""}</div></td>
        <td><span class="me-meter"><span style="width:${m}%"></span></span><span class="mono">${esc(pct(k.mastery))}</span></td>
        <td class="mono">${esc(String(k.correct ?? 0))} / ${esc(String(k.wrong ?? 0))}</td>
        <td class="mono">${esc(String(k.streak ?? 0))}</td>
        <td class="mono">${esc(dueLabel(k.due_ts, k.mastered))}</td>
        ${withAction ? `<td><button class="btn btn-ghost me-go" data-pack="${esc(k.pack || "")}" data-kc="${esc(k.kc_id || "")}">开始复习</button></td>` : ""}
      </tr>`;
      })
      .join("")}</tbody>
  </table></div>`;
}

/* 跳到学习页对应知识点（必要时先切到该 KC 所属学科包） */
async function startReview(packId, kcId) {
  const target = (state.packs || []).find((p) => p.subjectId === packId);
  const cur = state.current?.meta?.id || null;
  if (target && target.path && cur !== packId) {
    await openPack(target.path);
  }
  state.learn.kcId = kcId || null;
  state.learn.ai = null;
  state.learn.aiError = null;
  state.learn.pick = null;
  state.learn.classify = null;
  setTab("learn");
}

async function runMeSync() {
  const domain = getDomain();
  const packsDir = packsDirValue();
  state.me.busy = "sync";
  state.me.msg = "";
  state.me.error = null;
  refreshMe();
  try {
    const sy = await invoke("learn_sync", { domain, packsDir });
    state.me.sync = sy || null;
    state.me.msg = "同步完成：事件 " + ((sy && sy.events_total) || 0) + " 条 · 节点 " + Object.keys((sy && sy.per_node) || {}).length + " 个 · 待处理委托 " + arrOf(sy && sy.pending_delegations).length + " 份";
    await loadMe();
  } catch (e) {
    state.me.error = "同步失败：" + readableErr(e);
  }
  state.me.busy = null;
  refreshMe();
}

async function runMeDelegate() {
  const domain = getDomain();
  const packsDir = packsDirValue();
  state.me.busy = "delegate";
  state.me.msg = "";
  state.me.error = null;
  refreshMe();
  try {
    const r = await invoke("learn_delegate", { domain, packsDir });
    if (r && r.exported) {
      state.me.msg = "已导出今日错题委托：" + (r.count || 0) + " 条 → " + (r.file || "");
    } else {
      state.me.msg = "没有可导出的错题" + (r && r.reason ? "（" + r.reason + "）" : "");
    }
    await loadMe();
  } catch (e) {
    state.me.error = "导出失败：" + readableErr(e);
  }
  state.me.busy = null;
  refreshMe();
}

async function runMeReview() {
  const domain = getDomain();
  const packsDir = packsDirValue();
  state.me.busy = "review";
  state.me.msg = "";
  state.me.error = null;
  state.me.review = null;
  refreshMe();
  try {
    const r = await invoke("learn_review", { domain, packsDir, limit: 3 });
    state.me.review = r || null;
    const n = arrOf(r && r.processed).length;
    state.me.msg = n ? "已处理 " + n + " 份委托（处理前待办 " + ((r && r.pending_before) || 0) + "）" : "没有待处理的域内委托" + (r && r.pending_before ? "（处理前待办 " + r.pending_before + "）" : "");
    await loadMe();
  } catch (e) {
    state.me.error = "处理委托失败：" + readableErr(e);
  }
  state.me.busy = null;
  refreshMe();
}

/* ══════════ 设置 ══════════ */
function renderSettings(view) {
  const c = state.config || {};
  const p = (c.providers || [])[c.active || 0] || {};
  const presets = state.presets || [];
  const activePreset = p.preset || "nvidia";
  const preset = presets.find((x) => x.id === activePreset) || presets[0] || { models: [], baseUrl: "" };
  const models = preset.models || [];

  view.innerHTML = `
    <div class="settings">
      <h1>设置</h1>
      <p class="muted">纯 API 接入（OpenAI 兼容协议）。Key 只存在本机应用配置目录，不在仓库内。</p>

      <div class="field">
        <label>模型提供方</label>
        <select id="s-provider">
          ${presets.map((x) => `<option value="${esc(x.id)}" ${x.id === activePreset ? "selected" : ""}>${esc(x.label)}</option>`).join("")}
        </select>
      </div>

      <div class="field">
        <label>Base URL</label>
        <input id="s-base" type="text" value="${esc(p.base_url || preset.baseUrl || "")}" spellcheck="false" />
      </div>

      <div class="field">
        <label>API Key</label>
        <input id="s-key" type="password" value="${esc(p.api_key || "")}" placeholder="nvapi-... 或 sk-..." spellcheck="false" />
      </div>

      <div class="field">
        <label>模型</label>
        <input id="s-model" type="text" value="${esc(p.model || models[0] || "")}" list="model-list" spellcheck="false" />
        <datalist id="model-list">${models.map((m) => `<option value="${esc(m)}"></option>`).join("")}</datalist>
      </div>

      <div class="field">
        <label>思考强度</label>
        <select id="s-thinking">
          ${[["fast", "快速（低成本）"], ["normal", "标准"], ["deep", "深度（强模型档）"]]
            .map(([v, l]) => `<option value="${v}" ${(c.thinking || "normal") === v ? "selected" : ""}>${l}</option>`)
            .join("")}
        </select>
      </div>

      <div class="actions">
        <button class="btn" id="s-save">保存配置</button>
        <span class="mono muted" id="s-status"></span>
      </div>
      <p class="settings-note mono">配置文件：${esc(state.configPath || "")}</p>
      <p class="settings-note muted">提示：NVIDIA NIM 的 Base URL 为 <code>https://integrate.api.nvidia.com/v1</code>，实测可用模型如 <code>deepseek-ai/deepseek-v4.1-flash</code>、<code>nvidia/nemotron-3-super-120b-a12b</code>（清单以 <code>GET /v1/models</code> 为准）。</p>
    </div>`;

  const provSel = view.querySelector("#s-provider");
  provSel.onchange = () => {
    const pid = provSel.value;
    const ps = presets.find((x) => x.id === pid);
    view.querySelector("#s-base").value = ps ? ps.baseUrl : "";
    view.querySelector("#s-model").value = ps && ps.models.length ? ps.models[0] : "";
    const dl = view.querySelector("#model-list");
    dl.innerHTML = (ps ? ps.models : []).map((m) => `<option value="${esc(m)}"></option>`).join("");
  };

  view.querySelector("#s-save").onclick = async () => {
    const cfg = {
      providers: [
        {
          preset: provSel.value,
          base_url: view.querySelector("#s-base").value.trim(),
          api_key: view.querySelector("#s-key").value.trim(),
          model: view.querySelector("#s-model").value.trim(),
        },
      ],
      active: 0,
      thinking: view.querySelector("#s-thinking").value,
    };
    try {
      await invoke("set_config", { config: cfg });
      await loadConfig();
      view.querySelector("#s-status").textContent = "已保存";
    } catch (e) {
      view.querySelector("#s-status").textContent = "保存失败: " + e;
    }
  };
  window.__settingsBind = true;
}

/* ══════════ 题目 / 知识树 / 报告（沿用） ══════════ */
function renderItems(view) {
  const { items, kcs } = state.current;
  if (!items.length) return viewMessage("包内暂无题目");
  view.innerHTML = items
    .map((it, idx) => {
      const isChoice = it.type === "single_choice" || it.type === "multi_choice";
      const opts = isChoice
        ? arrOf(it.options)
            .map((o) => {
              const correct = o.key === it.answer;
              return `<div class="opt ${correct ? "correct" : ""}"><span class="key">${esc(o.key)}</span><span>${esc(o.text)}</span>${correct ? CHECK_SVG : ""}</div>`;
            })
            .join("")
        : `<div class="opt">${esc(it.answer_text || it.answer || "")}</div>`;
      const tags = arrOf(it.kc_ids).map((k) => `<span class="kc-tag">${esc(kcName(k))}</span>`).join("");
      return `<div class="acc reveal" style="--i:${idx}">
        <div class="acc-head" data-idx="${idx}">
          <span class="item-stem">${idx + 1}. ${esc(it.stem)}</span>
          <span style="display:flex;align-items:center;gap:12px"><span class="item-type">${esc(it.type)}</span><span class="toggle">+</span></span>
        </div>
        <div class="acc-body hidden">
          <div style="margin-bottom:10px">${tags}</div>
          ${opts}
          ${it.analysis ? `<div class="analysis"><b>解析</b>　${esc(it.analysis)}</div>` : ""}
          <div class="meta-line">origin: ${esc(it.origin?.source_type || "未标注")}</div>
        </div>
      </div>`;
    })
    .join("");
  view.querySelectorAll(".acc-head").forEach((h) => {
    h.onclick = () => {
      const body = h.nextElementSibling;
      body.classList.toggle("hidden");
      h.querySelector(".toggle").textContent = body.classList.contains("hidden") ? "+" : "−";
    };
  });
  observeReveals(view);
}

function renderTree(view) {
  const { kcs, prereqs, items } = state.current;
  const countByKc = {};
  for (const it of items) for (const k of arrOf(it.kc_ids)) countByKc[k] = (countByKc[k] || 0) + 1;

  let html = "";
  if (prereqs.length) {
    html += `<div class="edge-list reveal"><b>先修关系</b>（先修 → 后继）<br>${prereqs
      .map((e) => `${esc(kcName(e.from))} <code>—${e.strength === "hard" ? "硬" : "软"}→</code> ${esc(kcName(e.to))}</code>`)
      .join("<br>")}</div>`;
  }
  html += kcs
    .map((k, i) => {
      const n = countByKc[k.id] || 0;
      return `<div class="kc-card reveal" style="--i:${i}">
        <div class="kc-head"><span class="kc-name">${esc(k.name)}</span><span class="kc-count">${n} 题</span></div>
        <div class="kc-toc">${esc(arrOf(k.toc).join(" › "))}</div>
        <div class="kc-meta">
          <span>${esc(k.id)}</span>
          ${k.difficulty != null ? `<span>难度 ${k.difficulty}</span>` : ""}
          ${k.bloom ? `<span>${esc(k.bloom)}</span>` : ""}
          ${n === 0 ? `<span class="kc-dangling">无题挂载</span>` : ""}
        </div>
      </div>`;
    })
    .join("");
  view.innerHTML = html;
  observeReveals(view);
}

function renderReport(view) {
  const r = state.current.report;
  const stats = `<div class="report-stats">${[
    ["知识点", r.kc_count],
    ["先修边", r.edge_count],
    ["题目", r.item_count],
    ["挂载率", Math.round(r.coverage_pct) + "%"],
    ["错误", r.error_count],
    ["警告", r.warning_count],
  ]
    .map(([l, n], i) => `<div class="stat reveal" style="--i:${i}"><div class="n">${n}</div><div class="l">${l}</div></div>`)
    .join("")}</div>`;
  const issues = (r.issues || [])
    .map((i, idx) => `<div class="issue ${i.level} reveal" style="--i:${idx}"><code>[${esc(i.code)}]</code> ${esc(i.file)} — ${esc(i.msg)}</div>`)
    .join("");
  view.innerHTML = stats + (issues || `<div class="empty">没有任何问题</div>`);
  observeReveals(view);
}

/* ══════════ 工具 ══════════ */
const CHECK_SVG =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#346538" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
const CROSS_SVG =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9f2f2d" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';

function arrOf(v) {
  return Array.isArray(v) ? v : v == null ? [] : [v];
}
function kcName(id) {
  const k = (state.current?.kcs || []).find((x) => x.id === id);
  return k ? k.name : id;
}
function hasTools(h) {
  const a = arrOf(h).filter((x) => x && x !== "none");
  return a.length > 0;
}
function labelErrorType(t) {
  return (
    {
      none: "没有错误",
      knowledge_missing: "知识缺失",
      concept_confused: "概念混淆",
      method_missing: "方法未掌握",
      calculation_slip: "计算失误",
      misread: "审题错误",
    }[t] || t || "—"
  );
}
function labelAction(a) {
  return (
    {
      review_prereq: "回补先修",
      re_explain: "重讲一遍",
      drill_similar: "做同类题",
      split_concept: "拆解概念",
      retry_later: "稍后再练",
      none: "无需处理",
    }[a] || a || "—"
  );
}

/* 极简 Markdown 渲染（先转义，再还原结构） */
function mdToHtml(md) {
  const lines = String(md || "").split(/\r?\n/);
  const inline = (s) =>
    esc(s)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>");
  let html = "";
  let inList = false;
  const closeList = () => {
    if (inList) {
      html += "</ul>";
      inList = false;
    }
  };
  for (const raw of lines) {
    const l = raw.trimEnd();
    if (/^\s*[-*]\s+/.test(l)) {
      if (!inList) {
        html += "<ul>";
        inList = true;
      }
      html += "<li>" + inline(l.replace(/^\s*[-*]\s+/, "")) + "</li>";
      continue;
    }
    closeList();
    if (/^####\s/.test(l)) html += "<h4>" + inline(l.slice(5)) + "</h4>";
    else if (/^###\s/.test(l)) html += "<h3>" + inline(l.slice(4)) + "</h3>";
    else if (/^##\s/.test(l)) html += "<h3>" + inline(l.slice(3)) + "</h3>";
    else if (/^#\s/.test(l)) html += "<h2>" + inline(l.slice(2)) + "</h2>";
    else if (/^>\s?/.test(l)) html += "<blockquote>" + inline(l.replace(/^>\s?/, "")) + "</blockquote>";
    else if (l.trim() === "") html += "";
    else html += "<p>" + inline(l) + "</p>";
  }
  closeList();
  return html;
}

let observer = null;
function observeReveals(container) {
  // root 必须为 null（视口）：左侧栏不在 #view 内，用 #view 当 root 会让侧栏永远不可见
  if (!observer) {
    observer = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (en.isIntersecting) {
            en.target.classList.add("in");
            observer.unobserve(en.target);
          }
        }
      },
      { root: null, threshold: 0.01 }
    );
  }
  container.querySelectorAll(".reveal:not(.in)").forEach((el) => observer.observe(el));
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function viewMessage(msg) {
  document.getElementById("view").innerHTML = `<div class="empty">${esc(msg)}</div>`;
}

boot();
