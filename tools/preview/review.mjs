// 轻量评审：针对某个视角问 2 个模型，输出精简意见并落盘
// 用法: node review.mjs --lens algorithm --n 2
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const H = process.env.DSH_HOME;
const KEY = (fs.readFileSync(path.join(H, ".env"), "utf8").match(/^MAGPIE_GATEWAY_KEY=(.*)$/m) || [])[1].trim();
const BASE = "http://127.0.0.1:3425/v1";
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const LENS = arg("lens", "general");
const MODELS = arg("models", "auto/glm-5.3-flash,auto/kimi-k3.1-pro").split(",").map((s) => s.trim()).filter(Boolean).slice(0, Number(arg("n", 2)));

const STATE = `【WORDO 现状】去中心化、跨平台、自进化的 AI 学习系统（Tauri2 + Rust core，前端原生 HTML/CSS/JS）。
形态 chat-first：侧栏=对话历史（新建/切换/删除，事件化存储防多端覆盖）；学科由首句自动判定；对话内 讲解/出题/判分/复习建议。
核心数据：每节点 append-only 账本 ledger/<node>.jsonl（单调 seq + verify_ledger 完整性自检）、user.md 由账本派生（不写共享盘）、简化 SRS（错→4h、对→24h 倍增、上限 30 天、已掌握转≥14 天低频抽查）。
学习科学：置信度三档（确定/说不准/蒙）+ 蒙对不算掌握、看错题不降掌握、错因分型、交错练习、连续两错→换种讲法重讲。
跨模型一致性：正式 JSON Schema + golden 用例 + 结构/主观口径拆分（结构一致率 100%）。
内容与多端：学科包规范 subject-pack/1（2 个真实包）；**用户可自助新建学科**（scaffold_pack，CLI/前端/预览三端同契约）；**内容入库管线 tools/ingest**（教材/出卷网/OCR 文本→知识树+题库+校验）；**极简节点桥 tools/mininode**（导出卡片集→设备作答→入库账本，含 ESP32 参考草图），落实「每个设备享受类似功能」。
文档：README/DEVELOPMENT 已与现状对齐，新增 快速开始/架构/多端构建指南/同步指南/路线图。
UI：桌面 3 页签 对话/今日/设置；手机 底部导航+对话抽屉+学科胶囊；今日页 复习队列→薄弱→计划→user.md→导出周报。
已知未验证：Rust 由 CI 编译+单测；桌面 WebView2 运行时未本机复测；Android/iPadOS/ESP32 未实机构建/联调。`;

const QUESTIONS = {
  algorithm: "只评审「学习科学与算法」：1) 简化 SRS（错4h/对24h倍增/上限30天/已掌握≥14天抽查）对高中生是否合理，该怎么改？2) 错因分型之后应该怎么更有效地影响出题/复习？3) 还缺哪个最高性价比的学习机制？每条 2-4 句，给可执行结论。",
  ia: "只评审「信息架构与交互」：1) 3 页签(对话/今日/设置)+手机底部导航是否够？2) 今日页的块顺序对不对？3) 对话里做「出题/判分」与「今日页开始复习」是否重复，怎么收敛？4) 学生最可能卡在哪一步？每条 2-4 句，直接给改法。",
  mobile: "只评审「手机端」：底部导航、对话抽屉、学科胶囊、卡片化、Enter 换行、安全区、软键盘避让、新建学科弹窗。还有什么明显问题？给 3 条最高优先级的改法。",
  consistency: "只评审「跨模型一致性度量」：结构一致率 vs 主观字段（错因/教具/inferred）分开统计是否合理？目标该怎么定义才有意义？还缺什么才能说「多模型效果趋同」？3-4 条。",
  extension: "只评审「可扩展性」：1) 用户自助新建学科（只生成空骨架，靠入库管线填内容）这个路径对学生/老师是否够用？2) 内容入库管线（教材/OCR/出卷 JSON→知识树+题库）最容易在哪出错、该怎么防？3) 极简设备（ESP32）只做取题/写一行JSON/搬运，这种设计有什么隐患？每条 2-4 句，给可执行建议。",
  final: "这是交付前最后一次评审：如果只能再改 3 处，你选哪 3 处？按影响排序，每处一句话说清「改什么、为什么」。另外指出 1 个我们可能没意识到的风险。",
};

async function ask(model, lens) {
  const body = {
    model,
    messages: [
      { role: "system", content: "你是资深学习产品架构师，评审要具体、可执行、不客套。" },
      { role: "user", content: STATE + "\n\n" + QUESTIONS[lens] },
    ],
    temperature: 0.4, max_tokens: 1200, stream: false,
  };
  const t0 = Date.now();
  try {
    const r = await fetch(`${BASE}/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(180000) });
    const txt = await r.text();
    if (!r.ok) return { model, ok: false, err: `HTTP ${r.status}` };
    const j = JSON.parse(txt);
    return { model, ok: true, ms: Date.now() - t0, content: j.choices?.[0]?.message?.content || "" };
  } catch (e) { return { model, ok: false, err: String(e.message || e) }; }
}

const res = await Promise.allSettled(MODELS.map((m) => ask(m, LENS)));
const dir = path.join(REPO, "docs/评审");
fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
let md = `# 评审（${LENS}）${stamp}\n\n`;
for (const r of res) {
  const v = r.status === "fulfilled" ? r.value : { ok: false, err: "rejected" };
  console.log(`\n===== ${v.model || "?"} ${v.ok ? `(${(v.ms / 1000).toFixed(0)}s)` : "❌ " + v.err} =====`);
  if (v.ok) console.log(v.content.slice(0, 1400));
  md += `## ${v.model}\n\n${v.ok ? v.content : "失败：" + v.err}\n\n`;
}
fs.writeFileSync(path.join(dir, `评审-${LENS}-${stamp}.md`), md, "utf8");
