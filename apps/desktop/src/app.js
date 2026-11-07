/* WORDO 桌面壳 —— 前端逻辑（薄壳：全部能力在 wordo-core） */
"use strict";

const DEFAULT_PACKS_DIR = "F:/去中心化分布式跨平台自进化ai学习系统/packs";
const { invoke } = window.__TAURI__.core;

const state = {
  packs: [],
  current: null,
  tab: "home",
  config: null,
  presets: [],
  configPath: "",
  learn: { kcId: null, ai: null, aiLoading: false, aiError: null, pick: null, classify: null, classifyLoading: false },
  /* 首页控制台（旧，保留兼容） */
  home: { q: "", msg: "", loading: false },
  /* 会话（chat-first） */
  chats: [],
  currentChatId: null,
  chat: null,
  chatBusy: false,
  chatDraft: "",
  chatMsg: "",
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
  document.querySelectorAll(".tabbar-btn").forEach((t) => {
    t.onclick = () => setTab(t.dataset.tab);
  });
  const newChatBtn = document.getElementById("btn-new-chat");
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
  });
  document.querySelectorAll(".side-link[data-tab]").forEach((b) => {
    b.onclick = () => setTab(b.dataset.tab);
  });
  const sb = document.getElementById("subject-btn");
  if (sb) sb.onclick = openSubjectSheet;
  const sc = document.getElementById("sheet-close");
  if (sc) sc.onclick = closeSubjectSheet;
  const sheet = document.getElementById("subject-sheet");
  if (sheet) sheet.addEventListener("click", (e) => { if (e.target === sheet) closeSubjectSheet(); });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeSubjectSheet();
    // 首页数字快捷键：输入框为空时也生效（输入框非空时让位给打字）
    if (state.tab === "home" && /^[1-9]$/.test(e.key)) {
      const tag = ((e.target && e.target.tagName) || "").toLowerCase();
      const inField = tag === "input" || tag === "textarea" || tag === "select";
      const empty = inField && tag === "input" ? !String(e.target.value || "").trim() : false;
      if (inField && !empty) return;
      const a = homeActions()[Number(e.key) - 1];
      if (a) { e.preventDefault(); a.run(); }
    }
  });
  // 软键盘避让：把键盘高度写进 CSS 变量（手机端）
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
  await loadConfig();
  await refreshPacks();
  // 对话优先：打开最近一次会话；没有就新建
  await loadChats();
  const first = state.chats[0];
  if (first) await openChat(first.id);
  else await newChat();
  setTab("chat");
}

function setTab(tab) {
  state.tab = tab;
  document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x.dataset.tab === tab));
  document.querySelectorAll(".tabbar-btn").forEach((x) => x.classList.toggle("active", x.dataset.tab === tab));
  document.body.dataset.tab = tab;
  document.getElementById("tabs").classList.remove("hidden");
  render();
  const v = document.getElementById("view");
  if (v) v.scrollTop = 0;
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
  // 侧栏已改为「对话历史」；这里只负责顶栏学科胶囊与选择浮层
  paintSubjectBar();
  const el = document.getElementById("pack-list");
  if (!el) return;
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
    btn.onclick = () => { openPack(p.path); closeSubjectSheet(); };
    el.appendChild(btn);
  });
  observeReveals(el);
}

/** 顶栏「当前学科」+ 学科选择浮层内容 */
function paintSubjectBar() {
  const cur = state.current && state.current.meta;
  const name = cur ? (cur.name || cur.id || "学科") : (state.packs[0] ? state.packs[0].name : "选择学科");
  const nameEl = document.getElementById("subject-name");
  if (nameEl) nameEl.textContent = name || "选择学科";
  const list = document.getElementById("subject-sheet-list");
  if (list) {
    list.innerHTML = state.packs.length
      ? state.packs
          .map((p) => {
            const active = cur && cur.id === p.subjectId;
            return `<button class="sheet-item ${active ? "active" : ""}" data-path="${esc(p.path)}">
              <span class="sheet-item-name">${esc(p.name || p.subjectId || "未命名")}</span>
              <span class="sheet-item-sub mono">${esc(p.subjectId || "")} · ${p.kcCount} KC · ${p.itemCount} 题</span>
            </button>`;
          })
          .join("")
      : `<div class="empty">没有学科包</div>`;
    list.querySelectorAll(".sheet-item").forEach((b) => {
      b.onclick = () => { openPack(b.dataset.path, { stayInChat: state.tab === "chat" }); closeSubjectSheet(); };
    });
  }
}

function openSubjectSheet() {
  const s = document.getElementById("subject-sheet");
  if (!s) return;
  paintSubjectBar();
  s.classList.remove("hidden");
  document.body.classList.add("sheet-open");
}
function closeSubjectSheet() {
  const s = document.getElementById("subject-sheet");
  if (s) s.classList.add("hidden");
  document.body.classList.remove("sheet-open");
}


async function openPack(path, opts) {
  const stay = !!(opts && opts.stayInChat);
  try {
    state.current = await invoke("load_pack", { packPath: path });
  } catch (e) {
    viewMessage("加载失败: " + e);
    return;
  }
  state.learn = { kcId: null, ai: null, aiLoading: false, aiError: null, pick: null, classify: null, classifyLoading: false };
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
  setTab("learn");
  // 顺手拉一次学习状态，让学习页能显示「薄弱 / 掌握度」标记
  if (!state.me.due) {
    invoke("learn_due", { domain: getDomain(), packsDir: packsDirValue() })
      .then((d) => { state.me.due = d || null; if (state.tab === "learn") render(); })
      .catch(() => {});
  }
}

/* ══════════ 主视图分发 ══════════ */
/* ══════════ 首页：控制台（CLI 风格入口） ══════════ */
function greetingWord() {
  const h = new Date().getHours();
  if (h < 6) return "凌晨好";
  if (h < 11) return "早上好";
  if (h < 14) return "中午好";
  if (h < 18) return "下午好";
  return "晚上好";
}

/** 根据真实账本算出「今天能干什么」的编号动作 */
function homeActions() {
  const d = state.me.due;
  const due = (d && d.due) || [];
  const weak = (d && d.weak) || [];
  const kcs = (state.current && state.current.kcs) || [];
  const seen = new Set([...due, ...weak].map((x) => x.kc_id));
  const fresh = kcs.find((k) => !seen.has(k.id)) || null;
  const A = [];
  if (due.length)
    A.push({ key: "review", name: "继续复习", desc: `${due[0].kc_name} · 错 ${due[0].wrong} 次 · 掌握度 ${pct(due[0].mastery)} · 已到期`, run: () => startReview(due[0].pack, due[0].kc_id) });
  if (weak.length)
    A.push({ key: "weak", name: due.length ? "再攻一个薄弱点" : "攻克薄弱点", desc: `${weak[0].kc_name} · 掌握度 ${pct(weak[0].mastery)} · 错 ${weak[0].wrong} 次`, run: () => startReview(weak[0].pack, weak[0].kc_id) });
  if (fresh) A.push({ key: "new", name: "学新内容", desc: `${fresh.name} · ${state.current ? state.current.meta.name || state.current.meta.id : ""}`, run: () => { state.learn.kcId = fresh.id; state.learn.ai = null; setTab("learn"); } });
  else if (kcs.length) A.push({ key: "learn", name: "进入学习", desc: "挑一个知识点看讲解 / 做题", run: () => setTab("learn") });
  A.push({ key: "me", name: "看看我的账本", desc: "薄弱点 · 复习队列 · user.md 全文", run: () => setTab("me") });
  A.push({ key: "settings", name: "设置模型与学科包", desc: hasKey() ? "已配置 · " + activeModelLabel() : "还没有配置 API Key", run: () => setTab("settings") });
  return A;
}

function renderHome(view) {
  if (!state.me.due) loadHomeData();
  const d = state.me.due;
  const node = (d && arrOf(d.nodes)[0]) || "local";
  const actions = homeActions();
  const t = new Date();
  const dateStr = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")} 周${"日一二三四五六"[t.getDay()]}`;
  const recap = d
    ? `今日作答 ${d.today_answers} · 错 ${d.today_wrong} · 薄弱 ${(d.weak || []).length} · 到期 ${(d.due || []).length}`
    : "正在读取学习账本…";
  const subj = state.current ? state.current.meta.name || state.current.meta.id : "未选择学科";

  view.innerHTML = `
  <div class="console">
    <div class="console-bar mono">
      <span class="dot"></span><span class="console-path">wordo</span>
      <span class="sep">·</span><span>${esc(node)}</span>
      <span class="sep">·</span><span>${esc(dateStr)}</span>
      <span class="console-bar-right">${esc(subj)}</span>
    </div>

    <div class="console-grid">
      <div class="console-main">
        <h1 class="console-title">${greetingWord()}，今天想学点什么？<span class="caret">▌</span></h1>
        <div class="console-recap mono">${esc(recap)}</div>

        <ol class="cmds">
          ${actions
            .map(
              (a, i) => `<li><button class="cmd" data-idx="${i}">
                <span class="cmd-k mono">${i + 1}</span>
                <span class="cmd-body"><span class="cmd-name">${esc(a.name)}</span><span class="cmd-desc mono">${esc(a.desc)}</span></span>
                <span class="cmd-arrow">→</span>
              </button></li>`
            )
            .join("")}
        </ol>

        <form class="console-prompt" id="home-form" autocomplete="off">
          <span class="prompt-sign mono">›</span>
          <input id="home-input" autocomplete="off" spellcheck="false" placeholder="${isPhone() ? "输入 /复习、/讲解…" : "输入命令，或直接说「讲解 一般过去时」…"}" />
          <button class="btn" type="submit">执行</button>
        </form>
        <div class="console-hints mono">/复习　/薄弱　/讲解 一般过去时　/计划　/同步　/账本　/设置　·　按 1–5 直接执行</div>
        ${state.home.msg ? `<div class="console-msg">${esc(state.home.msg)}</div>` : ""}
      </div>

      <aside class="console-side">
        <div class="side-block">
          <div class="side-label mono">今日</div>
          <div class="side-kpis">
            <div><b>${d ? d.today_answers : "—"}</b><span>作答</span></div>
            <div><b>${d ? d.today_wrong : "—"}</b><span>错题</span></div>
            <div><b>${d ? (d.due || []).length : "—"}</b><span>到期</span></div>
          </div>
        </div>
        <div class="side-block">
          <div class="side-label mono">到期复习</div>
          ${(d && d.due && d.due.length)
            ? d.due.slice(0, 3).map((k) => `<button class="side-row" data-pack="${esc(k.pack || "")}" data-kc="${esc(k.kc_id || "")}"><span class="side-row-name">${esc(k.kc_name || k.kc_id)}</span><span class="side-row-meta mono">${esc(pct(k.mastery))}</span></button>`).join("")
            : `<div class="side-empty">暂无到期</div>`}
        </div>
        <div class="side-block">
          <div class="side-label mono">薄弱点</div>
          ${(d && d.weak && d.weak.length)
            ? d.weak.slice(0, 3).map((k) => `<div class="side-row static"><span class="side-row-name">${esc(k.kc_name || k.kc_id)}</span><span class="side-row-meta mono">错 ${esc(String(k.wrong || 0))} · ${esc(pct(k.mastery))}</span></div>`).join("")
            : `<div class="side-empty">暂无薄弱项</div>`}
        </div>
        <div class="side-block">
          <div class="side-label mono">学习计划</div>
          ${(() => {
            const plan = (state.me.plan || []).filter((x) => !x.done).slice(0, 3);
            return plan.length ? plan.map((x) => `<div class="side-row static"><span class="side-row-name">${esc(x.text)}</span></div>`).join("") : `<div class="side-empty">暂无待办</div>`;
          })()}
        </div>
      </aside>
    </div>
  </div>`;

  view.querySelectorAll(".cmd").forEach((b) => {
    b.onclick = () => {
      const a = actions[Number(b.dataset.idx)];
      if (a) a.run();
    };
  });
  view.querySelectorAll(".side-row[data-kc]").forEach((b) => {
    b.onclick = () => startReview(b.dataset.pack, b.dataset.kc);
  });
  const form = view.querySelector("#home-form");
  if (form) form.onsubmit = (e) => { e.preventDefault(); runHomeCommand(view.querySelector("#home-input").value); };
  const inp = view.querySelector("#home-input");
  if (inp) { if (state.home.q) inp.value = state.home.q; inp.focus(); }
  observeReveals(view);
}

async function loadHomeData() {
  if (state.home.loading) return;
  state.home.loading = true;
  const domain = getDomain();
  const packsDir = packsDirValue();
  try {
    const [due, plan] = await Promise.all([
      invoke("learn_due", { domain, packsDir }),
      invoke("learn_plan", { domain, action: "list" }),
    ]);
    state.me.due = due || null;
    state.me.plan = (plan && plan.plan) || [];
  } catch (e) {
    state.home.msg = "读取学习账本失败：" + readableErr(e);
  } finally {
    state.home.loading = false;
  }
  if (state.tab === "home") render();
}

/** 首页命令：/复习 /薄弱 /讲解 X /计划 /同步 /账本 /设置；也支持点数字与自由文本 */
function runHomeCommand(raw) {
  const t = String(raw || "").trim();
  state.home.q = t;
  if (!t) return;
  const actions = homeActions();
  const findKc = (name) => {
    const kcs = (state.current && state.current.kcs) || [];
    const n = name.trim();
    return kcs.find((k) => k.id === n) || kcs.find((k) => k.name === n) || kcs.find((k) => n && (k.name.includes(n) || n.includes(k.name))) || null;
  };
  if (/^\d+$/.test(t)) {
    const a = actions[Number(t) - 1];
    if (a) return a.run();
  }
  const m = t.match(/^\/(\S+)\s*(.*)$/);
  const cmd = m ? m[1] : "";
  const rest = m ? m[2].trim() : t;
  const goKc = (kc) => {
    state.learn.kcId = kc.id;
    state.learn.ai = null;
    setTab("learn");
  };
  switch (cmd) {
    case "复习": case "review": {
      const a = actions.find((x) => x.key === "review");
      if (a) return a.run();
      state.home.msg = "今天没有到期复习。去学习页随便做几道吧。";
      return render();
    }
    case "薄弱": case "weak": {
      const a = actions.find((x) => x.key === "weak");
      if (a) return a.run();
      state.home.msg = "目前没有薄弱项（都掌握了，或还没开始做题）。";
      return render();
    }
    case "讲解": case "explain": {
      const kc = findKc(rest);
      if (!kc) {
        state.home.msg = `没找到「${rest || "（空）"}」。可用知识点：${((state.current && state.current.kcs) || []).map((k) => k.name).join("、") || "（先选择学科包）"}`;
        return render();
      }
      goKc(kc);
      setTimeout(() => { const b = document.querySelector("#btn-ai"); if (b) b.click(); }, 80);
      return;
    }
    case "计划": case "plan": return setTab("me");
    case "同步": case "sync": setTab("me"); setTimeout(() => document.querySelector("#me-sync") && document.querySelector("#me-sync").click(), 150); return;
    case "账本": case "me": return setTab("me");
    case "设置": case "config": return setTab("settings");
    default: {
      // 自由文本：先当知识点名，再当「复习/薄弱」关键词
      const kc = findKc(t);
      if (kc) { goKc(kc); setTimeout(() => { const b = document.querySelector("#btn-ai"); if (b) b.click(); }, 80); return; }
      if (/复习|做题|练/.test(t)) { const a = actions.find((x) => x.key === "review") || actions.find((x) => x.key === "weak"); if (a) return a.run(); }
      state.home.msg = `没认出这条命令。试试：/复习 · /薄弱 · /讲解 一般过去时 · /计划`;
      return render();
    }
  }
}

function render() {
  const view = document.getElementById("view");
  if (state.tab === "chat") return renderChat(view);
  if (state.tab === "settings") return renderSettings(view);
  if (state.tab === "me") return renderMe(view);
  if (!state.current) return viewMessage("从左侧选择一个学科包");
  if (state.tab === "learn") renderLearn(view);
  else if (state.tab === "items") renderItems(view);
  else if (state.tab === "tree") renderTree(view);
  else renderReport(view);
}

/* ══════════ 会话（chat-first：侧栏=对话历史，学科自动判定） ══════════ */

function packOf(subjectId) {
  return (state.packs || []).find((p) => p.subjectId === subjectId) || null;
}

async function loadChats() {
  try {
    const r = await invoke("chat_list", { domain: getDomain() });
    state.chats = (r && r.chats) || [];
  } catch (e) {
    state.chats = [];
  }
  renderChatList();
}

function renderChatList() {
  const el = document.getElementById("chat-list");
  if (!el) return;
  if (!state.chats.length) {
    el.innerHTML = `<div class="chat-empty">还没有对话</div>`;
    return;
  }
  el.innerHTML = state.chats
    .map(
      (c) => `<button class="chat-item ${c.id === state.currentChatId ? "active" : ""}" data-id="${esc(c.id)}">
        <span class="chat-item-t">${esc(c.title || "新对话")}</span>
        <span class="chat-item-m mono">${c.pack ? esc(c.pack) : "未定学科"} · ${c.count} 条</span>
        <span class="chat-item-x" data-del="${esc(c.id)}" title="删除会话">×</span>
      </button>`
    )
    .join("");
  el.querySelectorAll(".chat-item").forEach((b) => {
    b.onclick = (e) => {
      if (e.target.dataset && e.target.dataset.del) return;
      openChat(b.dataset.id);
    };
  });
  el.querySelectorAll("[data-del]").forEach((x) => {
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
    el.innerHTML = `<div class="chat-empty">还没有对话</div>`;
    return;
  }
  el.innerHTML = state.chats
    .map(
      (c) => `<div class="drawer-item ${c.id === state.currentChatId ? "active" : ""}">
        <button class="drawer-item-main" data-id="${esc(c.id)}">
          <span class="drawer-item-t">${esc(c.title || "新对话")}</span>
          <span class="drawer-item-m mono">${c.pack ? esc(c.pack) : "未定学科"} · ${c.count} 条</span>
        </button>
        <button class="drawer-item-x" data-del2="${esc(c.id)}" aria-label="删除">×</button>
      </div>`
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
}

async function newChat() {
  try {
    const c = await invoke("chat_new", { domain: getDomain(), title: "" });
    state.currentChatId = c.id;
    state.chat = c;
    state.chatDraft = "";
    await loadChats();
    setTab("chat");
  } catch (e) {
    state.chatMsg = "新建对话失败：" + readableErr(e);
    render();
  }
}

async function openChat(id) {
  state.currentChatId = id;
  try {
    state.chat = await invoke("chat_get", { domain: getDomain(), id });
  } catch (e) {
    state.chat = null;
    state.chatMsg = "读取会话失败：" + readableErr(e);
  }
  if (state.chat && state.chat.pack) await ensurePack(state.chat.pack);
  renderChatList();
  setTab("chat");
}

async function ensurePack(subjectId) {
  if (!subjectId) return false;
  if (state.current && state.current.meta && state.current.meta.id === subjectId) return true;
  const p = packOf(subjectId);
  if (!p) return false;
  try {
    state.current = await invoke("load_pack", { packPath: p.path });
    return true;
  } catch {
    return false;
  }
}

/** 讲解卡片（对话里的一条 assistant 消息） */
function explainCard(d, meta) {
  if (!d) return "";
  const fu = d.followup_question;
  return `<div class="msg-card">
    ${meta ? `<div class="msg-card-head mono">讲解 · ${esc(meta.model || "")}${meta.attempts ? " · 尝试 " + meta.attempts + " 次" : ""}</div>` : ""}
    ${d.prereq_gap ? `<div class="issue warning">先修缺口：${esc(kcName(d.prereq_gap))}</div>` : ""}
    ${mdToHtml(d.explanation_md || "")}
    ${d.worked_example ? `<h3>例题</h3>${mdToHtml(d.worked_example)}` : ""}
    ${arrOf(d.misconceptions).length ? `<h3>常见误解</h3><ul>${arrOf(d.misconceptions).map((m) => `<li>${esc(m)}</li>`).join("")}</ul>` : ""}
    ${
      fu
        ? `<div class="followup">
            <div class="block-label">检测题</div>
            <div class="q-stem">${esc(fu.stem || "")}</div>
            ${arrOf(fu.options)
              .map((o, i) => {
                const key = "ABCD"[i];
                return `<button class="q-opt" data-quiz-opt="${key}" data-answer="${esc(String(fu.answer || "").toUpperCase())}"><span class="key">${key}</span>${esc(String(o).replace(/^[A-D][.、]\s*/, ""))}</button>`;
              })
              .join("")}
            <div class="quiz-note"></div>
          </div>`
        : ""
    }
  </div>`;
}

function quizCard(data) {
  if (!data || !data.item) return "";
  const it = data.item;
  const kc = data.kc || {};
  return `<div class="msg-card" data-item="${esc(it.id)}" data-pack="${esc(it.pack || kc.pack || "")}" data-kc="${esc(kc.kc_id || (it.kc_ids || [])[0] || "")}">
    <div class="msg-card-head mono">练习 · ${esc(kc.kc_name || "")}</div>
    <div class="q-stem">${esc(it.stem)}</div>
    ${arrOf(it.options)
      .map((o) => `<button class="q-opt" data-quiz-opt="${esc(o.key)}" data-correct="${o.key === it.answer ? "1" : "0"}"><span class="key">${esc(o.key)}</span>${esc(o.text)}</button>`)
      .join("")}
    <div class="quiz-note"></div>
  </div>`;
}

function msgHtml(m) {
  if (m.role === "user") return `<div class="msg user"><div class="bubble">${esc(m.text)}</div></div>`;
  if (m.role === "system" || m.kind === "note") return `<div class="msg-note mono">${esc(m.text)}</div>`;
  if (m.kind === "explain") return `<div class="msg assistant">${explainCard(m.data, m.data && m.data.__meta)}</div>`;
  if (m.kind === "quiz") return `<div class="msg assistant">${quizCard(m.data)}</div>`;
  return `<div class="msg assistant"><div class="bubble md">${mdToHtml(m.text || "")}</div></div>`;
}

function welcomeChat() {
  const d = state.me.due;
  const recap = d ? `今日作答 ${d.today_answers} · 错 ${d.today_wrong} · 薄弱 ${(d.weak || []).length} · 到期 ${(d.due || []).length}` : "";
  const dueKc = d && d.due && d.due[0];
  const weakKc = d && d.weak && d.weak[0];
  const chips = [];
  if (dueKc) chips.push(`我该复习什么？`);
  if (weakKc) chips.push(`帮我补一下${weakKc.kc_name}`);
  chips.push("讲讲一般过去时");
  chips.push("给我出两道题");
  chips.push("混合练 3 个薄弱点");
  return `<div class="chat-welcome">
    <div class="console-bar mono"><span class="dot"></span><span>wordo</span><span class="sep">·</span><span>新对话</span>${recap ? `<span class="console-bar-right">${esc(recap)}</span>` : ""}</div>
    <h1 class="console-title">${greetingWord()}，今天想学点什么？<span class="caret">▌</span></h1>
    <div class="console-sub">直接说就行——我会自己判断学科。也可以点下面的建议：</div>
    <div class="say-chips">${chips.map((t) => `<button class="say-chip" data-say="${esc(t)}">${esc(t)}</button>`).join("")}</div>
  </div>`;
}

function renderChat(view) {
  const c = state.chat;
  const msgs = (c && c.messages) || [];
  const subj = c && c.pack ? (packOf(c.pack) || {}).name || c.pack : "";
  view.innerHTML = `<div class="chat">
    <div class="chat-head">
      <div class="chat-title">${c && c.title ? esc(c.title) : "新对话"}</div>
      <div class="chat-subj mono">${subj ? "学科：" + esc(subj) + " · 自动判定" : "学科：待第一句话自动判定"}</div>
    </div>
    <div class="chat-thread" id="chat-thread">
      ${msgs.length ? msgs.map(msgHtml).join("") : welcomeChat()}
      ${state.chatBusy ? `<div class="msg assistant"><div class="bubble"><span class="typing"><i></i><i></i><i></i></span></div></div>` : ""}
      ${state.chatMsg ? `<div class="console-msg">${esc(state.chatMsg)}</div>` : ""}
    </div>
    <form class="composer" id="composer">
      <textarea id="chat-input" rows="1" placeholder="${isPhone() ? "说点什么…" : "说点什么，例如「讲讲一般过去时」「我该复习什么」…"}"></textarea>
      <button class="btn" id="chat-send" type="submit" ${state.chatBusy ? "disabled" : ""}>发送</button>
    </form>
    <div class="composer-hint mono">Enter 发送 · Shift+Enter 换行</div>
  </div>`;

  const form = view.querySelector("#composer");
  const ta = view.querySelector("#chat-input");
  if (ta) {
    ta.value = state.chatDraft || "";
    autoGrow(ta);
    ta.focus();
    ta.oninput = () => {
      autoGrow(ta);
      state.chatDraft = ta.value;
      const sb = document.getElementById("chat-send");
      if (sb) sb.disabled = !String(ta.value || "").trim();
    };
    const sb0 = document.getElementById("chat-send");
    if (sb0) sb0.disabled = !String(ta.value || "").trim();
    ta.onkeydown = (e) => {
      // 手机端软键盘回车=换行（避免误发），桌面 Enter 发送
      if (e.key === "Enter" && !e.shiftKey && !isPhone()) { e.preventDefault(); if (form) form.requestSubmit(); }
    };
  }
  if (form) form.onsubmit = (e) => { e.preventDefault(); const t = (ta.value || "").trim(); if (t && !state.chatBusy) sendMessage(t); };
  view.querySelectorAll("[data-say]").forEach((b) => { b.onclick = () => sendMessage(b.dataset.say); });
  bindQuiz(view);
  // 有新消息时滚到底
  const th = view.querySelector("#chat-thread");
  if (th) th.scrollTop = th.scrollHeight;
}

function autoGrow(el) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 160) + "px";
}

/** 对话里的选项判分：写账本 + 显示结果；答错提供「让 AI 分析错因」 */
function bindQuiz(view) {
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
            res = await invoke("record_answer", { domain: getDomain(), packsDir: packsDirValue(), pack: packId, itemId: card.dataset.item, answered: btn.dataset.quizOpt, source: "chat", errorType: err || undefined, confidence: conf || undefined });
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
            // 同一知识点连续两次答错 → 中断刷题，换一种讲法回看（评审建议）
            if ((k.wrong || 0) >= 2) {
              const b2 = document.createElement("button");
              b2.className = "btn btn-ghost";
              b2.textContent = "换种讲法讲一遍";
              b2.onclick = () => explainAlternate(kcId || (state.current && state.current.meta.id && ""), kcId);
              note.appendChild(b2);
            }
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
}

async function askWhyWrong(card, answered) {
  const itemId = card.dataset.item;
  const packId = card.dataset.pack;
  const kcId = card.dataset.kc;
  const it = ((state.current && state.current.items) || []).find((x) => x.id === itemId);
  if (!it) return;
  await appendAssistantNote("正在分析错因…");
  try {
    const p = packOf(packId);
    const res = await invoke("ask_model", {
      req: {
        task: "classify-error",
        packPath: p ? p.path : "",
        domain: getDomain(),
        packsDir: packsDirValue(),
        payload: {
          item_id: itemId,
          stem: it.stem,
          options: it.options,
          correct: it.answer,
          answered,
          kc_id: kcId,
        },
      },
    });
    const d = (res && res.data) || null;
    const txt = d
      ? `**错因**：${labelErrorType(d.error_type)}${d.root_cause_kc_id ? `（根因：${kcName(d.root_cause_kc_id)}）` : ""}\n\n**建议**：${labelAction(d.suggested_action)}　置信度 ${d.confidence}\n\n${d.notes || ""}`
      : "（模型没有给出可用的分析）";
    state.chat = await invoke("chat_append", { domain: getDomain(), id: state.currentChatId, msg: { role: "assistant", kind: "text", text: txt, pack: packId } });
    await loadChats();
    render();
  } catch (e) {
    state.chatMsg = "分析失败：" + readableErr(e);
    render();
  }
}

async function appendAssistantNote(text) {
  try {
    state.chat = await invoke("chat_append", { domain: getDomain(), id: state.currentChatId, msg: { role: "system", kind: "note", text } });
  } catch {}
}

/** 意图判定：出题 / 讲解 / 引导 */
function decideIntent(text) {
  const t = String(text || "");
  // 「我该复习什么 / 怎么学 / 计划」属于求建议，优先于「出题」
  if (/(我该|该复习|复习什么|学什么|怎么学|建议|计划)/.test(t)) return "review-advice";
  if (/(混合|交错|混着|换着练)/.test(t)) return "mixed";
  if (/(做题|练习|练一练|出题|出两道|测我|考我|几道|来一道|再来一题)/.test(t)) return "quiz";
  if (/(讲|解释|什么是|说说|教我|帮我理解|补一下|不会)/.test(t)) return "explain";
  if (findKcInCurrent(t)) return "explain";
  return "guide";
}

function findKcInCurrent(text) {
  const kcs = (state.current && state.current.kcs) || [];
  const t = String(text || "");
  return kcs.find((k) => t.includes(k.name)) || kcs.find((k) => k.name.includes(t) && t.length >= 2) || null;
}

async function sendMessage(text) {
  const domain = getDomain();
  const packsDir = packsDirValue();
  state.chatDraft = "";
  state.chatMsg = "";
  try {
    if (!state.currentChatId) {
      const c = await invoke("chat_new", { domain, title: "" });
      state.currentChatId = c.id;
    }
    state.chat = await invoke("chat_append", { domain, id: state.currentChatId, msg: { role: "user", kind: "text", text } });
    state.chatBusy = true;
    render();

    // 学科自动判定（只在会话还没有学科时做一次）
    let pack = (state.chat && state.chat.pack) || "";
    if (!pack) {
      let det = null;
      try { det = await invoke("detect_subject", { domain, text, packsDir }); } catch {}
      if (det && det.score > 0) {
        pack = det.pack;
        state.chat = await invoke("chat_append", { domain, id: state.currentChatId, msg: { role: "system", kind: "note", text: `已根据这句话选定学科：${det.name}（${det.why || "语义匹配"}）`, pack } });
      }
    }
    if (pack) await ensurePack(pack);

    const intent = decideIntent(text);
    if (intent === "quiz") await doQuiz(pack);
    else if (intent === "mixed") await doMixedQuiz(pack);
    else if (intent === "explain") await doExplain(pack, text);
    else if (intent === "review-advice") await doReviewAdvice(pack);
    else await doGuide(pack);
  } catch (e) {
    state.chatMsg = "出错：" + readableErr(e);
  }
  state.chatBusy = false;
  await loadChats();
  if (state.tab === "chat") render();
}

async function doQuiz(pack) {
  let kc = null;
  try {
    const due = await invoke("learn_due", { domain: getDomain(), packsDir: packsDirValue() });
    state.me.due = due || null;
    const cand = (due && (due.due[0] || due.weak[0])) || null;
    if (cand) {
      kc = { kc_id: cand.kc_id, kc_name: cand.kc_name, pack: cand.pack };
      if (!pack) pack = cand.pack;
      await ensurePack(pack);
    }
  } catch {}
  if (!kc && state.current) {
    const k = (state.current.kcs || [])[0];
    if (k) kc = { kc_id: k.id, kc_name: k.name, pack: state.current.meta.id };
  }
  if (!kc || !pack) {
    return doGuide(pack, "还不知道你想练哪一科。先说一句「数学」或「英语」，我就知道从哪出题了。");
  }
  const q = await invoke("learn_queue", { domain: getDomain(), packsDir: packsDirValue(), kcId: kc.kc_id, n: 1 });
  const item = (q && q.items && q.items[0]) || null;
  if (!item) {
    state.chat = await invoke("chat_append", { domain: getDomain(), id: state.currentChatId, msg: { role: "assistant", kind: "text", text: `「${kc.kc_name}」暂时没有题目可出。`, pack } });
    return;
  }
  state.chat = await invoke("chat_append", {
    domain: getDomain(),
    id: state.currentChatId,
    msg: { role: "assistant", kind: "quiz", text: `来一道「${kc.kc_name}」的题：`, data: { item, kc }, pack },
  });
}

/** 交错练习：2–3 个薄弱点各出一题，混在一次练习里 */
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

/** 换一种教学法重讲（避免「错→刷题→再错」死循环） */
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

async function doExplain(pack, text) {
  const kc = findKcInCurrent(text);
  if (!pack || !state.current || !kc) {
    const names = ((state.current && state.current.kcs) || []).slice(0, 6).map((k) => k.name);
    return doGuide(
      pack,
      pack
        ? `没认出你想讲哪个知识点。可以说：${names.map((n) => `「讲讲${n}」`).join("、")}`
        : "先告诉我想学什么学科吧（例：「讲讲一般过去时」或「数学的单调性」）。"
    );
  }
  const p = packOf(pack) || (state.current ? { path: "" } : null);
  const res = await invoke("ask_model", {
    req: {
      task: "explain",
      packPath: p ? p.path : "",
      domain: getDomain(),
      packsDir: packsDirValue(),
      payload: { kc_id: kc.id, kc_name: kc.name, toc: kc.toc, learner: {} },
    },
  });
  const d = (res && res.data) || null;
  if (!d) {
    return doGuide(pack, "模型这次没给出合格输出（" + ((res && res.issues) || []).join("；") + "）。可以在设置里换个模型再试。");
  }
  const meta = { model: res.model, attempts: res.attempts, __meta: undefined };
  // A3 留痕：记一笔「讲解已展示」（失败不影响主流程）
  try { await invoke("record_explain", { domain: getDomain(), pack, kcId: kc.id, model: res.model, source: "ai" }); } catch (e) {}
  state.chat = await invoke("chat_append", {
    domain: getDomain(),
    id: state.currentChatId,
    msg: { role: "assistant", kind: "explain", text: (d.explanation_md || "").slice(0, 80), data: { ...d, __meta: meta }, pack },
  });
}

async function doReviewAdvice(pack) {
  let due = null;
  try { due = await invoke("learn_due", { domain: getDomain(), packsDir: packsDirValue() }); state.me.due = due || null; } catch {}
  const d = due || { due: [], weak: [] };
  if (!d.due.length && !d.weak.length) {
    return doGuide(pack, "目前没有到期或薄弱的项。可以直接说「给我出两道题」，或者「讲讲某个知识点」。");
  }
  const dueTxt = d.due.map((k) => `- ${k.kc_name}（掌握度 ${pct(k.mastery)}，已到期）`).join("\n");
  const weakTxt = d.weak.map((k) => `- ${k.kc_name}（错 ${k.wrong} 次，掌握度 ${pct(k.mastery)}）`).join("\n");
  const txt = `按你的账本，建议先做这些：\n${d.due.length ? `\n**今日到期**\n${dueTxt}\n` : ""}${d.weak.length ? `\n**薄弱点**\n${weakTxt}\n` : ""}\n说「给我出两道题」我就按上面的顺序出。`;
  state.chat = await invoke("chat_append", { domain: getDomain(), id: state.currentChatId, msg: { role: "assistant", kind: "text", text: txt, pack: pack || "" } });
}

async function doGuide(pack, extra) {
  const names = ((state.current && state.current.kcs) || []).slice(0, 6).map((k) => k.name);
  const txt =
    extra ||
    (pack
      ? `我可以帮你：\n- 讲解：「讲讲${names[0] || "某个知识点"}」\n- 练习：「给我出两道题」\n- 复习建议：「我该复习什么」`
      : "先告诉我你想学什么学科（例：「讲讲一般过去时」「数学的单调性」），我会自动切换。");
  state.chat = await invoke("chat_append", { domain: getDomain(), id: state.currentChatId, msg: { role: "assistant", kind: "text", text: txt, pack: pack || "" } });
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
      ${(() => {
        const due = state.me.due;
        if (!due) return "";
        const hit = [...(due.weak || []), ...(due.due || [])].find((x) => x.kc_id === kc.id);
        if (hit) return `<span class="lesson-flag warn">薄弱 · 掌握度 ${esc(pct(hit.mastery))} · 错 ${esc(String(hit.wrong || 0))} 次</span>`;
        return `<span class="lesson-flag ok">尚未记录 / 已掌握</span>`;
      })()}
    </div>`;

  // 预置讲解：先算好内容，等 AI 卡片之后再放（有 AI 讲解时默认折叠，避免两篇长文堆叠）
  const presetBody = mat
    ? `<section class="lesson-block"><div class="block-label">预置讲解</div>${mdToHtml(String(mat.body || "").replace(/^\s*#\s+.*(?:\r?\n|$)/, ""))}</section>`
    : `<section class="lesson-block"><div class="hint">本知识点还没有预置讲解。点下面的「让 AI 讲一遍」让模型现场讲一遍。</div></section>`;

  // AI 动作区
  const keyReady = hasKey();
  body += `<div class="actions">
      <button class="btn" id="btn-ai" ${state.learn.aiLoading ? "disabled" : ""}>${state.learn.aiLoading ? "生成中…" : "让 AI 讲一遍"}</button>
      <span class="mono muted">${keyReady ? "模型：" + esc(activeModelLabel()) : "未配置 API Key —— 请先到「设置」填入"}</span>
    </div>`;

  if (state.learn.aiError) {
    body += `<div class="issue error">${esc(state.learn.aiError)}</div>`;
  }

  // 生成中：骨架屏（让用户知道内容将出现在哪里）
  if (state.learn.aiLoading && !(ai && ai.data)) {
    body += `<section class="lesson-block ai-card skeleton">
      <div class="block-label">AI 讲解 · 正在生成…（约 10–20 秒）</div>
      <div class="sk-line" style="width:92%"></div>
      <div class="sk-line" style="width:78%"></div>
      <div class="sk-line" style="width:86%"></div>
      <div class="sk-line" style="width:64%"></div>
    </section>`;
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

  // 预置讲解放在 AI 卡片之后；本轮已有 AI 讲解时折叠（原始素材按需查看）
  if (ai && ai.data) {
    body += `<details class="preset-fold"><summary><span class="block-label">预置讲解（原始素材 · 点开查看）</span></summary>${presetBody}</details>`;
  } else {
    body += presetBody;
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
    b.onclick = async () => {
      state.learn.pick = b.dataset.pick;
      render();
      // 学习页的检测题也要落账（合成 id），保证环路完整
      try {
        const kc = currentKc();
        const q = state.learn.ai && state.learn.ai.data && state.learn.ai.data.followup_question;
        const ok = !!(q && String(q.answer || "").toUpperCase().startsWith(String(b.dataset.pick).toUpperCase()));
        const packId = (state.current && state.current.meta.id) || "";
        const kcId = kc ? kc.id : "";
        await invoke("record_judged", {
          domain: getDomain(),
          packsDir: packsDirValue(),
          pack: packId,
          kcId,
          syntheticId: packId + "::" + kcId + "::followup",
          answered: b.dataset.pick,
          ok,
          source: "learn-followup",
        });
        state.me.due = null;
      } catch (e) {}
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
  // 生成完成后滚到 AI 卡片
  const card = document.querySelector(".lesson-block.ai-card");
  if (card) card.scrollIntoView({ block: "start", behavior: "smooth" });
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
  const v = el && typeof el.value === "string" ? el.value.trim() : "";
  if (v) return v;
  try { return (localStorage.getItem("packsDir") || DEFAULT_PACKS_DIR).trim(); } catch { return DEFAULT_PACKS_DIR; }
}
/** 手机竖屏判定（≤640px 用卡片式布局，不用表格） */
function isPhone() {
  try { return window.matchMedia("(max-width: 640px)").matches; } catch { return false; }
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
    const [st, due, plan] = await Promise.all([
      invoke("learn_state", { domain, packsDir }),
      invoke("learn_due", { domain, packsDir }),
      invoke("learn_plan", { domain, action: "list" }),
    ]);
    if (seq !== state.me.seq) return;
    state.me.state = st || null;
    state.me.due = due || null;
    state.me.plan = (plan && plan.plan) || [];
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
  const firstLoad = state.me.loading && !st;

  let html = `<div class="me">
    <div class="me-head">
      <h1>今日</h1>
      <div class="me-sub mono muted">${domain ? "域：" + esc(tail(domain)) : "默认账号域"}${st && st.domain ? " · " + esc(tail(st.domain)) : ""}</div>
      ${st && st.path ? `<div class="me-path mono muted" title="${esc(st.path)}">user.md：${esc(tail(st.path))}</div>` : ""}
    </div>`;

  if (state.me.error) html += `<div class="me-err">${esc(state.me.error)}</div>`;
  if (state.me.msg) html += `<div class="me-msg">${esc(state.me.msg)}</div>`;

  html += `<div class="me-stats">${[
    ["今日作答", d ? d.today_answers : firstLoad ? "…" : "—"],
    ["今日错题", d ? d.today_wrong : firstLoad ? "…" : "—"],
    ["薄弱知识点", d ? weak.length : firstLoad ? "…" : "—"],
    ["今日待复习", d ? due.length : firstLoad ? "…" : "—"],
  ]
    .map(([l, n], i) => `<div class="me-stat reveal" style="--i:${i}"><div class="n">${esc(String(n))}</div><div class="l">${esc(l)}</div></div>`)
    .join("")}</div>`;

  html += `<div class="actions">
    <button class="btn" id="me-sync" ${busy ? "disabled" : ""}>${busy === "sync" ? "同步中…" : "同步域"}</button>
    <button class="btn btn-ghost" id="me-delegate" ${busy ? "disabled" : ""}>${busy === "delegate" ? "导出中…" : "导出今日错题"}</button>
    <button class="btn btn-ghost" id="me-review" ${busy ? "disabled" : ""}>${busy === "review" ? "处理中…（调用模型，较慢）" : "处理域内委托"}</button>
    <button class="btn btn-ghost" id="me-report">导出周报</button>
    <span class="mono muted">${state.me.loading ? "读取中…" : (() => {
      const sy = state.me.sync;
      const ev = sy ? sy.events_total : d ? d.events_total : null;
      const nd = sy ? Object.keys(sy.per_node || {}).length : d ? arrOf(d.nodes).length : null;
      return ev != null ? "事件 " + ev + " 条 · 节点 " + (nd ?? 0) + " 个" : "";
    })()}</span>
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
    <div class="block-label">今日复习队列（${due.length}）</div>
    ${due.length ? kcList(due, true) : `<div class="hint">${firstLoad ? "正在读取学习账本…" : "今日没有到期的复习。"}</div>`}
  </section>`;

  html += `<section class="me-block">
    <div class="block-label">薄弱知识点（${weak.length}）</div>
    ${weak.length ? kcList(weak, false) : `<div class="hint">${firstLoad ? "正在读取学习账本…" : "还没有薄弱项 —— 先去学习页做几道题，答错的会自动进这张表。"}</div>`}
  </section>`;

  // 学习计划：append-only 任务清单，可在任一设备添加，账号域内共享
  const plan = state.me.plan || [];
  const todo = plan.filter((t) => !t.done).length;
  html += `<section class="me-block">
    <div class="block-label">学习计划（${todo} 项待办${plan.length ? " / 共 " + plan.length + " 项" : ""}）</div>
    <div class="me-plan-add">
      <input id="me-plan-input" type="text" placeholder="加一条学习任务，例如：今晚复习一般过去时" spellcheck="false" />
      <button class="btn" id="me-plan-add">添加</button>
    </div>
    ${
      plan.length
        ? `<ul class="me-plan">${plan
            .map(
              (t) =>
                `<li class="${t.done ? "done" : ""}"><label><input type="checkbox" data-plan="${esc(t.id)}" ${t.done ? "checked" : ""}/> <span>${esc(t.text)}</span></label></li>`
            )
            .join("")}</ul>`
        : `<div class="hint">${firstLoad ? "正在读取…" : "还没有任务。加一条，它会落在账号域里、所有设备可见。"}</div>`
    }
  </section>`;

  const md = st && st.userMd ? stripFrontMatter(st.userMd) : "";
  html += `<section class="me-block">
    <details class="me-md" open>
      <summary><span class="block-label">user.md 全文</span><span class="mono muted">${md ? esc(String(String(st.userMd).length)) + " 字符" : firstLoad ? "读取中…" : "尚未生成"}</span></summary>
      <div class="me-md-body">${md ? mdToHtml(md) : `<div class="hint">${firstLoad ? "正在读取学习账本…" : "还没有学员档案。做几道题后会自动生成。"}</div>`}</div>
    </details>
  </section>`;

  view.innerHTML = html + "</div>";

  const bSync = view.querySelector("#me-sync");
  if (bSync) bSync.onclick = runMeSync;
  const bDel = view.querySelector("#me-delegate");
  if (bDel) bDel.onclick = runMeDelegate;
  const bRev = view.querySelector("#me-review");
  if (bRev) bRev.onclick = runMeReview;
  const bRep = view.querySelector("#me-report");
  if (bRep) bRep.onclick = runMeReport;
  view.querySelectorAll(".me-go").forEach((b) => {
    b.onclick = () => startReview(b.dataset.pack, b.dataset.kc);
  });
  const bPlanAdd = view.querySelector("#me-plan-add");
  if (bPlanAdd) bPlanAdd.onclick = runPlanAdd;
  const planInput = view.querySelector("#me-plan-input");
  if (planInput) planInput.onkeydown = (e) => { if (e.key === "Enter") runPlanAdd(); };
  view.querySelectorAll("input[data-plan]").forEach((cb) => {
    cb.onchange = () => runPlanDone(cb.dataset.plan, cb.checked);
  });
  observeReveals(view);
}

/** 添加学习任务（写入账号域 plan.md + 账本） */
async function runPlanAdd() {
  const input = document.getElementById("me-plan-input");
  const text = (input && input.value || "").trim();
  if (!text) return;
  try {
    await invoke("learn_plan", { domain: getDomain(), action: "add", text });
    input.value = "";
    await loadMe();
    refreshMe();
  } catch (e) {
    state.me.error = "添加任务失败：" + readableErr(e);
    refreshMe();
  }
}

/** 勾选完成（只追加一条 plan_done 事件，不改写原文件） */
async function runPlanDone(taskId, done) {
  try {
    await invoke("learn_plan", { domain: getDomain(), action: done ? "done" : "list", taskId });
    await loadMe();
    refreshMe();
  } catch (e) {
    state.me.error = "更新任务失败：" + readableErr(e);
    refreshMe();
  }
}

/** 知识点列表：桌面用表格，手机竖屏用卡片（不横向滚动） */
function kcList(rows, withAction) {
  if (!isPhone()) return meTable(rows, withAction);
  return `<div class="kc-cards">${rows
    .map((k) => {
      const m = Math.max(0, Math.min(100, Math.round((Number(k.mastery) || 0) * 100)));
      return `<div class="kc-card-row">
        <div class="kc-card-top">
          <div class="kc-card-txt">
            <div class="kc-card-name">${esc(k.kc_name || k.kc_id || "")}</div>
            <div class="kc-card-sub mono">${esc(k.pack || "")} · 对/错 ${esc(String(k.correct ?? 0))}/${esc(String(k.wrong ?? 0))} · 连对 ${esc(String(k.streak ?? 0))}</div>
          </div>
          <div class="kc-card-pct">${esc(pct(k.mastery))}</div>
        </div>
        <div class="kc-card-meter"><span style="width:${m}%"></span></div>
        <div class="kc-card-foot">
          <span class="mono muted">${esc(dueLabel(k.due_ts, k.mastered))}</span>
          ${withAction ? `<button class="btn me-go" data-pack="${esc(k.pack || "")}" data-kc="${esc(k.kc_id || "")}">开始复习</button>` : ""}
        </div>
      </div>`;
    })
    .join("")}</div>`;
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

async function runMeReport() {
  state.me.busy = "report";
  refreshMe();
  try {
    const r = await invoke("export_report", { domain: getDomain(), packsDir: packsDirValue() });
    state.me.report = r;
    state.me.msg = "周报已生成：" + (r && r.path ? r.path : "");
  } catch (e) {
    state.me.error = "导出周报失败：" + readableErr(e);
  }
  state.me.busy = null;
  refreshMe();
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
  const keyOk = !!(p.api_key && String(p.api_key).trim());
  const masked = keyOk ? "••••" + String(p.api_key).trim().slice(-4) : "";
  const statusHtml = keyOk
    ? `<div class="cfg-status ok">已配置 · 模型 <b>${esc(p.model || "")}</b> · Key ${esc(masked)}</div>`
    : `<div class="cfg-status no">未配置 API Key —— 填入后「让 AI 讲一遍」「处理域内委托」才可用。</div>`;

  view.innerHTML = `
    <div class="settings">
      <h1>设置</h1>
      <p class="muted">纯 API 接入（OpenAI 兼容协议）。Key 只存在本机应用配置目录，不在仓库内。</p>
      ${statusHtml}

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

      <h2 class="settings-h2">学科包</h2>
      <div class="field">
        <label>学科包目录（packs）</label>
        <input id="s-packs-dir" type="text" value="${esc(packsDirValue())}" spellcheck="false" />
      </div>
      <div class="actions">
        <button class="btn btn-ghost" id="s-refresh">重新扫描学科包</button>
        <span class="mono muted" id="s-packs-status"></span>
      </div>

      <h2 class="settings-h2">教师视图</h2>
      <p class="settings-note muted">内容编排与校验（学生用不到，手机上也从这里进）</p>
      <div class="settings-links">
        <button class="btn btn-ghost" data-goto="items">题目清单</button>
        <button class="btn btn-ghost" data-goto="tree">知识树</button>
        <button class="btn btn-ghost" data-goto="report">校验报告</button>
      </div>

      <p class="settings-note muted">提示：NVIDIA NIM 的 Base URL 为 <code>https://integrate.api.nvidia.com/v1</code>，实测可用模型如 <code>deepseek-ai/deepseek-v4.1-flash</code>；本机也可走 magpie 网关 <code>http://127.0.0.1:3425/v1</code> + <code>auto/deepseek-v4.1-flash</code>（更快）。</p>
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

  // 学科包目录：手机上这是唯一的入口（顶栏不显示路径框）
  const packsIn = view.querySelector("#s-packs-dir");
  const packsBtn = view.querySelector("#s-refresh");
  if (packsBtn)
    packsBtn.onclick = async () => {
      const dir = (packsIn && packsIn.value.trim()) || "";
      try {
        localStorage.setItem("packsDir", dir);
        const header = document.getElementById("packs-dir");
        if (header) header.value = dir;
        const st = view.querySelector("#s-packs-status");
        if (st) st.textContent = "扫描中…";
        await refreshPacks();
        if (state.packs.length) await openPack(state.packs[0].path);
        if (st) st.textContent = `已找到 ${state.packs.length} 个学科包`;
      } catch (e) {
        const st = view.querySelector("#s-packs-status");
        if (st) st.textContent = "扫描失败: " + readableErr(e);
      }
    };

  // 教师视图入口
  view.querySelectorAll("[data-goto]").forEach((b) => {
    b.onclick = () => {
      if (!state.current) { view.querySelector("#s-packs-status").textContent = "请先在「学习」里选择学科包"; return; }
      setTab(b.dataset.goto);
    };
  });
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
          <span style="display:flex;align-items:center;gap:12px"><span class="item-type">${esc(typeLabel(it.type))}</span><span class="toggle">+</span></span>
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
    .map(
      (i, idx) =>
        `<div class="issue ${i.level} reveal" style="--i:${idx}"><span class="issue-lv">${
          i.level === "error" ? "错误" : i.level === "warning" ? "警告" : "提示"
        }</span><code>${esc(i.code)}</code><span class="issue-file">${esc(i.file)}</span><span class="issue-msg">${esc(humanizeKcIds(i.msg))}</span></div>`
    )
    .join("");
  view.innerHTML = stats + (issues ? `<div class="issue-list">${issues}</div>` : `<div class="empty">没有发现问题，学科包校验全部通过。</div>`);
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
/** 路径只取尾部两段，避免长路径破坏排版 */
function tail(p) {
  if (!p) return "";
  const parts = String(p).split(/[\\/]/).filter(Boolean);
  return parts.length <= 2 ? String(p) : "…/" + parts.slice(-2).join("/");
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
/** 机器枚举 → 人话（不要把 single_choice 直接暴露给用户） */
function typeLabel(t) {
  return (
    {
      single_choice: "单选",
      multi_choice: "多选",
      fill_blank: "填空",
      short_answer: "简答",
      judge: "判断",
    }[t] || t || "题目"
  );
}
/** 把 issue 文本里的 kc_id 换成知识点名，人读更友好 */
function humanizeKcIds(s) {
  if (!s) return "";
  return String(s).replace(/\b(kc_[a-z0-9_]+|kc_hs_[a-z0-9_]+|kc_eng_[a-z0-9_]+)\b/gi, (m) => kcName(m));
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
