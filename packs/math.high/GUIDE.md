---
pack: math.high
schema: subject-pack/1
---
# GUIDE · 高中数学（math.high v0.1.0）

## 这个包教什么、给谁用
高中数学（人教 A 版必修一起步），给高中学生与自学者。第一版只覆盖函数主线（集合→函数→单调性→指数→对数），作为格式试验田。

## 文件地图
| 文件 | 内容 |
|---|---|
| `tree/kc.json` | 知识点数组（id/name/toc/difficulty/bloom/aliases） |
| `tree/prereq.json` | 先修边（from/to/strength/reason） |
| `items/it_*.json` | 题目（题干/选项/答案/解析/kc_ids） |
| `material/<kc_id>.md` | 每个知识点的讲解（front-matter 带 kc_id 与 styles） |

## 怎么读树
`kc.json` 每个 KC 的 `toc` 是章节路径数组（教材改版只改它，id 不动）。
`prereq.json` 的 `strength`：`hard`=不学会它就无法学会后继；`soft`=有帮助。`reason` 是给人复核用的一句解释。

## 怎么读题
`items/it_*.json`：`type` 为题型；`options` 仅选择类题型有；`answer` 为选项 key 或文本；`kc_ids` 是题目挂载的知识点（每题 ≥1 个）；`origin` 记来源与可分发性；`verification` 记校验状态。

## 字段词典（本包自定义）
无自定义字段——全部遵循 subject-pack/1。

## 完整示例（走一遍）
从 `kc_hs_math_0004 指数函数`（先修 kc_0002 函数概念，hard，"单调性依赖函数定义"）→ `items/it_hs_math_0003` 比较大小题 → 讲解见 `material/kc_hs_math_0004.md`。

## 已知边界
本包是**格式试验田**：题量远未达标（每 KC 目标 5–10 道，现仅 2–3 道示意）。