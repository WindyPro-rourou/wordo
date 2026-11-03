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
| Rust | stable **1.99.1 x86_64-pc-windows-msvc**（默认工具链，rsproxy 镜像）→ `%USERPROFILE%\.cargo`；GNU 工具链保留作 fallback（core CLI 可用） |
| MSVC | **VS 2022 Build Tools**（VCTools workload + Windows SDK），cl.exe/link.exe = 14.44.35207 → `C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools` |
| WebView2 | Runtime **156.0.4314.58**（Tauri 渲染依赖） |
| 镜像 | `%USERPROFILE%\.cargo\config.toml` = rsproxy sparse（crates.io 换源） |
| **中文路径坑** | GNU ld 处理不了中文路径（对象文件报 No such file）→ 仓库根 `.cargo/config.toml` 已把 target-dir 固定到 **`C:/wordo-build/target`**（C 盘稳定，不受数据盘盘符切换影响） |
| git | 系统未装 → 便携版 `F:\dsh-admited\data\dsh-home\env\git\cmd\git.exe`（2.56.0；仓库已本地配置 user.name/email） |
| Node | v24.13.0 / npm 11.6.2（Tauri 壳用） |

### 网络实测结论（2026-11-02，反直觉但已复核）

| 通道 | 结果 |
|---|---|
| crates.io / rsproxy | ✅ 直连可用（cargo 全程走 rsproxy，无问题） |
| registry.npmjs.org | ✅ **直连可用**（16s 装完 @tauri-apps/cli） |
| registry.npmmirror.com | ❌ **超时**（与本机 7890 代理未开无关，直连也不通） |
| github.com | ❌ 需代理（既有结论） |

> **结论：npm 就用官方源**，不要迷信国内镜像。写 npm 脚本时不加 `--registry`。

### GNU 工具链 vs Tauri（结论：必须 MSVC）

- Tauri 依赖栈在 windows-gnu 下首个失败点：`error calling dlltool 'dlltool.exe': program not found`（parking_lot_core）。
- dlltool 其实 rustup **自带**：`%USERPROFILE%\.rustup\toolchains\stable-x86_64-pc-windows-gnu\lib\rustlib\x86_64-pc-windows-gnu\bin\self-contained\`，只是不在 PATH——把它加进 PATH 可解这一步，但 **Tauri 官方在 Windows 仅支持 MSVC**，后面 wry/webview2 仍可能踩坑。
- **决策：安装 VS Build Tools（VCTools workload）并切换 `stable-msvc`**（安装中；Flutter Windows 桌面构建将来也需要它）。
- GNU 工具链保留：core 的 CLI（validate/inspect）在 gnu 上已验证可编译运行，作为无 MSVC 环境的 fallback。

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
- [x] **M2（2026-11-02）Tauri 2 桌面壳 + 包加载渲染**：core 拆为 lib+bin，新增 `inspect-pack`（GUI 数据层的 headless 版）；Tauri 2 壳（`list_packs` / `load_pack` 两个命令，薄封装）；前端按 `minimalist-ui` skill 重写（暖单色 + 编辑风 + 衬线标题 + 柔和 pastel 徽章 + IntersectionObserver 错峰渐显）；实测：MSVC 编译通过（191 依赖 crate）→ **12.2 MB exe → 启动成功，WebView2 渲染进程正常**。三页签：知识树 / 题目（手风琴）/ 校验报告。
- [ ] M3：会话闭环（prompt-pack/1 + output-schema/1 接入）+ 账本
- [ ] M4：三模型一致性测试第一轮
## M3（进行中）· 内容呈现 + 模型接入

**已落地**
- `core/src/prompt.rs`：提示词装配（`prompt-pack/1` 编译内嵌 + 注入 GUIDE.md/kc.json/题目索引），占位符 `{{READING_GUIDE}}`
- `core/src/outcheck.rs`：按 `output-schema/1` 校验模型输出（字段/枚举/引用完整性/T1·T2）
- `core/src/config.rs`：提供方预设（**NVIDIA NIM 首位**、DeepSeek、Kimi、通义、OpenAI、自定义）+ 配置读写
- 壳层：`ask_model`（reqwest + rustls，OpenAI 兼容 /chat/completions）、`get_config`/`set_config`/`build_prompt`
- 前端：**学习**页签（KC 横向选择 → 预置讲解渲染 → 让 AI 讲一遍 → 检测题 → 错因分析 → 练习点击即判）、**设置**页签
- 素材：math 3 篇 + english 2 篇（共 5 篇 KC 讲解，四段式：直观理解/规范表述/常见误解/代表例题）

**API Key 存放**：`%APPDATA%\app.wordo.desktop\config.json`（应用配置目录，**不在仓库内**，不随 git 提交）。

**待办**：填 Key 后跑真机联调 → M4 三模型一致性测试第一轮。

## M3.1 · 首次真机联调（NVIDIA NIM 实测）

- **认证/端点**：`https://integrate.api.nvidia.com/v1` 直连可用（无需代理）
- **踩坑**：预设里的 `meta/llama-3.3-70b-instruct` 已于 2026-08-26 EOL → HTTP 410。
  **教训：模型清单必须以 `GET /v1/models` 实测为准**，不要凭记忆写预设。实测可用清单（部分）：
  `deepseek-ai/deepseek-v4.1-flash`、`nvidia/nemotron-3-super-120b-a12b`、`nvidia/nemotron-3.5-lightning-30b-a3b`、
  `moonshotai/kimi-k2.6`、`z-ai/glm-5.3-flash`、`openai/gpt-oss-20b`、`mistralai/mistral-large-4t-a52b`
- **架构收敛**：HTTP 调用收进 `core/src/llm.rs`（唯一实现），CLI 与 GUI 同一条路径；GUI 通过 `spawn_blocking` 调用，避免阻塞 UI
- **校验闸门实测有效**：未注入素材时首轮输出不合格、自动重试 1 次后通过（attempts=2）；
  **注入该 KC 的预置讲解素材后首轮即通过**（attempts=1）——素材是「输出稳定」的关键输入，不只是给人看的
- **新增 CLI**：`wordo prompt`（只装配提示词，便于审阅）· `wordo ask`（真调模型，含重试）——M4 跨模型一致性测试的基础设施

## M4 · 学习环路落地（体系核心）

**从「能看」到「能闭环」**：新增 `core/src/learn.rs`（约 700 行），把用户描述的环路真正实现出来。

### 数据模型（文本为源，结构上无冲突）
```
<domain>/                       # 账号域（放同步盘即为同步通道）
  node.json                     # 本机节点身份
  settings.md                   # 个性化设置（随域同步）
  ledger/<node>.jsonl           # ★ 每节点 append-only 账本 = 唯一事实
  user.md                       # ★ 派生：学习者状态（谁都能重算 → 无冲突）
  plan.md                       # 学习计划（append-only）
  wrong/<date>-<node>.md        # 委托文书（人读表格 + 机读 JSON 块）
  wrong/<date>-<node>.md.result-<by>.md   # 委托回执
```

### 已实测通过的环路
1. **作答 → 账本**：`learn-answer` 写事件，判分 + 计算掌握度与下次复习时间
2. **账本 → user.md**：薄弱表 / 今日复习队列 / 最近错题 / 已掌握 / 其他设备回执，全部由账本派生
3. **复习间隔**：错 → +4h；对 → +24h 起倍增（上限 30 天）——实测 4h → 24h → 48h 正确推进
4. **掌握度**：`Σ(ok·w)/Σ(w)`，w 半衰期 72h（实测 0.33 → 0.50 随连对上升）
5. **跨设备委托**（两节点实测）：pc-a1b2 导出错题 → pc-b9f0 调 T3 处理（首轮通过校验）→ 写回执 → pc-a1b2 同步读回，user.md 出现「其他设备帮我处理的委托」
6. **学习计划**：`learn-plan` append-only 任务清单，完成状态记在账本

### 规范三件套同步升级（T3）
`prompt-pack/1` 增加 T3 review-wrong 规程；`output-schema/1` 增加 T3 结构与校验规则；`outcheck.rs` 实现 T3 校验。

### 新增 CLI（headless，M4 跨模型测试的基础设施）
```
wordo learn-sync / learn-state / learn-due / learn-queue / learn-answer / learn-session
wordo learn-delegate / learn-review / learn-plan
```
全部支持 `--domain`（默认 `%APPDATA%\app.wordo.desktop\domain\default`）、`--packs`、`--node`（可显式扮演某个节点，用于多节点演练）。

### 设计要点（值得记住）
- **无冲突不是靠 merge 算法，而是靠结构**：每节点只追加自己的文件，user.md/plan 视图都是派生
- **素材是稳定的关键输入**：注入 KC 素材后，模型首轮通过校验（注入前需重试 1 次）
- **ESP32 只需三件事**：取题、写一行 JSON、文件搬运——见 `docs/大纲/04-节点接口与最小节点-v0.1.md`
