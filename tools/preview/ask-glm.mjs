// 直接向 magpie 网关要 glm-5.3 的第二意见（它读不到文件，所以我们给精炼 brief）
import fs from "node:fs";
import path from "node:path";
const H = process.env.DSH_HOME;
const key = (fs.readFileSync(path.join(H, ".env"), "utf8").match(/^MAGPIE_GATEWAY_KEY=(.*)$/m) || [])[1].trim();
const BASE = "http://127.0.0.1:3425/v1";

const brief = `
【项目】WORDO：去中心化、跨平台、自进化的 AI 学习系统（高中学科为主）。
公理：A1 节点对等（无主从，形态只决定「怎么用」）；A2 内容与呈现分离 + 学科可扩展；A3 变更留痕。

【当前实现】
- Windows 桌面 Tauri2 已跑通；安卓/iPadOS 计划；ESP32 单词机冻结。
- 形态 chat-first：左侧栏=对话历史（新建/切换/删除）；学科不手选，由第一句话自动判定（知识点名命中5分>学科名3>id2>简称1），顶栏胶囊可覆盖。
- 对话意图路由：说「讲讲X」→ 出讲解卡（直观理解/规范表述/判据/例题/常见误解）+ 一道检测题；说「给我出两道题」→ 按账本出题，选项判分写账本；说「我该复习什么」→ 读账本给建议，不调模型。
- 数据层：每设备一个 append-only 账本 ledger/<node>.jsonl（一行一个 answer 事件）；user.md 由全部账本重算派生（薄弱/掌握度/到期/最近错题/委托回执）；复习采用简化 SM-2（错→+4h，对→24h 起倍增，上限30天）；掌握度=Σ(ok·w)/Σ(w)，w 半衰期72h。
- 跨设备：A 设备把今日错题导出成 wrong/<date>-<node>.md（人读表格+机读 JSON），域内任一设备可处理（调模型生成错因/补讲/变式题）写回执 ...result-<node>.md，A 下次同步读回。会话存 chats/<id>.json（也在账号域，随同步盘同步）。
- 模型输出有硬闸门：必须符合 output-schema/1（字段/枚举/引用完整性），不合格自动重试≤2次；prompt-pack 把 schema 内联进提示词以减少模型自造字段。

【请评审，给具体判断而非复述】
1) chat-first + 「我的账本」+ 教师视图 这套 IA，对高中生日常学习是否合理？更贴合场景的组织方式是什么？
2) 数据/同步：append-only 账本 + 派生 user.md 的方案，有哪些会退化的边界？（会话文件多设备并发写会不会互相覆盖？user.md 何时重算？）
3) 学习科学：现在只有「做题判对错 + 简单间隔复习」，缺什么关键机制才算「会学习」？（例如提取练习、交错、间隔、元认知、错题归因闭环）
4) 跨模型一致性：要让多个模型对同一份数据输出≥95%字段一致，提示词/校验/评测三层各缺什么？
5) 移动端与 ESP32 这种最小终端，分别最该砍掉什么、最该保留什么？
6) 如果你只能让我做一件事，做什么？

要求：中文，结构化，直接给判断与可执行建议；不确定的明确标注。
`;

async function ask(model) {
  const t0 = Date.now();
  const r = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages: [{ role: "user", content: brief }], temperature: 0.4, max_tokens: 3000, stream: false }),
    signal: AbortSignal.timeout(300000),
  });
  const txt = await r.text();
  if (!r.ok) { console.log(`[${model}] HTTP ${r.status}: ${txt.slice(0, 300)}`); return null; }
  const j = JSON.parse(txt);
  const content = j.choices?.[0]?.message?.content || "";
  console.log(`\n===== ${model} (${((Date.now() - t0) / 1000).toFixed(1)}s) =====\n`);
  console.log(content);
  fs.writeFileSync(`glm-opinion-${model.replace(/[\/]/g, "_")}.md`, content, "utf8");
  return content;
}

await ask("auto/glm-5.3-flash");
