# ESP32 单词机 · 最小节点（参考草图）

> **状态：参考草图，未在本仓库编译验证。** 需按你的具体开发板（屏幕/按键/存储库）适配后再上机。
> 协议与数据格式见 [`tools/mininode/README.md`](../../tools/mininode/README.md)。ESP32 只做三件事：
> **取题（读 cardset.jsonl）→ 写一行 JSON（追加 answers.jsonl）→ 文件搬运（SD 卡或 WiFi 回传主机）**。

## 为什么这么设计
- ESP32 是**完整节点**（框架公理 A1），但算力/存储有限：不在设备上跑模型，只做「卡片呈现 + 判分 + 落一行 JSON」。
- 真正的调度、账本、派生全部在主机 `core`（Rust）里；设备产出的 `answers.jsonl` 由 `tools/mininode/import.mjs` 入库。
- 掉电安全：只 append，一行一题。

## 硬件建议（详见 docs/资料/11）
- 主控：ESP32-S3（带 PSRAM 更好，屏幕刷新更顺）。
- 存储：microSD（存 cardset/answers，最省事）或 LittleFS。
- 屏幕：1.5"~2.4" SPI TFT / e-ink；按键 4 个或触摸。
- 语音：如需发音，用 I2S + 预置音素/单词音频（sherpa-onnx **不支持** ESP32，端上别指望跑 ASR/TTS）。

## 参考固件骨架（Arduino 框架 + ArduinoJson + SD）

```cpp
// main.cpp —— 参考草图，请按你的板子改引脚与库
#include <Arduino.h>
#include <SD.h>
#include <ArduinoJson.h>

// ---- 按你的板子修改 ----
static const int SD_CS = 5;              // SD 卡片选
static const char* CARDSET = "/cardset.jsonl";
static const char* ANSWERS = "/answers.jsonl";

File answerFile;

// 生成一个足够唯一的 id（设备侧）；生产建议用 RNG 初始化后生成 UUID4
String genId() {
  char buf[40];
  snprintf(buf, sizeof(buf), "esp32-%08lx-%04x", (unsigned long)millis(), (unsigned)random(0xFFFF));
  return String(buf);
}

void appendAnswer(const String& cardJson, const String& answered, bool ok,
                  const String& kcId, const String& pack, const String& itemId) {
  // 解析卡片拿 correct（有 item 时）
  StaticJsonDocument<2048> card;
  if (deserializeJson(card, cardJson)) return;
  String correct = card["item"]["answer"] | "(self-judged)";
  // 拼一行 answers.jsonl
  StaticJsonDocument<1024> out;
  out["id"] = genId();
  out["ts"] = "1970-01-01T00:00:00Z";      // TODO: 接 RTC/SNTP 填真实时间
  out["node"] = "esp32-a1b2";              // TODO: 每台设备唯一
  out["kind"] = "answer";
  out["pack"] = pack;
  out["item_id"] = itemId;
  JsonArray kcs = out.createNestedArray("kc_ids");
  kcs.add(kcId);
  out["answered"] = answered;
  out["correct"] = correct;
  out["ok"] = ok;
  out["source"] = "esp32";
  out["error_type"] = nullptr;
  out["confidence"] = "certain";
  serializeJson(out, answerFile);
  answerFile.println();
  answerFile.flush();
}

void setup() {
  Serial.begin(115200);
  if (!SD.begin(SD_CS)) { Serial.println("SD mount failed"); return; }
  answerFile = SD.open(ANSWERS, FILE_APPEND);
  File cards = SD.open(CARDSET, FILE_READ);
  if (!cards) { Serial.println("no cardset.jsonl"); return; }

  // 逐行读卡片；这里演示：显示卡片 → 等你按键选 A/B/C/D（省略具体屏幕/按键代码）
  while (cards.available()) {
    String line = cards.readStringUntil('\n');
    if (line.length() < 2) continue;
    StaticJsonDocument<2048> card;
    if (deserializeJson(card, line)) continue;

    const char* front = card["front"] | "";
    const char* kcId  = card["kc_id"] | "";
    const char* pack  = card["pack"]  | "";
    const char* itemId = card["item"]["id"] | "";
    // TODO: 在你的屏幕上渲染 front / item.stem，等待按键得到 answered
    String answered = "A";        // 占位：真实实现来自按键
    bool ok = false;              // 占位：真实实现对 item.answer 比较
    appendAnswer(line, answered, ok, kcId, pack, itemId);
  }
  cards.close();
}

void loop() { /* 可选：空闲时检查新 cardset 或进入低功耗 */ }
```

## 上机前检查清单
- [ ] SD 卡能挂载，`/cardset.jsonl` 存在（由主机 `export.mjs` 生成）。
- [ ] `node` 字段每台设备唯一（多台设备入库不撞 id）。
- [ ] `id` 全局唯一（否则 `import.mjs` 会当重复跳过）。
- [ ] 时间戳可先用占位，但**建议接 RTC/SNTP**，否则账本按时间排序会退化。
- [ ] 答题只 `append`，不用整文件重写（掉电安全）。
