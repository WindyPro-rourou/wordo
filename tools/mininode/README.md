# 最小节点桥（tools/mininode）——让极简设备也能接入 WORDO

> 对应需求：**每个设备享受类似功能，不因产品形态区分**。自研 ESP32 单词机这类极简设备，
> 只需三件事：**取题 → 写一行 JSON → 文件搬运**。本目录把这「三件事」做成可运行、可自测的参考实现。
> 纯 Node、无依赖、跨平台；**开发/参考用**，不随桌面应用发布。

## 数据协议（极简设备只需理解两个 JSONL 文件）

### ① `cardset.jsonl`（主机 → 设备，一行一张卡）
由 `export.mjs` 从账号域导出。设备只读。
```json
{"kc_id":"kc_eng_0002","kc_name":"一般过去时","pack":"english.high",
 "front":"一般过去时","back":"表示过去某个时间发生的动作……",
 "item":{"id":"it_eng_0001","type":"single_choice","stem":"He ___ to Beijing last year.",
         "options":[{"key":"A","text":"goes"},{"key":"B","text":"went"}],"answer":"B","analysis":"last year 是过去时标志"}}
```
- `front`/`back`：闪卡正反面（背单词用）。
- `item`：可选。有则设备可直接做选择题；无则退化为闪卡自评。

### ② `answers.jsonl`（设备 → 主机，一行一次作答）
设备**只追加**，不解析、不改写。
```json
{"id":"<uuid>","ts":"2026-11-08T10:00:00+08:00","node":"esp32-a1b2","kind":"answer",
 "pack":"english.high","item_id":"it_eng_0001","kc_ids":["kc_eng_0002"],
 "answered":"B","correct":"B","ok":true,"source":"esp32",
 "error_type":null,"confidence":"certain"}
```
- `id` 必须全局唯一（设备生成 uuid/随机串）——`import.mjs` 靠它去重、幂等。
- `ok` 由设备判对错；没有标准答案的闪卡写 `ok` 自评即可，`correct` 填 `"(self-judged)"`。
- `seq` **由主机入库时自动补**，设备不必关心。

## 三条命令

```powershell
# 1) 导出卡片集（到期 > 薄弱 > 新；--mode all 导出全部）
node tools/mininode/export.mjs --packs packs --domain <域目录> --out cardset.jsonl --limit 30

# 2) 设备端作答（这里是模拟器；真实 ESP32 用自己的固件，协议同上）
node tools/mininode/sim.mjs --cardset cardset.jsonl --out answers.jsonl --node esp32-demo --p 0.7

# 3) 搬运回主机入库（去重 + 补 seq + 重算 user.md）
node tools/mininode/import.mjs --domain <域目录> --in answers.jsonl --packs packs
```

自测（端到端，含幂等与账本完整性）：
```powershell
node tools/mininode/test.mjs    # 期望 {"ok":true,...}
```

## 与 ESP32 的映射
- 文件系统：把 `cardset.jsonl` / `answers.jsonl` 放 SD 卡或 SPIFFS/LittleFS。
- 解析：ArduinoJson / cJSON 逐行解析；只需认上面列出的字段。
- 落盘：每答一题 `append` 一行到 `answers.jsonl`（掉电只丢最后一行，不影响已写）。
- 搬运：SD 卡插拔，或 WiFi 上传，或串口传回主机；主机跑 `import.mjs` 即可。
- 参考草图见 [`embed/esp32-node/`](../../embed/esp32-node/)（**未在本仓库编译验证**，需按你的板子适配）。

## 诚实边界
- 本目录是**参考实现与协议样例**，`sim.mjs` 是软件模拟器，不是真实硬件固件。
- ESP32 能力边界（屏幕/语音/FSRS 放设备端）见 `docs/资料/11-ESP32单词机端能力边界.md`。
- 真实硬件固件需按具体开发板、屏幕、按键与存储库适配；本节不宣称已完成硬件联调。
