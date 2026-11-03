# 输出 schema output-schema/1

> **版本**：1（草案）｜ **消费者**：core 校验器（模型输出必须通过校验才被采纳）
> **原则**：枚举优先于自由文本；字段固定；顺序无关但字段齐全；每类输出都有 `warnings` 逃生口。
> **格式**：JSON Schema Draft 2020-12（实现时可据此生成各语言校验器）。

---

## 1. 通用外壳（所有任务共有）

```json
{
  "task": "classify-error | explain",      // 必需
  "schema_ver": "1",                        // 必需
  "warnings": []                            // 必需：字符串数组，无则空
}
```

## 2. T1 · classify-error（错因归类）

```jsonc
{
  "task": "classify-error",
  "schema_ver": "1",
  "warnings": [],
  "item_id": "it_xxx",                      // 必需：题目 id
  "answered": "C",                          // 必需：学习者作答（选项 key 或文本）
  "correct": "A",                           // 必需：正确答案
  "error_type": "concept_confused",         // 必需，枚举：
      // none | knowledge_missing | concept_confused |
      // method_missing | calculation_slip | misread
  "secondary_factor": null,                 // 可空，枚举同上（不含 none）
  "root_cause_kc_id": "kc_xxx",             // 必需可为 null：只能取数据中存在的 kc_id
  "confidence": 0.8,                        // 必需：0-1
  "suggested_action": "review_prereq",      // 必需，枚举：
      // review_prereq | re_explain | drill_similar | split_concept |
      // retry_later | none
  "notes": "",                              // 必需：一句人话（≤100 字）
  "inferred": false                         // 必需：结论是否由推断得出（数据未明示=true）
}
```

## 3. T2 · explain（讲解生成）

```jsonc
{
  "task": "explain",
  "schema_ver": "1",
  "warnings": [],
  "kc_id": "kc_xxx",                        // 必需
  "prereq_gap": null,                       // 必需可为 null：先修缺口 kc_id（先修未掌握时先填它）
  "explanation_md": "……",                   // 必需：Markdown，含直观类比 + 规范表述
  "worked_example": "……",                   // 必需：Markdown 工作例题
  "misconceptions": ["……"],                 // 必需：数组（可为空）
  "followup_question": {                    // 必需：后续检测题
    "stem": "……",
    "options": ["A…", "B…", "C…", "D…"],    // 恰 4 个（single_choice）
    "answer": "B"
  },
  "tool_hints": ["graph-plot"],             // 必需：枚举数组
      // canvas-geometry | graph-plot | physics-sim |
      // timeline | mindmap | answer-board | none
  "inferred": false                         // 必需
}
```

## 4. 校验规则（core 实现清单）

1. **schema 结构校验**：必填字段齐全、枚举值合法、类型正确；
2. **引用完整性**：`root_cause_kc_id` / `kc_id` / `prereq_gap` 必须存在于当前学科包的 `tree/kc.json`；
3. **答案可验证性**：`followup_question.answer` 必须在 `options` 范围内；
4. **一致率统计**（§16.5）：同一任务喂 N 个模型，**逐字段比对**——枚举/ID/布尔/数字字段必须完全一致才计「一致」；`explanation_md` 等叙述字段按「语义等价」人工抽检，不进一致率分母；
5. 校验失败 → 该输出**丢弃并重试**（同一模型最多重试 2 次），仍失败则降级到更高档位模型并在账本记录。

---

## 5. 后续任务类型（占位，按阶段补充）

| 任务 | schema | 阶段 |
|---|---|---|
| T3 复习排程建议 | `schedule.schema.json` | ③ |
| T4 变式题生成 | `variant.schema.json` | ③ |
| T5 许愿式整包生成 | `pack-draft.schema.json` | ⑤ |
| T6 计划拆解 | `plan.schema.json` | ④ |

## 6. 版本记录

| 版本 | 日期 | 变更 |
|---|---|---|
| 1 | 2026-11-02 | 首版：通用外壳 + T1/T2 两类 + 校验规则（含一致率统计口径）+ 后续任务占位 |

## 五、T3 `review-wrong`（委托处理）

**触发**：处理账号域内 `wrong/<date>-<node>.md` 的委托文书。

| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `task` | string | ✅ | 必须为 `"review-wrong"` |
| `schema_ver` | string | ✅ | `"1"` |
| `warnings` | string[] | ✅ | 无则 `[]` |
| `reviews` | object[] | ✅ | 非空；每项对应一道被委托的错题 |
| `inferred` | bool | ✅ | 是否含推断内容 |

`reviews[i]`：

| 字段 | 类型 | 约束 |
|---|---|---|
| `item_id` | string | 必须来自委托文书 items |
| `kc_id` | string | 必须存在于学科包 kc.json |
| `why_wrong_md` | string | ≥4 字符；讲清「为什么这么选是错的」 |
| `fix_md` | string | ≥8 字符；可操作的补丁式讲解 |
| `variant` | object | `{stem, options[≥2], answer}`，同知识点换情境 |

**校验（core/src/outcheck.rs 实现）**：字段齐全、`reviews` 非空、`kc_id` 引用有效、`why_wrong_md`/`fix_md` 长度、`variant` 三件套完整。不合格 → 回灌重试（≤2 次）。

**一致性度量**：跨模型比较时，T3 的**结构字段**（reviews 数量、item_id 集合、variant.answer 是否为合法选项）必须 ≥95% 一致；讲解文字允许风格差异。
