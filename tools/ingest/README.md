# tools/ingest —— WORDO 学科包内容入库管线

把**你自己准备的资料**（Markdown 教材、OCR 文本、出卷网导出的结构化 JSON）灌进一个符合
[`subject-pack/1`](../../specs/subject-pack/1/SPEC.md) 规范的学科包：生成知识树（`tree/kc.json`）、
先修图（`tree/prereq.json`）、题库（`items/`）与讲解素材（`material/`）。

> **边界声明**：本工具**不抓取、不爬取、不内置任何版权内容**。输入资料由用户自备并自行承担版权与
> 许可责任；`origin.source_type` 默认记为 `generated`，`license` 为占位（默认 `CC-BY-SA-4.0`），请按实际来源核对。
> 纯 Node 实现（无第三方依赖，Node ≥ 18，已在 Node 24 验证），跨平台（路径全部走 `path`/`url`）。

---

## 文件清单

| 文件 | 作用 |
|---|---|
| `package.json` | `{name:"wordo-ingest", private, type:"module", bin:{}}`，零依赖 |
| `scaffold.mjs` | 生成符合规格的**最小骨架**（subject.json / GUIDE.md / tree / items / material） |
| `ingest.mjs` | **入库**：md / OCR / 结构化 JSON → 合并进学科包；先校验后落盘，幂等 |
| `validate.mjs` | **校验**：纯 JS 复刻 core `validate-pack` 规则（可作模块或 CLI） |
| `test.mjs` | **端到端自测**（临时目录 + 真实两包，全绿输出 `{"ok":true,...}`） |
| `fixtures/教材.md` | 样例教材（3 个知识点小节） |
| `fixtures/出卷.json` | 样例出卷（4 题 + 先修 + 新增知识点，name/序号混合引用） |
| `README.md` | 本文件 |

---

## 快速开始

```bash
# 1) 新建一个空骨架（<packs>/<id>/）
node tools/ingest/scaffold.mjs --packs packs --id my.chinese --name "我的语文" \
  --desc "自备资料整理" --author "我" --license CC-BY-SA-4.0

# 2) 灌入 Markdown 教材 / OCR 文本
node tools/ingest/ingest.mjs --pack packs/my.chinese --input 我的教材.md

# 3) 灌入出卷 JSON（题目 + 先修，可选新增知识点）
node tools/ingest/ingest.mjs --pack packs/my.chinese --input 出卷.json

# 4) 校验
node tools/ingest/validate.mjs packs/my.chinese
node tools/ingest/validate.mjs packs/my.chinese --json

# 5) 自测整套管线
node tools/ingest/test.mjs
```

> **不要**把测试产物写进 `packs/` 里真实提交的两个包；自测全部用系统临时目录。

---

## CLI 详解

### `scaffold.mjs`
```
node scaffold.mjs --packs <dir> --id <pkg> --name "<显示名>" [--desc ...] [--author ...] [--license CC-BY-SA-4.0] [--force]
```
- `--id` 必须合法：小写、字母开头、**反向域名式**（至少含一个点），仅小写字母/数字/点/连字符，例如 `my.chinese`。
- 生成：`subject.json`（`schema:"subject-pack/1"`、`version:"0.1.0"`、`license` 默认 `CC-BY-SA-4.0`）、
  `GUIDE.md`（按 SPEC §7 六条最小清单填好模板）、`tree/kc.json=[]`、`tree/prereq.json=[]`、
  `items/.gitkeep`、`material/.gitkeep`。
- 目标已存在则**报错不覆盖**；加 `--force` 才允许在已有目录上重建骨架（会重写 `subject.json`/`GUIDE.md`，
  **保留**已有 `kc/prereq/items/material` 内容，避免误删知识数据）。

### `ingest.mjs`
```
node ingest.mjs --pack <包目录> --input <文件> [--format auto|md|json] [--prefix kc_xxx]
```
- `--format auto`（默认）：先尝试按 JSON 解析（顶层为含 `kcs/items/prereq` 的对象即判为 JSON），否则按 Markdown/OCR。
- `--prefix`：自定义新 KC id 前缀（默认 `kc_<包id slug>`），例如 `--prefix kc_my_chinese`。
- **幂等**：重复 ingest 不产生重复 —— KC 按 `name` 去重、题按 `id`（无 `id` 则按 `type+stem`）去重、先修边按 `from→to` 去重。
- **先算后写**：先在内存里合并出完整包模型并跑 `validateModel`，**有任何 error 就报出并放弃写入**（不会写坏数据）。
- 新增 KC 的 id 依次为 `<prefix>_0001`、`<prefix>_0002`……（跳过已占用 id）。

### `validate.mjs`
```
node validate.mjs <包目录> [--json]
```
- 纯 JS 复刻 `core/src/validate.rs` 的 `validate-pack` 规则：subject.json 5 必需字段 + schema 版本、
  GUIDE.md 存在非空、kc.json 合法且 id 唯一字段齐、prereq.json 的 from/to 存在 + strength 合法 + **DAG 环检测**、
  items 的 kc_ids 引用存在 / type 合法 / 选择题 options+answer / id 唯一、统计 `item_coverage` 与 `dangling`（无题挂载的 KC）。
- 人读摘要默认输出；`--json` 输出机器可读：
  `{ errors:[], warnings:[], stats:{ kc, items, coverage, dangling:[], ... } }`（`coverage` 为 0–1 的比例）。
- **有 error 时退出码 1**。

---

## 三类输入格式

### (a) Markdown 教材
按 `#`/`##`/`###` 标题层级解析章节路径 `toc`；**每个「有直接正文」的标题**成为一个知识点，
并把该节正文写成 `material/<kc_id>.md`（含 YAML front-matter `kc_id`）：

```markdown
# 分数的世界

## 分数的意义
把一个整体平均分成若干份……（正文直接挂在 ## 下 → 生成 KC）

## 分数的加减
同分母分数相加减……（生成 KC）
```
- 纯分类标题（如上面 `# 分数的世界`，其下没有直接正文、只有子标题）**不会**单独生成 KC；
  它出现在子 KC 的 `toc` 里（如 `["分数的世界","分数的意义"]`）。

### (b) 结构化 JSON
```json
{
  "kcs": [
    { "name": "分数的意义", "toc": ["分数的世界","分数的意义"], "difficulty": 0.3, "bloom": "理解", "aliases": [] }
  ],
  "items": [
    {
      "id": "it_frac_0001",
      "kc": "分数的意义",              // 也可用 "kc_ids": ["分数的意义"] 或序号 1（指向 kcs 数组，1 基）
      "type": "single_choice",
      "stem": "把一个整体平均分成 4 份，其中的一份是（　）",
      "options": [ {"key":"A","text":"1/2"}, {"key":"B","text":"1/4"} ],
      "answer": "B",
      "analysis": "……",
      "difficulty": 0.2
    },
    { "id": "it_frac_0002", "kc": 2, "type": "judge", "stem": "0.25 等于 1/4。", "answer": "正确", "analysis": "……" }
  ],
  "prereq": [
    { "from": "分数的意义", "to": "分数的加减", "strength": "hard", "reason": "不理解意义就无法理解加减" }
  ]
}
```
- `items[].kc` / `kc_ids` / `kcs` 允许用**知识点 name**、**序号**（1 基，指向本文件的 `kcs` 数组）或**已存在的 kc id** 引用；
  自动解析成真实 kc id。
- `kc` 名与包内已有 KC 同名时**复用**该 KC（不重复建）；不同名则新建。
- `prereq[].from/to` 同样支持 name / 序号 / 已有 id。
- `origin` 缺省时自动补 `{source_type:"generated", source_ref:"ingest", redistributable:true}`，避免 `origin-unset` 警告；
  `verification` 缺省补 `{answer_checked_by:"ingest", human_reviewed:false}`。

### (c) OCR 纯文本
等同 Markdown；**没有任何标题**时整篇作为**一个知识点**，取文首首个非空行作知识点名、`toc=[名]`。

---

## 与 Rust `wordo validate-pack` 的关系

- **Rust `wordo validate-pack` 是权威校验**（随 core 发布）。
- 本工具里的 `validate.mjs` 是**纯 JS 复刻**，用于**没有 Rust 工具链时的本地快速校验**与入库前自检，
  规则对齐 `core/src/validate.rs`（字段、枚举、DAG、覆盖率、悬空 KC 语义一致）。
- 两者若出现差异，以 Rust 为准；发现不一致应以 Rust 规则修订本 JS 版本。

---

## 自测（`test.mjs`）覆盖点

1. `scaffold` 生成骨架并断言各文件存在、`schema/version/license` 正确；
2. `ingest` 教材.md → 断言生成 3 个 KC、`material/<kc_id>.md` 带 front-matter、每个 KC 有 `toc`；
3. `ingest` 出卷.json → 断言共计 4 KC / 4 题 / 3 先修边，且题的 `kc_ids` 全部解析为真实 id（name 与序号混合引用）；
4. `validate --json` 断言 0 错误、`kc=4`、`items=4`、`coverage≥0.85`、无悬空、DAG 无环；
5. **幂等**：再 ingest 一遍，KC 与题数量不变、仍 0 错误；
6. `validate` 真实 `packs/math.high`、`packs/english.high`，各断言 0 错误并打印警告数。

全部通过输出 `{"ok":true,...}` 且退出码 0；任一失败 `process.exitCode=1`。

---

## 已知风险与入库建议（重要）

入库是**内容质量的上游闸门**。以下是最容易出问题的地方（来自多模型评审共识）与建议：

1. **OCR 静默错字**：OCR 把「过氧化钠」识别成「过氧化铀」这类错误一旦入账本，SRS 会围绕错误内容训练。建议 OCR 结果先过 `validate.mjs` 结构校验 + **每批抽 N 题人工确认**；低置信题目标记 `verification.needs_review=true`，暂不用于出题。
2. **引用漂移**：题目挂到不存在 / 被改名的知识点是最常见的静默失败。本工具入库时会自动把 `kc` / `kc_ids` 解析为真实 id，`validate.mjs` 也会报 `item-bad-kc`；改 KC 名 / 删 KC 前先跑校验。
3. **知识树层级歧义**：同一章不同批次可能拆法不同。建议固定 2–3 份真实教材样本做「入库快照对比」，拆树口径一变就能发现（后续可接入 golden 机制）。
4. **批次可回滚**：批量入库（尤其 OCR）建议按批次写 `origin.source_ref`，出问题时能定位并重建受影响范围；账本是 append-only，内容修正应走新的入库版本，而非改历史事件。
5. **版权**：本工具只处理**你自备**的资料，不抓取、不内置版权内容；`origin` / `license` 请如实标注。
