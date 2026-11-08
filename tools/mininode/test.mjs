// WORDO 最小节点桥 · 端到端自测（test）
// 验证：导出卡片集 → 设备模拟作答 → 入库账本 → 校验完整性 → 幂等重导。
// 用法：node test.mjs        （全绿输出 {"ok":true,...}；失败退出码 1）
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { invoke, readEvents, derive } from "../preview/backend.mjs";
import { buildCardset } from "./export.mjs";
import { simulate } from "./sim.mjs";
import { importAnswers } from "./import.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PACKS = path.join(REPO, "packs");

const failures = [];
const assert = (c, m) => { if (!c) failures.push(m); };

const root = fs.mkdtempSync(path.join(os.tmpdir(), "wordo-mininode-"));
const domain = path.join(root, "domain");
fs.mkdirSync(domain, { recursive: true });

try {
  // 1) 导出卡片集
  const cs = await buildCardset(domain, PACKS, { limit: 8, mode: "all" });
  assert(cs.count > 0, "卡片集为空");
  assert(cs.cards.every((c) => c.kc_id && c.front && c.back), "卡片缺字段");

  // 2) 设备模拟作答
  const answers = simulate(cs.cards, { node: "esp32-test", p: 0.6, seed: 42 });
  assert(answers.length === cs.count, "作答数与卡片数不一致");

  // 3) 入库
  const r1 = importAnswers(domain, answers, PACKS);
  assert(r1.imported === answers.length, `应入库 ${answers.length}，实际 ${r1.imported}`);
  assert(r1.nodes.includes("esp32-test"), "未记录设备节点");

  // 4) 账本完整性（无重复 id / 无 seq 缺口 / 无未知 KC 引用）
  const v = await invoke("verify_ledger", { domain, packsDir: PACKS });
  assert(v.ok === true, `verify_ledger 失败: ${JSON.stringify(v)}`);
  assert((v.duplicate_ids || []).length === 0, "存在重复 id");
  assert((v.seq_issues || []).length === 0, "存在 seq 缺口");

  // 5) 派生稳定 & 事件数对得上
  const evs = readEvents(domain);
  assert(evs.length === answers.length, `账本事件数 ${evs.length} != ${answers.length}`);
  const st1 = derive(domain);
  const st2 = derive(domain);
  assert(st1.events_total === st2.events_total && st1.events_total === answers.length, "derive 不稳定");

  // 6) 幂等：同一批再导一次应全部跳过
  const r2 = importAnswers(domain, answers, PACKS);
  assert(r2.imported === 0 && r2.skipped === answers.length, "重复导入应全部跳过");

  console.log(JSON.stringify({
    ok: failures.length === 0,
    failures,
    cards: cs.count,
    answered: answers.length,
    correct: answers.filter((a) => a.ok).length,
    imported: r1.imported,
    reimport: { imported: r2.imported, skipped: r2.skipped },
    ledgerEvents: evs.length,
    verify: { ok: v.ok, dup: (v.duplicate_ids || []).length, seq: (v.seq_issues || []).length },
  }, null, 2));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
if (failures.length) process.exitCode = 1;
