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

const STATE = `【WORDO 现状】跨平台去中心化学习系统（高中学科），Windows 桌面 Tauri2 已跑通。
形态 chat-first：侧栏=对话历史（新建/切换/删除，事件化存储防多端覆盖）；学科由首句自动判定；对话内 讲解/出题/判分/复习建议。
已实现：append-only 账本（每节点文件 + 单调 seq + 完整性自检 verify_ledger）、user.md 由账本派生（不写共享盘）、简化 SRS（错→4h，对→24h 倍增，已掌握仍保持复习）、**置信度自评（确定/说不准/蒙）+ 蒙对按 40% 计入掌握度**、错因分型（概念不清/算错/看错题）、**交错练习（2-3 个薄弱点混排出题）**、检测题落账（含讲解内检测题，合成 id）、讲解检测题改为「从题库取」（确定性来源，避免模型编错）、建议动作由错因枚举派生、跨模型一致性测试（正式 JSON Schema + 用例 + 结构/主观口径拆分，温度0）、周报导出（Markdown 到账号域 reports/）。
UI：桌面 3 页签 对话/今日/设置；手机 底部导航 + 对话抽屉 + 学科胶囊；今日页依次 复习队列→薄弱→计划→user.md。`;

const QUESTIONS = {
  algorithm: "只评审「学习科学与算法」：1) 蒙对按 0.4 权重入掌握度，这个做法有什么问题？更好的做法？2) 简化 SRS（错4h/对24h倍增、上限30天）对高中生是否合理，该怎么改？3) 错因分型之后应该怎么影响出题/复习？4) 还缺哪个最高性价比的学习机制？每条 2-4 句，给可执行结论。",
  ia: "只评审「信息架构与交互」：1) 3 页签(对话/今日/设置)+手机底部导航是否够？2) 今日页的块顺序对不对？3) 对话里做「出题/判分」与「今日页开始复习」是否重复，怎么收敛？4) 学生最可能卡在哪一步？每条 2-4 句，直接给改法。",
  mobile: "只评审「手机端」：底部导航、对话抽屉、学科胶囊、卡片化、Enter 换行、安全区。还有什么明显问题？给 3 条最高优先级的改法。",
  consistency: "只评审「跨模型一致性度量」：结构一致率 vs 主观字段（错因/教具/inferred）分开统计是否合理？95% 这个目标该怎么定义才有意义？还缺什么才能说「多模型效果趋同」？3-4 条。",
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
