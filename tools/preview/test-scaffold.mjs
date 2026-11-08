// 契约回归：scaffold_pack（新建学科）——与 core::api::scaffold_pack / Tauri 命令同契约。
// 断言：生成符合 subject-pack/1 的最小骨架、校验 0 error、重复/非法 id 报错、可被 list_packs/load_pack 读到。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { invoke } from "./backend.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "wordo-scaffold-"));
const packs = path.join(root, "packs");
fs.mkdirSync(packs, { recursive: true });

let failures = [];
const assert = (cond, msg) => { if (!cond) failures.push(msg); };

try {
  const r = await invoke("scaffold_pack", { packsDir: packs, id: "my.chinese", name: "我的语文", description: "回归测试" });
  assert(r && r.ok === true, "scaffold 未返回 ok:true");
  assert(r.pack === "my.chinese", "返回 pack id 不对");
  const dir = path.join(packs, "my.chinese");
  for (const f of ["subject.json", "GUIDE.md", "tree/kc.json", "tree/prereq.json"]) {
    assert(fs.existsSync(path.join(dir, f)), `缺少文件 ${f}`);
  }
  assert(fs.statSync(path.join(dir, "items")).isDirectory(), "缺少 items/ 目录");
  const meta = JSON.parse(fs.readFileSync(path.join(dir, "subject.json"), "utf8"));
  assert(meta.schema === "subject-pack/1", "schema 版本不对");
  assert(meta.name === "我的语文", "name 未写入");

  const list = await invoke("list_packs", { packsDir: packs });
  const found = (list.packs || []).find((p) => p.subjectId === "my.chinese");
  assert(!!found, "list_packs 未列出新学科");
  assert(found && found.errors === 0, `新学科应有 0 error，实际 ${found && found.errors}`);

  const lp = await invoke("load_pack", { packPath: dir });
  assert(Array.isArray(lp.kcs) && lp.kcs.length >= 1, "starter 应至少含 1 个知识点（示例）");
  assert(Array.isArray(lp.items) && lp.items.length >= 1, "starter 应至少含 1 道题（示例）");

  // 重复创建应报错
  let dupErr = null;
  try { await invoke("scaffold_pack", { packsDir: packs, id: "my.chinese", name: "x" }); } catch (e) { dupErr = e; }
  assert(!!dupErr, "重复创建未报错");

  // 非法 id 应报错
  let badErr = null;
  try { await invoke("scaffold_pack", { packsDir: packs, id: "Bad Id!", name: "x" }); } catch (e) { badErr = e; }
  assert(!!badErr, "非法 id 未报错");

  // 第二个学科：无点的简单 id 也应允许（与 validate 规则一致）
  const r2 = await invoke("scaffold_pack", { packsDir: packs, id: "physics", name: "物理" });
  assert(r2 && r2.ok === true, "简单 id(physics) 应允许创建");

  console.log(JSON.stringify({ ok: failures.length === 0, failures, created: ["my.chinese", "physics"] }, null, 2));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
if (failures.length) process.exitCode = 1;
