# 无头预览与自迭代工具（开发用，不随应用发布）

用途：在**不弹窗、不干扰使用者**的前提下，把 `apps/desktop/src` 的真实前端放进 Chromium 里跑，
连到真实的 `packs/` 数据与真实模型（magpie 网关），自动巡检布局缺陷并截图。

## 依赖
- Node 18+（本机 24）
- `npm i` 后可用 `playwright-core`；浏览器用系统自带 Edge（`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`），无需下载

## 结构
```
tools/preview/
  backend.mjs      # 与 core/src/api.rs 同契约的 Node 实现（读真实 packs + 同格式账本 + 真调模型）
  server.mjs       # 静态托管 apps/desktop/src + /api/<command> 桥接 + 注入 Tauri 垫片
  shim.js          # window.__TAURI__.core.invoke → fetch('/api/…')
  seed.mjs         # 生成演示账号域（多天作答、薄弱点、他人委托）
  shoot.mjs        # 多视口 × 多页签巡检：截图 + 溢出/遮挡/截断/小字/控制台错误
  ai-test.mjs      # 端到端：点「让 AI 讲一遍」→ 真调模型 → 校验渲染 + 错因分析
  interact.mjs     # 交互回归：学习计划增/勾、开始复习跳转、同步域、导出错题、处理委托
  probe*.mjs       # 定点排查脚本（顶栏遮挡 / 数据流 / 请求体）
```

## 跑法
```powershell
cd tools/preview
node seed.mjs                      # 造演示域
node server.mjs --port 4310        # 起预览（后台）
node shoot.mjs --port 4310 --round 11
node ai-test.mjs
node interact.mjs
```
配置：`.config.json`（含 key，已 gitignore）。切到 magpie 网关：`node use-magpie.mjs`。

## 注意
- `backend.mjs` 是**开发替身**，不是产品代码；产品逻辑在 `core/`（Rust）。两者契约一致（同一份 `specs/prompt-pack/1/PROMPT.md`、同一套字段名）。
- 账本格式与 Rust 完全一致（`ledger/<node>.jsonl`，append-only），所以在预览里产生的数据可以直接被真应用读取。
- 截图在 `shots/`，报告在 `report-rNN.json`（均已 gitignore）。
