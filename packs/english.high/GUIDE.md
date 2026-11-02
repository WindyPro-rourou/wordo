---
pack: english.high
schema: subject-pack/1
---
# GUIDE · 高中英语（english.high v0.1.0）

## 这个包教什么、给谁用
高中英语语法主线，给高中生与考公/考研复习者（语法点通用）。第一版覆盖：一般现在时→一般过去时→现在完成时→定语从句→非谓语动词。

## 文件地图
同 subject-pack/1：`tree/kc.json`（知识点）、`tree/prereq.json`（先修）、`items/`（题）、`material/`（讲解）。

## 怎么读树 / 怎么读题
同 math.high（同一规范），字段说明见 `specs/subject-pack/1/SPEC.md`。

## 本包特有约定
- 英语题的 `stem` 中目标考点用 `___` 标注空位；
- 选项为完整词形（含时态变化），不做拆分；
- 例句一律给**完整句子**，不给出孤词。

## 字段词典（本包自定义）
无自定义字段。

## 完整示例（走一遍）
`kc_eng_0003 现在完成时`（先修 kc_eng_0002 一般过去时，hard，「完成时以过去时的时间轴为参照」）→ `items/it_eng_0002`。