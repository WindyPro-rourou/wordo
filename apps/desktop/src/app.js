/* WORDO 桌面壳 —— 前端逻辑（薄壳：全部能力在 wordo-core） */
"use strict";

const DEFAULT_PACKS_DIR = "F:/去中心化分布式跨平台自进化ai学习系统/packs";
const { invoke } = window.__TAURI__.core;

const state = { packs: [], current: null, tab: "tree" };

/* ---------- 启动 ---------- */
async function boot() {
  const input = document.getElementById("packs-dir");
  input.value = localStorage.getItem("packsDir") || DEFAULT_PACKS_DIR;
  document.getElementById("btn-refresh").onclick = refreshPacks;
  document.querySelectorAll(".tab").forEach((t) => {
    t.onclick = () => {
      document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
      t.classList.add("active");
      state.tab = t.dataset.tab;
      render();
    };
  });
  await refreshPacks();
}

async function refreshPacks() {
  const dir = document.getElementById("packs-dir").value.trim();
  localStorage.setItem("packsDir", dir);
  try {
    const res = await invoke("list_packs", { packsDir: dir });
    state.packs = res.packs || [];
  } catch (e) {
    state.packs = [];
    viewMessage("读取 packs 目录失败: " + e);
  }
  renderPackList();
}

/* ---------- 左侧列表 ---------- */
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
  renderPackList();
  render();
}

/* ---------- 主视图 ---------- */
function render() {
  const view = document.getElementById("view");
  document.getElementById("tabs").classList.toggle("hidden", !state.current);
  if (!state.current) {
    viewMessage("从左侧选择一个学科包");
    return;
  }
  if (state.tab === "tree") renderTree(view);
  else if (state.tab === "items") renderItems(view);
  else renderReport(view);
}

/* ---------- 知识树 ---------- */
function renderTree(view) {
  const { kcs, prereqs, items } = state.current;
  const countByKc = {};
  for (const it of items) for (const k of it.kc_ids || []) countByKc[k] = (countByKc[k] || 0) + 1;
  const nameOf = (id) => (kcs.find((k) => k.id === id) || {}).name || id;

  let html = "";
  if (prereqs.length) {
    html += `<div class="edge-list reveal"><b>先修关系</b>（先修 → 后继）<br>${prereqs
      .map(
        (e) =>
          `${esc(nameOf(e.from))} <code>—${e.strength === "hard" ? "硬" : "软"}→</code> ${esc(nameOf(e.to))}`
      )
      .join("<br>")}</div>`;
  }
  html += kcs
    .map((k, i) => {
      const n = countByKc[k.id] || 0;
      const toc = (k.toc || []).join(" › ");
      return `<div class="kc-card reveal" style="--i:${i}">
        <div class="kc-head">
          <span class="kc-name">${esc(k.name)}</span>
          <span class="kc-count">${n} 题</span>
        </div>
        <div class="kc-toc">${esc(toc)}</div>
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

/* ---------- 题目（手风琴） ---------- */
const CHECK_SVG =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#346538" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

function renderItems(view) {
  const { items, kcs } = state.current;
  const nameOf = (id) => (kcs.find((k) => k.id === id) || {}).name || id;
  if (!items.length) {
    viewMessage("包内暂无题目");
    return;
  }
  view.innerHTML = items
    .map((it, idx) => {
      const isChoice = it.type === "single_choice" || it.type === "multi_choice";
      const opts = isChoice
        ? (it.options || [])
            .map((o) => {
              const correct = o.key === it.answer;
              return `<div class="opt ${correct ? "correct" : ""}">
                <span class="key">${esc(o.key)}</span>
                <span>${esc(o.text)}</span>
                ${correct ? CHECK_SVG : ""}
              </div>`;
            })
            .join("")
        : `<div class="opt">${esc(it.answer_text || it.answer || "")}</div>`;
      const tags = (it.kc_ids || []).map((k) => `<span class="kc-tag">${esc(nameOf(k))}</span>`).join("");
      return `<div class="acc reveal" style="--i:${idx}">
        <div class="acc-head" data-idx="${idx}">
          <span class="item-stem">${idx + 1}. ${esc(it.stem)}</span>
          <span style="display:flex;align-items:center;gap:12px">
            <span class="item-type">${esc(it.type)}</span>
            <span class="toggle">+</span>
          </span>
        </div>
        <div class="acc-body hidden">
          <div style="margin-bottom:10px">${tags}</div>
          ${opts}
          ${it.analysis ? `<div class="analysis"><b>解析</b>　${esc(it.analysis)}</div>` : ""}
          <div class="meta-line">origin: ${esc(it.origin?.source_type || "未标注")}${
            it.origin?.redistributable === false ? " · 不可分发" : ""
          }</div>
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

/* ---------- 校验报告 ---------- */
function renderReport(view) {
  const r = state.current.report;
  const stats = `
    <div class="report-stats">
      ${[
        ["知识点", r.kc_count],
        ["先修边", r.edge_count],
        ["题目", r.item_count],
        ["挂载率", Math.round(r.coverage_pct) + "%"],
        ["错误", r.error_count],
        ["警告", r.warning_count],
      ]
        .map(
          ([l, n], i) =>
            `<div class="stat reveal" style="--i:${i}"><div class="n">${n}</div><div class="l">${l}</div></div>`
        )
        .join("")}
    </div>`;
  const issues = (r.issues || [])
    .map(
      (i, idx) =>
        `<div class="issue ${i.level} reveal" style="--i:${idx}"><code>[${esc(i.code)}]</code> ${esc(i.file)} — ${esc(i.msg)}</div>`
    )
    .join("");
  view.innerHTML = stats + (issues || `<div class="empty">没有任何问题</div>`);
  observeReveals(view);
}

/* ---------- 动效：进入视口后渐显（IntersectionObserver，不用 scroll 监听） ---------- */
let observer = null;
function observeReveals(container) {
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
      { root: document.getElementById("view"), threshold: 0.05 }
    );
  }
  container.querySelectorAll(".reveal:not(.in)").forEach((el) => observer.observe(el));
}

/* ---------- 工具 ---------- */
function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&", "<": "<", ">": ">", '"': """ }[c])
  );
}
function viewMessage(msg) {
  document.getElementById("view").innerHTML = `<div class="empty">${esc(msg)}</div>`;
}

boot();
