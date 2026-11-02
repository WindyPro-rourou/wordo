//! WORDO 核心 CLI。
//! 子命令：
//!   validate-pack <学科包目录> [--json]   校验学科包（subject-pack/1）
//!   inspect-pack  <学科包目录> [--json]   导出包的全部内容 + 校验报告（GUI 数据层的 headless 版）

use std::path::PathBuf;
use std::process::ExitCode;

use wordo_core::validate::{self, Level};

const USAGE: &str = "用法:\n  wordo validate-pack <学科包目录> [--json]   校验学科包\n  wordo inspect-pack  <学科包目录> [--json]   导出全部内容 + 校验报告\n子命令: validate-pack · inspect-pack（后续: sync / schedule / build-index）";

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 3 {
        eprintln!("{USAGE}");
        return ExitCode::from(2);
    }
    let cmd = args[1].as_str();
    if cmd != "validate-pack" && cmd != "inspect-pack" {
        eprintln!("{USAGE}");
        return ExitCode::from(2);
    }
    let path = PathBuf::from(&args[2]);
    let json = args.iter().any(|a| a == "--json");

    if !path.is_dir() {
        eprintln!("错误: {} 不是目录", path.display());
        return ExitCode::from(2);
    }

    match cmd {
        "validate-pack" => {
            let report = validate::validate_pack(&path);
            if json {
                print_value(&serde_json::to_value(&report));
            } else {
                print_human(&report);
            }
            if report.error_count > 0 {
                return ExitCode::from(1);
            }
        }
        "inspect-pack" => {
            match wordo_core::load::load_pack(&path) {
                Ok(v) => print_value(&Ok(v)),
                Err(e) => {
                    eprintln!("错误: {e}");
                    return ExitCode::from(1);
                }
            }
        }
        _ => unreachable!(),
    }
    ExitCode::from(0)
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
