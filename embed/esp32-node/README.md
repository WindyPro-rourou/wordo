# ESP32 单词机 · 最小节点（参考实现）

本目录是 **ESP32 极简节点的参考草图**，演示「取题 → 写一行 JSON → 文件搬运」三件事。

- 协议与数据格式：见 [`tools/mininode/README.md`](../../tools/mininode/README.md)
- 端到端（软件）可运行验证：`node tools/mininode/test.mjs`（导出→模拟作答→入库→校验）
- 硬件能力边界：见 [`docs/资料/11-ESP32单词机端能力边界.md`](../../docs/资料/11-ESP32单词机端能力边界.md)
- 固件草图：[`main.cpp`](main.cpp) —— **未在本仓库编译验证**，需按你的板子/屏幕/存储库适配。

## 定位
- ESP32 是**完整节点**（框架公理 A1：节点对等），但算力有限：不在设备上跑模型，只做卡片呈现、判分、落一行 JSON。
- 调度 / 账本 / 派生都在主机 `core`（Rust）；设备产出的 `answers.jsonl` 由 `tools/mininode/import.mjs` 入库。
- 掉电安全：只追加，一行一题。

## 三件事
1. **取题**：把主机 `export.mjs` 生成的 `cardset.jsonl` 放到 SD 卡 / LittleFS。
2. **写一行 JSON**：每答一题，向 `answers.jsonl` 追加一行（字段见协议文档）。
3. **文件搬运**：SD 卡插拔、WiFi 上传或串口传回主机 → 主机跑 `import.mjs`。

> 诚实声明：本目录为参考实现与协议样例，不是已完成硬件联调的固件。真实产品需按具体硬件适配并实测。
