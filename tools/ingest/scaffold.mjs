// tools/ingest/scaffold.mjs
// 生成符合 subject-pack/1 规范的最小骨架。
//   node scaffold.mjs --packs <dir> --id <pkg> --name "<显示名>" [--desc ...] [--author ...] [--license CC-BY-SA-4.0] [--force]
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// 反向域名式：小写字母开头，至少含一个点；各段仅小写字母/数字/连字符
const ID_RE = /^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/;

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (typeof a === "string" && a.startsWith("--")) {
      const key = a.slice(2);
      if (key === "force" || key === "help" || key === "h") {
        out[key === "h" ? "help" : key] = true;
      } else {
        const v = argv[i + 1];
        if (v === undefined || (typeof v === "string" && v.startsWith("--"))) {
          out[key] = true;
        } else {
          out[key] = v;
          i++;
        }
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

function guideTemplate(id, name) {
  return `---
pack: ${id}
schema: subject-pack/1
---
# GUIDE · ${name}（${id} v0.1.0）

## 1. 这个包教什么、给谁用
本包是「${name}」学科包，面向学习该学科的读者（请在此写清 2 句话：覆盖范围 + 目标人群）。
本文件是把学习资料喂给模型时的前置说明正文，也是人读的手册。

## 2. 知识树怎么读（tree/kc.json）
\`kc.json\` 是知识点数组，每个元素含：
- \`id\`：包内唯一、永不复用（如 \`kc_xxx_0001\`）；
- \`name\`：知识点名；
- \`toc\`：章节路径数组（教材改版只改它，id 不动）；
- \`difficulty\`（0–1，可选）、\`bloom\`（记忆/理解/应用/分析/评价/创造，可选）、\`aliases\`（别名，可选）。
字段完整说明见 \`specs/subject-pack/1/SPEC.md\` §3。

## 3. 题目怎么读（items/it_*.json）
每题一个文件。\`type\` 为题型（single_choice / multi_choice / fill_blank / short_answer / judge）；
\`options\` 仅选择题有（\`{key,text}\`）；\`answer\` 为选项 key 或文本，填空/简答用 \`answer_text\`；
\`kc_ids\` 是题目挂载的知识点（每题 ≥1 个）；\`analysis\` 为解析；\`origin\` 记来源与可分发性；
\`verification\` 记校验状态。见 SPEC §5。

## 4. 先修关系怎么读（tree/prereq.json）
每条边 \`{from,to,strength,reason}\`：\`strength=hard\` 表示不学会 from 就无法学会 to；\`soft\` 表示有帮助。
\`reason\` 必须是一句人话，供老师复核。先修图必须是 DAG（有环即校验失败）。见 SPEC §4。

## 5. 字段词典（本包自定义）
无自定义字段——全部遵循 subject-pack/1。

## 6. 一个完整示例（从树到题走一遍）
\`kc_xxx_0001（示例知识点）\` → 先修补一句 reason → \`items/it_xxx_0001\` 一题挂该 kc → 讲解放 \`material/kc_xxx_0001.md\`。
（把上面的 xxx 换成真实内容。）

## 已知边界
本骨架由 tools/ingest/scaffold.mjs 生成，kc/题量初始为空，请用 ingest.mjs 从自备资料填充。
`;
}

export function scaffold({ packsDir, id, name, desc = "", author = "", license = "CC-BY-SA-4.0", force = false }) {
  if (!packsDir) throw new Error("缺少 --packs <dir>");
  if (!id) throw new Error("缺少 --id <pkg>");
  if (!name) throw new Error('缺少 --name "<显示名>"');
  if (!ID_RE.test(id)) {
    throw new Error(
      `id「${id}」不合法：必须小写、以字母开头、反向域名式（含至少一个点），仅含小写字母/数字/点/连字符，例如 my.chinese`
    );
  }

  const packDir = path.join(path.resolve(packsDir), id);
  const exists = fs.existsSync(packDir);
  if (exists && !force) {
    throw new Error(`目标已存在：${packDir}\n如需在其上重建骨架请加 --force（会重写 subject.json / GUIDE.md，保留已有 kc/prereq/items/material 内容）`);
  }

  // 目录
  fs.mkdirSync(path.join(packDir, "tree"), { recursive: true });
  fs.mkdirSync(path.join(packDir, "items"), { recursive: true });
  fs.mkdirSync(path.join(packDir, "material"), { recursive: true });

  const created = [];

  // subject.json（总重写）
  const subject = {
    id,
    name,
    version: "0.1.0",
    schema: "subject-pack/1",
    license: license || "CC-BY-SA-4.0",
    author: author || "",
    description: desc || "",
    depends: [],
    language: "zh-CN",
    presentation: ["teaching", "qa"],
  };
  fs.writeFileSync(path.join(packDir, "subject.json"), JSON.stringify(subject, null, 2) + "\n", "utf8");
  created.push("subject.json");

  // GUIDE.md（总重写）
  fs.writeFileSync(path.join(packDir, "GUIDE.md"), guideTemplate(id, name), "utf8");
  created.push("GUIDE.md");

  // tree/kc.json、tree/prereq.json：仅当不存在时创建（--force 也不覆盖已有知识数据）
  const kcPath = path.join(packDir, "tree", "kc.json");
  if (!fs.existsSync(kcPath)) {
    fs.writeFileSync(kcPath, "[]\n", "utf8");
    created.push("tree/kc.json");
  }
  const prPath = path.join(packDir, "tree", "prereq.json");
  if (!fs.existsSync(prPath)) {
    fs.writeFileSync(prPath, "[]\n", "utf8");
    created.push("tree/prereq.json");
  }

  // .gitkeep
  for (const sub of ["items", "material"]) {
    const p = path.join(packDir, sub, ".gitkeep");
    if (!fs.existsSync(p)) {
      fs.writeFileSync(p, "", "utf8");
      created.push(`${sub}/.gitkeep`);
    }
  }

  return { packDir, created, id, name };
}

function main(argv) {
  const a = parseArgs(argv);
  if (a.help) {
    console.log('用法: node scaffold.mjs --packs <dir> --id <pkg> --name "<显示名>" [--desc ...] [--author ...] [--license CC-BY-SA-4.0] [--force]');
    return;
  }
  try {
    const r = scaffold({
      packsDir: typeof a.packs === "string" ? a.packs : "",
      id: typeof a.id === "string" ? a.id : "",
      name: typeof a.name === "string" ? a.name : "",
      desc: typeof a.desc === "string" ? a.desc : "",
      author: typeof a.author === "string" ? a.author : "",
      license: typeof a.license === "string" ? a.license : "CC-BY-SA-4.0",
      force: !!a.force,
    });
    console.log(`✅ 已生成学科包骨架：${r.packDir}`);
    for (const f of r.created) console.log(`   + ${f}`);
  } catch (e) {
    console.error(`❌ ${e.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
