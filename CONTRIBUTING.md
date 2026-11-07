# 参与共建（CONTRIBUTING）

> 本项目的共建方式是**许愿式 + 资料即完成**：你不需要会写代码，只要能说清「想要什么」或「给什么资料」。

## 一、许可证与前提

- 公开部分采用 **PolyForm Noncommercial License 1.0.0**（见 `LICENSE`）：**个人学习/研究/教学免费；商业使用需书面授权**。
- 核心实现（infar 等）闭源，不在本仓库；本仓库只含公开接口与规范。
- 依赖红线：核心只允许 MIT / Apache-2.0 / BSD；**禁止 GPL / AGPL**。
- 提交即表示你同意以本仓库许可发布你的贡献。

## 二、三种最低门槛的贡献方式

### 1）许愿（Issue）
用「许愿」模板提 Issue：想学什么学科/知识点、希望怎么练、有没有现成资料链接。
不需要格式，交代清楚「学什么 + 会什么程度 + 拿什么检验」即可。

### 2）给资料（最有价值）
教材/讲义/真题的**纯文本或截图**都行（截图会走 OCR）。请说明来源与可公开性；
我们负责把它整理成 `packs/<subject>/` 结构。**请勿提交无授权的整本扫描件**。

### 3）加一个学科包（会一点 JSON 就行）
在 `packs/` 下新建目录：
```
packs/<subject.id>/
  subject.json      # 必填：id / name / version / schema / license / description
  GUIDE.md          # 必填：这份数据怎么读（人读=手册，模型读=前置提示）
  tree/kc.json      # 知识点数组：id / name / toc / difficulty / bloom
  tree/prereq.json  # 先修边：from / to / strength(hard|soft) / reason
  items/*.json      # 每知识点 5–10 道经典题（id 必须等于文件名）
  material/*.md     # 每知识点讲解（front-matter 写 kc_id）
```
**提交前必须跑通：**
```bash
cargo run --manifest-path core/Cargo.toml -- validate-pack packs/<your.pack>
# 结果必须是 0 错误（警告尽量清零）
```
规范细节见 `specs/subject-pack/1/SPEC.md`；题目/讲解字段见同目录示例。

### 4）改代码
- 前端：`apps/desktop/src/`（原生 HTML/CSS/JS，无框架）
- 核心：`core/src/`（Rust；`learn` 账本 / `chat` 会话 / `api` 契约 / `outcheck` 校验）
- 改动请附测试；CI 会跑 `core` 测试、学科包校验、前端语法与无头冒烟、Tauri 编译。

## 三、PR 检查清单

- [ ] `cargo test --manifest-path core/Cargo.toml` 通过
- [ ] `./core/target/debug/wordo validate-pack packs/<包>` 0 错误
- [ ] 若改 `specs/`（规范三件套），三份 `subject-pack/prompt-pack/output-schema` **版本号同步 +1**
- [ ] 不提交任何密钥、`.env`、个人隐私或未授权的第三方内容
- [ ] 提交信息用 `feat:/fix:/docs:/chore:` 前缀

## 四、我们特别欢迎的

1. **经典例题**：每个知识点 5–10 道，带答案与解析（比讲解更难写，价值最高）。
2. **错因标注**：这道题学生典型会怎么错、为什么错。
3. **最小终端**（ESP32 单词机）的题库导出格式建议。

## 五、行为约定

- 教学内容的准确性优先于数量；不确定的标注 `inferred: true` 并写进 `warnings`。
- 不提供「应试作弊」「代写作业」类内容；只提供学习工具与方法。
- 争议内容请附来源，让维护者与社区判断。
