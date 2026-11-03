//! WORDO 核心 CLI。
//!
//! 学科包：
//!   validate-pack <目录> [--json] · inspect-pack <目录> [--json]
//! 模型：
//!   prompt --pack <目录> --task <explain|classify-error|review-wrong> [--kc <id>]
//!   ask    --pack <目录> --task <...> [--kc <id>] [--config <路径>] [--json]
//! 学习环路（账本 → user.md → 复习 → 委托 → 同步）：
//!   learn-sync / learn-state / learn-due / learn-queue / learn-answer / learn-session
//!   learn-delegate / learn-review / learn-plan

use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use wordo_core::learn;
use wordo_core::validate::{self, Level};

const USAGE: &str = "用法:
  wordo validate-pack <学科包目录> [--json]
  wordo inspect-pack  <学科包目录> [--json]
  wordo prompt --pack <目录> --task <explain|classify-error|review-wrong> [--kc <id>]
  wordo ask    --pack <目录> --task <...> [--kc <id>] [--config <路径>] [--json]

学习环路（--domain 默认 %APPDATA%\\app.wordo.desktop\\domain\\default；--packs 默认 ./packs）:
  wordo learn-sync    [--domain d] [--packs p] [--json]                     域同步：合并账本 + 重算 user.md
  wordo learn-state   [--domain d] [--packs p]                              打印 user.md（学习者状态）
  wordo learn-due     [--domain d] [--packs p] [--json]                     到期复习队列
  wordo learn-queue   [--packs p] --kc <kc_id> [--n 3] [--json]             出题（错题优先）
  wordo learn-answer  [--packs p] --item <item_id> --answered A [--node n]  记一次作答（写账本）
  wordo learn-session [--packs p] --kc <kc_id> [--answers \"A,B,C\"] [--node n]  跑一轮完整环路
  wordo learn-delegate [--domain d] [--packs p] [--date YYYY-MM-DD]         导出今日错题委托
  wordo learn-review  [--domain d] [--packs p] [--limit 3] [--config c]     处理域内他人委托（调 T3）
  wordo learn-plan    [--domain d] [--add \"文本\" | --list | --done <id>]    学习计划/任务清单

环境变量: WORDO_CONFIG 配置文件 · WORDO_DOMAIN 账号域目录";

fn arg(args: &[String], name: &str) -> Option<String> {
    let i = args.iter().position(|a| a == name)?;
    args.get(i + 1).cloned()
}
fn has(args: &[String], name: &str) -> bool {
    args.iter().any(|a| a == name)
}
fn domain_of(args: &[String]) -> PathBuf {
    arg(args, "--domain")
        .map(PathBuf::from)
        .unwrap_or_else(wordo_core::config::default_domain_path)
}
fn packs_of(args: &[String]) -> Result<PathBuf, String> {
    if let Some(p) = arg(args, "--packs") {
        return Ok(PathBuf::from(p));
    }
    let d = PathBuf::from("packs");
    if d.is_dir() {
        Ok(d)
    } else {
        Err("请用 --packs <学科包目录> 指定学科包根目录".to_string())
    }
}
fn node_of(args: &[String], domain: &Path) -> String {
    arg(args, "--node").unwrap_or_else(|| learn::node_id(domain).unwrap_or_else(|_| "local".to_string()))
}
fn print_json(v: &Value) {
    println!("{}", serde_json::to_string_pretty(v).unwrap_or_default());
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        eprintln!("{USAGE}");
        return ExitCode::from(2);
    }
    let cmd = args[1].as_str();
    let json_out = has(&args, "--json");

    match cmd {
        "validate-pack" | "inspect-pack" => {
            let Some(p) = args.get(2) else {
                eprintln!("{USAGE}");
                return ExitCode::from(2);
            };
            let path = PathBuf::from(p);
            if !path.is_dir() {
                eprintln!("错误: {} 不是目录", path.display());
                return ExitCode::from(2);
            }
            if cmd == "validate-pack" {
                let report = validate::validate_pack(&path);
                if json_out {
                    print_json(&serde_json::to_value(&report).unwrap_or(Value::Null));
                } else {
                    print_human(&report);
                }
                if report.error_count > 0 {
                    return ExitCode::from(1);
                }
            } else {
                match wordo_core::load::load_pack(&path) {
                    Ok(v) => print_json(&v),
                    Err(e) => {
                        eprintln!("错误: {e}");
                        return ExitCode::from(1);
                    }
                }
            }
            ExitCode::from(0)
        }

        "prompt" | "ask" => cmd_ask(cmd, &args, json_out),

        "learn-sync" => {
            let domain = domain_of(&args);
            let packs = match packs_of(&args) {
                Ok(p) => p,
                Err(e) => {
                    eprintln!("{e}");
                    return ExitCode::from(2);
                }
            };
            let me = node_of(&args, &domain);
            match learn::sync_as(&domain, &packs, &me) {
                Ok(v) => {
                    if json_out {
                        print_json(&v);
                    } else {
                        println!("账号域   : {}", v.get("domain").and_then(|x| x.as_str()).unwrap_or(""));
                        println!("本机节点 : {}", v.get("node").and_then(|x| x.as_str()).unwrap_or(""));
                        println!("账本事件 : {}", v.get("events_total").and_then(|x| x.as_u64()).unwrap_or(0));
                        if let Some(pn) = v.get("per_node").and_then(|x| x.as_object()) {
                            let s: Vec<String> = pn.iter().map(|(k, n)| format!("{k}={n}")).collect();
                            println!("分节点   : {}", s.join("  "));
                        }
                        println!(
                            "薄弱 {} 项 · 今日到期 {} 项",
                            v.get("weak").and_then(|x| x.as_u64()).unwrap_or(0),
                            v.get("due").and_then(|x| x.as_u64()).unwrap_or(0)
                        );
                        if let Some(pd) = v.get("pending_delegations").and_then(|x| x.as_array()) {
                            if !pd.is_empty() {
                                let s: Vec<String> = pd.iter().filter_map(|x| x.as_str().map(String::from)).collect();
                                println!("待处理委托: {}", s.join(", "));
                            }
                        }
                        println!("user.md  : {}", v.get("user_md").and_then(|x| x.as_str()).unwrap_or(""));
                    }
                    ExitCode::from(0)
                }
                Err(e) => {
                    eprintln!("错误: {e}");
                    ExitCode::from(1)
                }
            }
        }

        "learn-state" => {
            let domain = domain_of(&args);
            let packs = match packs_of(&args) {
                Ok(p) => p,
                Err(e) => {
                    eprintln!("{e}");
                    return ExitCode::from(2);
                }
            };
            match learn::write_user_md(&domain, &packs) {
                Ok((content, path)) => {
                    if json_out {
                        print_json(&json!({ "path": path.display().to_string(), "content": content }));
                    } else {
                        println!("{content}");
                    }
                    ExitCode::from(0)
                }
                Err(e) => {
                    eprintln!("错误: {e}");
                    ExitCode::from(1)
                }
            }
        }

        "learn-due" => {
            let domain = domain_of(&args);
            let packs = match packs_of(&args) {
                Ok(p) => p,
                Err(e) => {
                    eprintln!("{e}");
                    return ExitCode::from(2);
                }
            };
            let st = learn::derive(&domain, None);
            let idx = learn::kc_index(&packs);
            let due = learn::due_list(&st, None);
            if json_out {
                print_json(&json!({ "count": due.len(), "due": due }));
            } else if due.is_empty() {
                println!("今日到期复习：无（薄弱 {} 项）", learn::weak_list(&st).len());
            } else {
                println!("今日到期复习 {} 项：", due.len());
                for k in &due {
                    let nm = idx.get(&k.kc_id).map(|(n, _)| n.clone()).unwrap_or_else(|| k.kc_id.clone());
                    println!(
                        "  {} {} · 错 {} 次 · 掌握度 {:.2} · 连对 {}",
                        k.kc_id, nm, k.wrong, k.mastery, k.streak
                    );
                }
            }
            ExitCode::from(0)
        }

        "learn-queue" => {
            let packs = match packs_of(&args) {
                Ok(p) => p,
                Err(e) => {
                    eprintln!("{e}");
                    return ExitCode::from(2);
                }
            };
            let Some(kc) = arg(&args, "--kc") else {
                eprintln!("缺少 --kc <kc_id>");
                return ExitCode::from(2);
            };
            let n: usize = arg(&args, "--n").and_then(|s| s.parse().ok()).unwrap_or(3);
            let domain = domain_of(&args);
            let st = learn::derive(&domain, None);
            let items = learn::pick_items(&packs, &kc, &st, n);
            if json_out {
                print_json(&json!({ "kc": kc, "items": items }));
            } else {
                println!("为 {kc} 出题 {} 道（错题优先 → 未做过 → 最久未做）：", items.len());
                for (i, it) in items.iter().enumerate() {
                    println!("  {}. [{}] {}", i + 1, it.id, it.stem);
                }
            }
            ExitCode::from(0)
        }

        "learn-answer" => {
            let packs = match packs_of(&args) {
                Ok(p) => p,
                Err(e) => {
                    eprintln!("{e}");
                    return ExitCode::from(2);
                }
            };
            let domain = domain_of(&args);
            let node = node_of(&args, &domain);
            let (Some(item), Some(answered)) = (arg(&args, "--item"), arg(&args, "--answered")) else {
                eprintln!("缺少 --item <item_id> 或 --answered <作答>");
                return ExitCode::from(2);
            };
            let source = arg(&args, "--source").unwrap_or_else(|| "quiz".to_string());
            let et = arg(&args, "--error-type");
            let pack = arg(&args, "--pack-name").unwrap_or_default();
            match learn::record_answer(&domain, &packs, &node, &pack, &item, &answered, &source, et) {
                Ok(out) => {
                    if json_out {
                        print_json(&json!({
                            "ok": out.ok,
                            "event": out.event.to_json(),
                            "kc": out.kc_state,
                            "next_due": out.next_due,
                        }));
                    } else {
                        println!(
                            "{} 题目 {}：我选 {} / 正确 {}",
                            if out.ok { "✅ 正确" } else { "❌ 错误" },
                            item,
                            answered,
                            out.event.correct
                        );
                        if let Some(k) = &out.kc_state {
                            println!(
                                "  {} → 对/错 {}/{} · 连对 {} · 掌握度 {:.2} · 下次复习 {}",
                                k.kc_id, k.correct, k.wrong, k.streak, k.mastery, out.next_due.as_deref().unwrap_or("-")
                            );
                        }
                    }
                    if out.ok {
                        ExitCode::from(0)
                    } else {
                        ExitCode::from(1)
                    }
                }
                Err(e) => {
                    eprintln!("错误: {e}");
                    ExitCode::from(1)
                }
            }
        }

        "learn-session" => {
            let packs = match packs_of(&args) {
                Ok(p) => p,
                Err(e) => {
                    eprintln!("{e}");
                    return ExitCode::from(2);
                }
            };
            let domain = domain_of(&args);
            let node = node_of(&args, &domain);
            let Some(kc) = arg(&args, "--kc") else {
                eprintln!("缺少 --kc <kc_id>");
                return ExitCode::from(2);
            };
            let answers: Vec<String> = arg(&args, "--answers")
                .unwrap_or_else(|| "A,A,A".to_string())
                .split(',')
                .map(|s| s.trim().to_string())
                .collect();
            let n: usize = arg(&args, "--n").and_then(|s| s.parse().ok()).unwrap_or(answers.len());

            let st0 = learn::derive(&domain, None);
            let items = learn::pick_items(&packs, &kc, &st0, n);
            if items.is_empty() {
                eprintln!("该知识点没有题目");
                return ExitCode::from(1);
            }
            println!("▶ 开始一轮学习环路：{}（节点 {node}）", kc);
            for (i, it) in items.iter().enumerate() {
                let a = answers.get(i).cloned().unwrap_or_else(|| "A".to_string());
                match learn::record_answer(&domain, &packs, &node, &it.pack, &it.id, &a, "quiz", None) {
                    Ok(out) => println!(
                        "  {}. [{}] {} → 我选 {} · {} · 正确 {}",
                        i + 1,
                        it.id,
                        it.stem,
                        a,
                        if out.ok { "对" } else { "错" },
                        out.event.correct
                    ),
                    Err(e) => println!("  {}. 记录失败: {e}", i + 1),
                }
            }
            let st = learn::derive(&domain, None);
            let idx = learn::kc_index(&packs);
            if let Some(k) = st.kcs.get(&kc) {
                let nm = idx.get(&kc).map(|(n, _)| n.clone()).unwrap_or_else(|| kc.clone());
                println!(
                    "◀ 本轮结束：{} 对/错 {}/{} · 连对 {} · 掌握度 {:.2} · 下次复习 {}",
                    nm,
                    k.correct,
                    k.wrong,
                    k.streak,
                    k.mastery,
                    k.due_ts.as_deref().unwrap_or("-")
                );
            }
            let (_c, up) = match learn::write_user_md(&domain, &packs) {
                Ok(x) => x,
                Err(e) => {
                    eprintln!("错误: {e}");
                    return ExitCode::from(1);
                }
            };
            println!("  user.md 已更新: {}", up.display());
            println!("  今日到期 {} 项 · 薄弱 {} 项", learn::due_list(&st, None).len(), learn::weak_list(&st).len());
            ExitCode::from(0)
        }

        "learn-delegate" => {
            let packs = match packs_of(&args) {
                Ok(p) => p,
                Err(e) => {
                    eprintln!("{e}");
                    return ExitCode::from(2);
                }
            };
            let domain = domain_of(&args);
            let node = node_of(&args, &domain);
            let date = arg(&args, "--date").unwrap_or_else(learn::today);
            match learn::export_wrong_delegation(&domain, &packs, &node, &date) {
                Ok(v) => {
                    if json_out {
                        print_json(&v);
                    } else if v.get("exported").and_then(|x| x.as_bool()).unwrap_or(false) {
                        println!(
                            "✅ 已导出 {} 道错题 → {}",
                            v.get("count").and_then(|x| x.as_u64()).unwrap_or(0),
                            v.get("file").and_then(|x| x.as_str()).unwrap_or("")
                        );
                    } else {
                        println!("ℹ️ {}", v.get("reason").and_then(|x| x.as_str()).unwrap_or("无错题"));
                    }
                    ExitCode::from(0)
                }
                Err(e) => {
                    eprintln!("错误: {e}");
                    ExitCode::from(1)
                }
            }
        }

        "learn-review" => {
            let packs = match packs_of(&args) {
                Ok(p) => p,
                Err(e) => {
                    eprintln!("{e}");
                    return ExitCode::from(2);
                }
            };
            let domain = domain_of(&args);
            let node = node_of(&args, &domain);
            let limit: usize = arg(&args, "--limit").and_then(|s| s.parse().ok()).unwrap_or(3);
            let cfg_path = arg(&args, "--config")
                .map(PathBuf::from)
                .unwrap_or_else(wordo_core::config::default_path);
            let cfg = wordo_core::config::load(&cfg_path);

            let pending = learn::pending_delegations(&domain, &node);
            if pending.is_empty() {
                println!("ℹ️ 没有待处理的委托（自己发起的、已有回执的都会跳过）");
                return ExitCode::from(0);
            }
            println!("发现 {} 份待处理委托，本次处理前 {} 份", pending.len(), limit.min(pending.len()));
            let mut done = Vec::new();
            for f in pending.iter().take(limit) {
                let md = std::fs::read_to_string(f).unwrap_or_default();
                let Some(payload) = learn::extract_machine_json(&md) else {
                    println!("  ⚠️ {} 里没有机读载荷，跳过", f.display());
                    continue;
                };
                println!(
                    "  ▷ 处理 {}（{} 道错题，来自 {}）…",
                    f.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default(),
                    payload.get("items").and_then(|x| x.as_array()).map(|a| a.len()).unwrap_or(0),
                    payload.get("from_node").and_then(|x| x.as_str()).unwrap_or("?")
                );
                match wordo_core::llm::ask_retry(&cfg, "review-wrong", &packs, &payload, 1) {
                    Ok(res) => {
                        let ok = res.ok;
                        match &res.data {
                            Some(d) => match learn::write_delegation_result(&domain, &node, f, d) {
                                Ok(p) => {
                                    println!(
                                        "    ✅ 回执已写 {}（校验通过: {}，尝试 {} 次）",
                                        p.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default(),
                                        if ok { "是" } else { "否" },
                                        res.attempts
                                    );
                                    done.push(json!({ "src": f.display().to_string(), "result": p.display().to_string() }));
                                }
                                Err(e) => println!("    ❌ 写回执失败: {e}"),
                            },
                            None => println!("    ❌ 模型输出不是合法 JSON，放弃"),
                        }
                    }
                    Err(e) => println!("    ❌ 调用失败: {e}"),
                }
            }
            let _ = learn::sync(&domain, &packs);
            if json_out {
                print_json(&json!({ "processed": done }));
            }
            ExitCode::from(0)
        }

        "learn-plan" => {
            let domain = domain_of(&args);
            let node = node_of(&args, &domain);
            if let Some(text) = arg(&args, "--add") {
                match learn::plan_add(&domain, &node, &text) {
                    Ok(id) => {
                        println!("✅ 已加入学习计划：{id} · {text}");
                        ExitCode::from(0)
                    }
                    Err(e) => {
                        eprintln!("错误: {e}");
                        ExitCode::from(1)
                    }
                }
            } else if let Some(tid) = arg(&args, "--done") {
                match learn::plan_done(&domain, &node, &tid) {
                    Ok(()) => {
                        println!("✅ 任务 {tid} 标记完成");
                        ExitCode::from(0)
                    }
                    Err(e) => {
                        eprintln!("错误: {e}");
                        ExitCode::from(1)
                    }
                }
            } else {
                let list = learn::plan_list(&domain);
                if json_out {
                    print_json(&json!({ "plan": list }));
                } else if list.is_empty() {
                    println!("学习计划为空（用 --add \"文本\" 添加）");
                } else {
                    println!("学习计划：");
                    for t in list {
                        let done = t.get("done").and_then(|x| x.as_bool()).unwrap_or(false);
                        println!(
                            "  {} {} {}",
                            if done { "[x]" } else { "[ ]" },
                            t.get("id").and_then(|x| x.as_str()).unwrap_or(""),
                            t.get("text").and_then(|x| x.as_str()).unwrap_or("")
                        );
                    }
                }
                ExitCode::from(0)
            }
        }

        _ => {
            eprintln!("{USAGE}");
            ExitCode::from(2)
        }
    }
}

fn cmd_ask(cmd: &str, args: &[String], json_out: bool) -> ExitCode {
    let Some(pack_arg) = arg(args, "--pack") else {
        eprintln!("缺少 --pack <学科包目录>");
        return ExitCode::from(2);
    };
    let pack = PathBuf::from(pack_arg);
    if !pack.is_dir() {
        eprintln!("错误: {} 不是目录", pack.display());
        return ExitCode::from(2);
    }
    let task = arg(args, "--task").unwrap_or_else(|| "explain".to_string());
    let payload = build_payload(args, &task);

    if cmd == "prompt" {
        match wordo_core::prompt::build(&task, &pack, &payload) {
            Ok(v) => {
                println!("{}", v.get("system").and_then(|x| x.as_str()).unwrap_or(""));
                println!("\n===== USER =====\n");
                println!("{}", v.get("user").and_then(|x| x.as_str()).unwrap_or(""));
            }
            Err(e) => {
                eprintln!("错误: {e}");
                return ExitCode::from(1);
            }
        }
        return ExitCode::from(0);
    }

    let cfg_path = arg(args, "--config")
        .map(PathBuf::from)
        .unwrap_or_else(wordo_core::config::default_path);
    let cfg = wordo_core::config::load(&cfg_path);
    match wordo_core::llm::ask_retry(&cfg, &task, &pack, &payload, 2) {
        Ok(res) => {
            if json_out {
                print_json(&res.to_json());
            } else {
                println!(
                    "模型: {} · 尝试 {} 次 · 通过校验: {}",
                    res.model,
                    res.attempts,
                    if res.ok { "是" } else { "否" }
                );
                println!("配置: {}", cfg_path.display());
                if !res.first_issues.is_empty() {
                    println!("首轮问题: {}", res.first_issues.join(" / "));
                }
                if !res.issues.is_empty() {
                    println!("残留问题: {}", res.issues.join(" / "));
                }
                match &res.data {
                    Some(d) => println!("\n返回结构:\n{}", serde_json::to_string_pretty(d).unwrap_or_default()),
                    None => println!("\n(非法 JSON) 原始输出:\n{}", res.raw),
                }
            }
            if res.ok {
                ExitCode::from(0)
            } else {
                ExitCode::from(1)
            }
        }
        Err(e) => {
            eprintln!("错误: {e}");
            ExitCode::from(1)
        }
    }
}

fn build_payload(args: &[String], task: &str) -> Value {
    if let Some(p) = arg(args, "--payload") {
        if let Ok(v) = serde_json::from_str::<Value>(&p) {
            return v;
        }
    }
    let kc = arg(args, "--kc");
    match task {
        "classify-error" => json!({
            "item_id": "followup",
            "stem": "",
            "options": [],
            "correct": "",
            "answered": "",
            "kc_id": kc
        }),
        "review-wrong" => json!({ "items": [], "from_node": "cli", "date": learn::today() }),
        _ => json!({ "kc_id": kc, "learner": {} }),
    }
}

fn print_human(r: &validate::PackReport) {
    println!("validate-pack: {}", r.pack_path);
    match (&r.subject_id, &r.subject_version, &r.schema) {
        (Some(id), Some(v), Some(s)) => println!("  subject: {id} v{v} ({s})"),
        _ => println!("  subject: (元数据不可用)"),
    }
    println!(
        "  知识点 {} · 先修边 {} · 题目 {} · 挂载率 {:.0}%",
        r.kc_count, r.edge_count, r.item_count, r.coverage_pct
    );
    for i in &r.issues {
        let icon = match i.level {
            Level::Error => "❌",
            Level::Warning => "⚠️ ",
            Level::Info => "ℹ️ ",
        };
        println!("  {icon} [{code}] {file}: {msg}", file = i.file, code = i.code, msg = i.msg);
    }
    if !r.dangling_kcs.is_empty() {
        println!("  无题挂载知识点: {}", r.dangling_kcs.join(", "));
    }
    if !r.per_kc_items.is_empty() {
        let stats: Vec<String> = r.per_kc_items.iter().map(|s| format!("{}×{}", s.kc_id, s.items)).collect();
        println!("  每 KC 题量: {}", stats.join("  "));
    }
    let (errs, warns) = (r.error_count, r.warning_count);
    if errs == 0 && warns == 0 {
        println!("  ✅ 全部通过");
    }
    println!("  结果: {errs} 错误, {warns} 警告");
}
