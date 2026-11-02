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

## 构建环境（2026-11-02 已配置）

| 项 | 状态 |
|---|---|
| Rust | stable **1.99.1 x86_64-pc-windows-gnu**（rustup minimal，rsproxy 镜像）→ `%USERPROFILE%\.cargo` |
| 镜像 | `%USERPROFILE%\.cargo\config.toml` = rsproxy sparse（crates.io 换源） |
| **中文路径坑** | GNU ld 处理不了中文路径（对象文件报 No such file）→ 仓库根 `.cargo/config.toml` 已把 target-dir 固定到 **`C:/wordo-build/target`**（C 盘稳定，不受数据盘盘符切换影响） |
| git | 系统未装 → 便携版 `F:\dsh-admited\data\dsh-home\env\git\cmd\git.exe`（2.56.0；仓库已本地配置 user.name/email） |
| Node | v24.13.0 / npm 11.6.2（Tauri 壳用；建议 npm 走 npmmirror） |

## 常用命令

```powershell
# 编译（在 core/ 下）
cd core; cargo build
# 可执行文件在 C:\wordo-build\target\debug\wordo.exe

# 校验学科包
C:\wordo-build\target\debug\wordo.exe validate-pack <包目录> [--json]
```

## 里程碑

- [x] **M1（2026-11-02）`pack validate` v0.1**：subject-pack/1 全规则落地（元数据 / GUIDE / KC / 先修 **DAG 环检测** / 题目规则 / 挂载率 / dangling-KC）。两个真实包实测：math.high **0 错误 1 警告**、english.high **0 错误 2 警告**——dangling-KC 信号即刻指出缺题位置（函数的概念 / 一般现在时 / 非谓语动词）。`--json` 机器接口可解析。git 首提交 `d5e54b8`（47 文件）。
- [ ] M2：Tauri 2 桌面壳 + 包加载渲染
- [ ] M3：会话闭环（prompt-pack/1 + output-schema/1 接入）+ 账本
- [ ] M4：三模型一致性测试第一轮