// 横向问多家模型同一个问题，收集独立意见（结果写入 opinions/<model>.md）
import fs from "node:fs";
import path from "node:path";

const H = process.env.DSH_HOME;
const key = (fs.readFileSync(path.join(H, ".env"), "utf8").match(/^MAGPIE_GATEWAY_KEY=(.*)$/m) || [])[1].trim();
const BASE = "http://127.0.0.1:3425/v1";
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, "")), "opinions");
fs.mkdirSync(OUT, { recursive: true });

const MODELS = [
  "auto/glm-5.3-flash",
  "auto/kimi-k3.1-pro",
  "openai/gpt-oss-20b",
  "nvidia/nemotron-3-super-120b-a12b",
  "mistralai/mistral-large-4-1t-a52b",
];

const BRIEF = `你在评审一个真实产品，请直接给判断，不要复述我的描述。

【产品】WORDO：去中心化、跨平台、自进化的 AI 学习系统（以高中学科为主）。
公理：A1 节点对等（无主从）；A2 内容与呈现分离、学科可扩展；A3 变更留痕。

【现状】
- Windows 桌面 Tauri2 已跑通；安卓/iPadOS 计划；ESP32 单词机冻结。
- 形态 chat-first：侧栏=对话历史（新建/切换/删除）；学科不手选，由第一句话自动判定（知识点名命中5分>学科名3>包id2>简称1），顶栏可覆盖。
- 对话意图：说「讲讲X」→ 讲解卡（直观理解/规范表述/判据/例题/常见误解）+ 1 道检测题；说「给我出两道题」→ 按账本出题、选项判分写账本；说「我该复习什么」→ 读账本给建议（不调模型）。
- 数据：每设备 append-only 账本 ledger/<node>.jsonl（一行一个 answer 事件）；user.md 由全部账本重算派生（薄弱/掌握度/到期/最近错题/委托回执）；复习=简化 SM-2（错+4h，对 24h 起倍增，上限30天）；掌握度=Σ(ok·w)/Σ(w)，w 半衰期72h。
- 跨设备：A 把今日错题导出 wrong/<date>-<node>.md（人读+机读JSON），域内任一设备处理（模型出 错因/补讲/变式题）写回执，A 下次同步读回。会话存 chats/<id>.json（也在账号域、随同步盘）。
- 模型输出硬闸门：必须过 output-schema/1 校验，不合格自动重试≤2次；prompt 里内联 schema。

【请回答 6 问，每问 3-6 句，给可执行判断】
1) chat-first + 我的账本 + 教师视图 这套 IA 对高中生日常学习是否合理？更贴场景的组织是什么？
2) append-only 账本 + 派生 user.md 有哪些退化边界（会话是可变 JSON，多设备并发会不会互相覆盖？user.md 何时重算？）
3) 学习科学：现在只有二值判对错 + 简单间隔，缺哪些关键机制（按优先级）
4) 跨模型「≥95% 字段一致」现实吗？提示词/校验/评测三层各缺什么？
5) 移动端、以及 ESP32 这种最小终端：分别最该砍什么、最该留什么？
6) 只能让我做一件事，你选哪件？

中文、结构化、不确定的标注「不确定」。`;

async function ask(model) {
  const t0 = Date.now();
  try {
    const r = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages: [{ role: "user", content: BRIEF }], temperature: 0.5, max_tokens: 2800, stream: false }),
      signal: AbortSignal.timeout(300000),
    });
    const txt = await r.text();
    if (!r.ok) return { model, ok: false, err: `HTTP ${r.status} ${txt.slice(0, 160)}`, ms: Date.now() - t0 };
    const j = JSON.parse(txt);
    const content = j.choices?.[0]?.message?.content || "";
    const f = path.join(OUT, model.replace(/[/]/g, "_") + ".md");
    fs.writeFileSync(f, content, "utf8");
    return { model, ok: true, ms: Date.now() - t0, content, file: f };
  } catch (e) {
    return { model, ok: false, err: String(e.message || e), ms: Date.now() - t0 };
  }
}

const results = await Promise.allSettled(MODELS.map(ask));
for (const r of results) {
  const v = r.status === "fulfilled" ? r.value : { model: "?", ok: false, err: String(r.reason) };
  if (!v.ok) { console.log(`\n### ${v.model}  ❌ ${v.err}`); continue; }
  console.log(`\n${"=".repeat(70)}\n### ${v.model}  (${(v.ms / 1000).toFixed(0)}s, ${v.content.length} 字)\n${"=".repeat(70)}`);
  console.log(v.content.slice(0, 3000));
}
console.log("\n\n已保存到 tools/preview/opinions/");
