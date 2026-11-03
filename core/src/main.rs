//! WORDO 核心 CLI。
//! 子命令：
//!   validate-pack <学科包目录> [--json]                 校验学科包（subject-pack/1）
//!   inspect-pack  <学科包目录> [--json]                 导出包全部内容 + 校验报告（GUI 数据层 headless 版）
//!   prompt --pack <目录> --task <explain|classify-error>  只打印装配好的提示词（不调模型）
//!   ask    --pack <目录> --task <...> [--kc <id>] [--config <路径>] [--json]
//!                                                        真调模型：装配 → 请求 → 校验 → 不合格重试

use serde_json::{json, Value};
use std::path::PathBuf;
use std::process::ExitCode;

use wordo_core::validate::{self, Level};

const USAGE: &str = "用法:
  wordo validate-pack <学科包目录> [--json]
  wordo inspect-pack  <学科包目录> [--json]
  wordo prompt --pack <学科包目录> --task <explain|classify-error> [--kc <id>] [--payload <json>]
  wordo ask    --pack <学科包目录> --task <explain|classify-error> [--kc <id>] [--payload <json>] [--config <路径>] [--json]

环境变量: WORDO_CONFIG 指定配置文件（默认 %APPDATA%\\app.wordo.desktop\\config.json）";

fn arg(args: &[String], name: &str) -> Option<String> {
    let i = args.iter().position(|a| a == name)?;
    args.get(i + 1).cloned()
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        eprintln!("{USAGE}");
        return ExitCode::from(2);
    }
    let cmd = args[1].as_str();
    let json_out = args.iter().any(|a| a == "--json");

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
                    print_value(&serde_json::to_value(&report));
                } else {
                    print_human(&report);
                }
                if report.error_count > 0 {
                    return ExitCode::from(1);
                }
            } else {
                match wordo_core::load::load_pack(&path) {
                    Ok(v) => print_value(&Ok(v)),
                    Err(e) => {
                        eprintln!("错误: {e}");
                        return ExitCode::from(1);
                    }
                }
            }
            ExitCode::from(0)
        }

        "prompt" | "ask" => {
            let Some(pack_arg) = arg(&args, "--pack") else {
                eprintln!("缺少 --pack <学科包目录>");
                return ExitCode::from(2);
            };
            let pack = PathBuf::from(pack_arg);
            if !pack.is_dir() {
                eprintln!("错误: {} 不是目录", pack.display());
                return ExitCode::from(2);
            }
            let task = arg(&args, "--task").unwrap_or_else(|| "explain".to_string());
            let payload = build_payload(&args, &task);

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

            let cfg_path = arg(&args, "--config")
                .map(PathBuf::from)
                .unwrap_or_else(wordo_core::config::default_path);
            let cfg = wordo_core::config::load(&cfg_path);
            match wordo_core::llm::ask_retry(&cfg, &task, &pack, &payload, 2) {
                Ok(res) => {
                    if json_out {
                        print_value(&Ok(res.to_json()));
                    } else {
                        println!(
                            "模型: {} · 尝试 {} 次 · 通过校验: {}",
                            res.model,
                            res.attempts,
                            if res.ok { "是" } else { "否" }
                        );
                        println!("配置: {}", cfg_path.display());
                        if !res.issues.is_empty() {
                            println!("校验问题:");
                            for i in &res.issues {
                                println!("  - {i}");
                            }
                        }
                        match &res.data {
                            Some(d) => {
                                println!("\n返回结构:\n{}", serde_json::to_string_pretty(d).unwrap_or_default())
                            }
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

        _ => {
            eprintln!("{USAGE}");
            ExitCode::from(2)
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
        _ => json!({ "kc_id": kc, "learner": {} }),
    }
}

fn print_value(v: &Result<serde_json::Value, serde_json::Error>) {
    match v {
        Ok(val) => match serde_json::to_string_pretty(val) {
            Ok(s) => println!("{s}"),
            Err(e) => eprintln!("序列化失败: {e}"),
        },
        Err(e) => eprintln!("序列化失败: {e}"),
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
        let stats: Vec<String> = r
            .per_kc_items
            .iter()
            .map(|s| format!("{}×{}", s.kc_id, s.items))
            .collect();
        println!("  每 KC 题量: {}", stats.join("  "));
    }

    let (errs, warns) = (r.error_count, r.warning_count);
    if errs == 0 && warns == 0 {
        println!("  ✅ 全部通过");
    }
    println!("  结果: {errs} 错误, {warns} 警告");
}
