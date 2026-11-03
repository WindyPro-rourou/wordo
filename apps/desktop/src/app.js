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
  if (state.packs.length) await openPack(state.packs[0].path);
}

function setTab(tab) {
  state.tab = tab;
  document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x.dataset.tab === tab));
  document.getElementById("tabs").classList.toggle("hidden", !state.current && tab !== "settings");
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
      <div class="block-label">AI 讲解 <span class="mono muted">· ${esc(ai.model || "")}${ai.ok ? "" : " · 校验未通过"}</span></div>
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
  return `<div class="q-card reveal" style="--i:${idx}">
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
      const ok = b.dataset.correct === "1";
      b.classList.add(ok ? "correct" : "wrong");
      const card = b.closest(".q-card");
      if (card) card.querySelector(".q-reveal")?.classList.remove("hidden");
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
      <p class="settings-note muted">提示：NVIDIA NIM 的 Base URL 为 <code>https://integrate.api.nvidia.com/v1</code>，模型如 <code>deepseek-ai/deepseek-r1</code>。</p>
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
