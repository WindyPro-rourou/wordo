# 学科包规范 subject-pack/1

> **版本**：1（草案，随高中数学/英语两个真实包迭代）
> **状态**：规范 = 正式交付物。改规范 = 版本递增，旧版永久保留。
> **设计原则**：字段能少则少；**GUIDE.md 必需**；纯文本；Git 可分发；AI 可生成、人可校验。

---

## 1. 目录结构

```
<pack>/
├── subject.json      必需 —— 元数据
├── GUIDE.md          必需 —— 本包的资料阅读方法（人读+模型吃）
├── tree/
│   ├── kc.json       必需 —— 知识点数组
│   └── prereq.json   必需 —— 先修关系数组（可为空数组）
├── items/            必需（目录可暂空，但必须存在）
│   └── it_<id>.json  每题一文件
├── material/         可选 —— 每个知识点一份讲解
│   └── <kc_id>.md    MD + YAML front-matter
└── templates/        可选 —— 本包自带呈现模板
```

## 2. subject.json（5 必需 + 可选）

```json
{
  "id": "math.high",              // 必需：全局唯一，反向域名式小写
  "name": "高中数学",              // 必需：显示名
  "version": "0.1.0",             // 必需：semver
  "schema": "subject-pack/1",     // 必需：本规范版本
  "license": "CC-BY-SA-4.0",      // 必需：内容许可（占位，待确认）
  "author": "",                   // 可选
  "description": "",              // 可选
  "depends": [],                  // 可选：依赖的先修包 id 数组
  "language": "zh-CN",            // 可选
  "presentation": ["teaching", "qa"] // 可选：本包提供的 mode
}
```

## 3. tree/kc.json —— 知识点

```json
[
  {
    "id": "kc_hs_math_0001",      // 必需：包内唯一，永不复用
    "name": "集合的概念与运算",     // 必需
    "toc": ["必修一", "第一章 集合与常用逻辑用语", "1.1 集合的概念"], // 必需：章节路径数组
    "difficulty": 0.3,            // 可选：0-1
    "bloom": "记忆|理解|应用|分析|评价|创造", // 可选
    "aliases": ["集合"]            // 可选
  }
]
```

> **纪律**：`toc` 是数组字段而非目录结构 —— **教材改版只改 toc，KC id 与先修关系不动**（「目录树与知识 DAG 分表」精神的文件化实现）。

## 4. tree/prereq.json —— 先修关系

```json
[
  { "from": "kc_hs_math_0001", "to": "kc_hs_math_0002",
    "strength": "hard",         // hard=不会先修就无法学会；soft=有帮助
    "reason": "函数的定义域用集合表示" }
]
```

> 每条边**必须带一句人话 reason** —— 供老师复核（参照 Marble os-taxonomy 的实践）。

## 5. items/it_<id>.json —— 题目

```json
{
  "id": "it_hs_math_0001",
  "type": "single_choice",        // single_choice|multi_choice|fill_blank|short_answer|judge
  "kc_ids": ["kc_hs_math_0001"],  // 必需：≥1 个，题目必须挂知识点
  "stem": "已知集合 A={1,2,3}，B={2,3,4}，则 A∩B=（　）",
  "options": [
    { "key": "A", "text": "{2,3}" },
    { "key": "B", "text": "{1,2,3}" },
    { "key": "C", "text": "{2,3,4}" },
    { "key": "D", "text": "{1,2,3,4}" }
  ],
  "answer": "A",
  "analysis": "交集取共有元素：A 与 B 共有 2 和 3。",
  "difficulty": 0.2,
  "origin": { "source_type": "generated", "source_ref": "draft-v1", "redistributable": true },
  "verification": { "answer_checked_by": "human", "human_reviewed": true }
}
```

> `fill_blank`/`short_answer` 用 `answer_text` 替代 `options`。
> **验收指标**：`item_coverage = 有 kc_ids 的题目 / 总题目 ≥ 0.85`。

## 6. material/<kc_id>.md —— 讲解（可选但强烈建议）

```markdown
---
kc_id: kc_hs_math_0005
styles: [intuitive, formal]
---
# 对数函数

## 直观理解
（学生最先懂的讲法……）

## 规范表述
（严谨定义……）

## 常见误解
- 以为 log₂8 = 8÷2 ……
```

## 7. GUIDE.md 必需内容（最小清单）

1. 这个包**教什么、给谁用**（2 句话）
2. 知识树**怎么读**（kc.json 字段说明，指向本规范）
3. 题目**怎么读**（item 字段说明）
4. **先修关系**的阅读方法（hard/soft 区别）
5. **字段词典**（本包自定义的字段，若有）
6. **一个完整示例**（从树到题走一遍）

> GUIDE.md 是**一份文本两种消费**：人读是手册，喂给模型就是前置提示词的正文（见 prompt-pack/1）。

## 8. 校验

- 每类文件配 JSON Schema（`specs/subject-pack/1/schema/`，随实现补齐）；
- core 提供 `pack validate <目录>`：schema 校验 + KC id 引用完整性 + 先修环检测（DAG 校验）+ item_coverage 统计；
- **先修图必须是 DAG**（有环直接校验失败）。

## 9. 版本与升级

- 包内容变更 → `version` 递增（semver：加题=minor，改结构=major）；
- 本规范升级（`subject-pack/1→2`）→ **旧版规范与 GUIDE 永久保留**（老节点/老模型还要读老包）；
- KC id **永不复用**；KC 合并时保留 `merged_into` 指针。
