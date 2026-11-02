# DEVELOPMENT · 开发启动

> 状态：**已启动**（2026-11-02）｜ 决策依据：需求基线 v0.7 + 总框架 v2.4

## 技术栈（定稿）
- **核心**：Rust（crate：`core/`）—— 数据、同步、调度、账本、校验全部在核心层
- **壳**：Tauri 2（`apps/desktop` + `apps/mobile`），UI 是壳
- **模型**：纯 API（OpenAI 兼容口子 + 内置预设 + 思考强度），无本地模型
- **数据**：文本为源（MD/JSON/MD+YAML）+ SQLite 派生索引

## 目录
```
core/                  Rust 核心（infar 保密部分，不公开）
apps/desktop|mobile/   Tauri 2 壳
packs/                 学科包（math.high / english.high）
specs/                 三件套规范（subject-pack/1 · prompt-pack/1 · output-schema/1）
docs/                  需求 / 资料 / 大纲
```

## 开发顺序（对齐框架 §14.8 阶段表）
1. **pack validate**：core 的第一个功能——按 subject-pack/1 校验两个真实包（schema + KC 引用 + DAG 环检测 + item_coverage）
2. **加载与渲染**：包加载 → 知识树展示 → 出题
3. **会话闭环**：选 → 测 → 讲（接 prompt-pack/1 + output-schema/1）→ 复测 → 账本
4. **账号域**：密钥对 + 配对 + user.md 域内同步
5. **一致性测试**：3 个 API 模型跑 T1/T2，diff → 收紧 prompt-pack
6. 教学工具层 v0（画板）

## 约定（必读）
- **文本为源**：一切数据先落文本；SQLite 只做可重建索引
- **规范三件套同版本发布**：改格式必须同步改 PROMPT.md 与 SCHEMAS 并递增版本
- **依赖红线**：core 只准 MIT/Apache/BSD 依赖；GPL/AGPL 禁入
- **账本**：每次格式/策略变更留痕（追加式 JSONL）