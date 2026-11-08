// tools/ingest/test.mjs
// 端到端自测（全部用系统临时目录，绝不污染真实 packs/）：
//   scaffold 新包 → ingest 教材.md → ingest 出卷.json → validate（断言 0 错误 / KC / 题 / coverage / DAG）
//   → 再 ingest 一遍验证幂等 → validate 真实两个包（应各 0 错误，打印警告数）。
// 全部通过则输出 {"ok":true,...}；失败 process.exitCode = 1。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const FIX = path.join(HERE, "fixtures");

let failures = 0;
function ok(cond, msg) {
  if (!cond) {
    failures++;
    console.error(`  ✗ 断言失败: ${msg}`);
  } else {
    console.log(`  ✓ ${msg}`);
  }
}

function run(script, args) {
  const r = spawnSync(process.execPath, [path.join(HERE, script), ...args], {
    encoding: "utf8",
    cwd: HERE,
  });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

function runOk(script, args, label) {
  const r = run(script, args);
  if (r.status !== 0) {
    console.error(`\n[${label}] 命令失败 (exit ${r.status})`);
    console.error(r.stdout);
    console.error(r.stderr);
    throw new Error(`${label} 失败`);
  }
  return r;
}

function validateJson(packDir) {
  const r = runOk("validate.mjs", [packDir, "--json"], "validate --json");
  // 只取 stdout 里合法的 JSON（防止杂音）
  const text = r.stdout.trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return JSON.parse(text.slice(start, end + 1));
}

function main() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wordo-ingest-test-"));
  const packsDir = path.join(tmpRoot, "packs");
  const packId = "test.subject";
  const packDir = path.join(packsDir, packId);

  console.log("== 1) scaffold 生成新学科包 ==");
  runOk("scaffold.mjs", ["--packs", packsDir, "--id", packId, "--name", "测试学科", "--desc", "自测用", "--author", "WORDOTest"], "scaffold");
  ok(fs.existsSync(path.join(packDir, "subject.json")), "subject.json 已生成");
  ok(fs.existsSync(path.join(packDir, "GUIDE.md")), "GUIDE.md 已生成");
  ok(fs.existsSync(path.join(packDir, "tree", "kc.json")), "tree/kc.json 已生成");
  ok(fs.existsSync(path.join(packDir, "tree", "prereq.json")), "tree/prereq.json 已生成");
  ok(fs.existsSync(path.join(packDir, "items", ".gitkeep")), "items/.gitkeep 已生成");
  ok(fs.existsSync(path.join(packDir, "material", ".gitkeep")), "material/.gitkeep 已生成");
  const subj = JSON.parse(fs.readFileSync(path.join(packDir, "subject.json"), "utf8"));
  ok(subj.schema === "subject-pack/1", "subject.json schema=subject-pack/1");
  ok(subj.version === "0.1.0", "subject.json version=0.1.0");
  ok(subj.license === "CC-BY-SA-4.0", "license 默认 CC-BY-SA-4.0");

  console.log("== 2) ingest Markdown 教材 ==");
  runOk("ingest.mjs", ["--pack", packDir, "--input", path.join(FIX, "教材.md")], "ingest md");
  const kcAfterMd = JSON.parse(fs.readFileSync(path.join(packDir, "tree", "kc.json"), "utf8"));
  ok(kcAfterMd.length === 3, `md 后生成 3 个 KC（实际 ${kcAfterMd.length}）`);
  ok(fs.existsSync(path.join(packDir, "material", kcAfterMd[0].id + ".md")), "material/<kc_id>.md 已生成");
  const mat = fs.readFileSync(path.join(packDir, "material", kcAfterMd[0].id + ".md"), "utf8");
  ok(/^---\nkc_id: /.test(mat), "material 带 YAML front-matter kc_id");
  ok(kcAfterMd.every((k) => Array.isArray(k.toc) && k.toc.length >= 1), "每个 KC 都有 toc 数组");

  console.log("== 3) ingest 结构化出卷 JSON ==");
  runOk("ingest.mjs", ["--pack", packDir, "--input", path.join(FIX, "出卷.json")], "ingest json");
  const kcAfterJson = JSON.parse(fs.readFileSync(path.join(packDir, "tree", "kc.json"), "utf8"));
  const itemsFiles = fs.readdirSync(path.join(packDir, "items")).filter((f) => f.endsWith(".json"));
  const pr = JSON.parse(fs.readFileSync(path.join(packDir, "tree", "prereq.json"), "utf8"));
  ok(kcAfterJson.length === 4, `md+json 后共 4 个 KC（实际 ${kcAfterJson.length}，含 JSON 新增「分数的除法」）`);
  ok(itemsFiles.length === 4, `共 4 道题（实际 ${itemsFiles.length}）`);
  ok(pr.length === 3, `共 3 条先修边（实际 ${pr.length}）`);
  ok(pr.every((e) => e.strength === "hard" || e.strength === "soft"), "先修边 strength 合法");
  ok(pr.every((e) => typeof e.reason === "string" && e.reason.trim() !== ""), "先修边都有 reason");
  // 验证 item 的 kc 引用都被解析成真实 kc id（index 引用与 name 引用混合）
  let allResolved = true;
  for (const f of itemsFiles) {
    const it = JSON.parse(fs.readFileSync(path.join(packDir, "items", f), "utf8"));
    if (!Array.isArray(it.kc_ids) || !it.kc_ids.length) allResolved = false;
    for (const k of it.kc_ids) if (!kcAfterJson.some((x) => x.id === k)) allResolved = false;
    if (it.id !== f.replace(/\.json$/, "")) allResolved = false;
  }
  ok(allResolved, "所有题的 kc_ids 都解析为真实 KC id，且 id 与文件名一致");

  console.log("== 4) validate 断言 ==");
  const v = validateJson(packDir);
  ok(v.errors.length === 0, `错误为 0（实际 ${v.errors.length}）`);
  ok(v.stats.kc === 4, `stats.kc=4（实际 ${v.stats.kc}）`);
  ok(v.stats.items === 4, `stats.items=4（实际 ${v.stats.items}）`);
  ok(v.stats.coverage >= 0.85, `coverage≥0.85（实际 ${v.stats.coverage}）`);
  ok(Array.isArray(v.stats.dangling) && v.stats.dangling.length === 0, `无悬空知识点（实际 ${JSON.stringify(v.stats.dangling)}）`);
  ok(!v.errors.some((e) => e.code === "cycle"), "DAG 无环（无 cycle 错误）");

  console.log("== 5) 幂等性：再 ingest 一遍不应产生重复 ==");
  runOk("ingest.mjs", ["--pack", packDir, "--input", path.join(FIX, "教材.md")], "re-ingest md");
  runOk("ingest.mjs", ["--pack", packDir, "--input", path.join(FIX, "出卷.json")], "re-ingest json");
  const kcAfterRe = JSON.parse(fs.readFileSync(path.join(packDir, "tree", "kc.json"), "utf8"));
  const itemsAfterRe = fs.readdirSync(path.join(packDir, "items")).filter((f) => f.endsWith(".json"));
  ok(kcAfterRe.length === 4, `重复 ingest 后 KC 仍为 4（实际 ${kcAfterRe.length}）`);
  ok(itemsAfterRe.length === 4, `重复 ingest 后题仍为 4（实际 ${itemsAfterRe.length}）`);
  const v2 = validateJson(packDir);
  ok(v2.errors.length === 0, `重复 ingest 后仍 0 错误（实际 ${v2.errors.length}）`);

  console.log("== 6) 校验真实两个包（应各 0 错误） ==");
  const realResults = {};
  for (const name of ["math.high", "english.high"]) {
    const packPath = path.join(REPO_ROOT, "packs", name);
    const rv = validateJson(packPath);
    realResults[name] = { errors: rv.errors.length, warnings: rv.warnings.length, kc: rv.stats.kc, items: rv.stats.items, coverage: rv.stats.coverage_pct };
    ok(rv.errors.length === 0, `packs/${name} 错误为 0（实际 ${rv.errors.length}）`);
    console.log(`     packs/${name}: kc=${rv.stats.kc} 题=${rv.stats.items} 覆盖率=${rv.stats.coverage_pct}%  错误=${rv.errors.length}  警告=${rv.warnings.length}`);
  }

  // 汇总
  const summary = {
    ok: failures === 0,
    tempRoot: tmpRoot,
    pack: { id: packId, kc: v.stats.kc, items: v.stats.items, coverage: v.stats.coverage, dangling: v.stats.dangling },
    real: realResults,
    failures,
  };
  console.log("\n== 结果 ==");
  console.log(JSON.stringify(summary, null, 2));
  if (failures > 0) {
    console.error(`\n❌ 自测未通过：${failures} 项断言失败`);
    process.exitCode = 1;
  } else {
    console.log("\n✅ 全部通过");
  }
}

try {
  main();
} catch (e) {
  console.error(`\n❌ 自测异常终止：${e.message}`);
  process.exitCode = 1;
}
