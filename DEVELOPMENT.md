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
