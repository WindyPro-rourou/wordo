//! 模型输出校验：按 output-schema/1 检查字段、枚举与引用完整性。
//! 校验失败 → 壳层丢弃并重试；这是「跨模型效果趋同」的闸门。

use serde_json::Value;
use std::collections::HashSet;

const ERROR_TYPES: &[&str] = &[
    "none",
    "knowledge_missing",
    "concept_confused",
    "method_missing",
    "calculation_slip",
    "misread",
];

const ACTIONS: &[&str] = &[
    "review_prereq",
    "re_explain",
    "drill_similar",
    "split_concept",
    "retry_later",
    "none",
];

const TOOL_HINTS: &[&str] = &[
    "canvas-geometry",
    "graph-plot",
    "physics-sim",
    "timeline",
    "mindmap",
    "answer-board",
    "none",
];

/// 返回问题列表（空 = 通过）
pub fn check(task: &str, v: &Value, kc_ids: &HashSet<String>) -> Vec<String> {
    let mut errs = Vec::new();

    if v.get("task").and_then(|x| x.as_str()) != Some(task) {
        errs.push(format!("task 字段应为「{task}」"));
    }
    if v.get("warnings").and_then(|x| x.as_array()).is_none() {
        errs.push("缺少 warnings 数组".to_string());
    } else if v.get("warnings").and_then(|x| x.as_array()).map_or(false, |a| a.iter().any(|w| !w.is_string())) {
        errs.push("warnings 元素必须是字符串".to_string());
    }
    if v.get("schema_ver").and_then(|x| x.as_str()) != Some("1") {
        errs.push("schema_ver 必须为 \"1\"".to_string());
    }

    match task {
        "classify-error" => {
            for k in [
                "item_id",
                "answered",
                "correct",
                "error_type",
                "confidence",
                "suggested_action",
                "notes",
                "inferred",
            ] {
                if v.get(k).is_none() {
                    errs.push(format!("缺少字段 {k}"));
                }
            }
            check_enum(v, "error_type", ERROR_TYPES, &mut errs);
            if let Some(sf) = v.get("secondary_factor").and_then(|x| x.as_str()) {
                if !ERROR_TYPES.contains(&sf) || sf == "none" {
                    errs.push(format!("secondary_factor「{sf}」不在允许枚举内"));
                }
            }
            check_enum(v, "suggested_action", ACTIONS, &mut errs);
            if let Some(c) = v.get("confidence").and_then(|x| x.as_f64()) {
                if !(0.0..=1.0).contains(&c) {
                    errs.push("confidence 超出 0–1".to_string());
                }
            }
            if let Some(k) = v.get("root_cause_kc_id").and_then(|x| x.as_str()) {
                if !k.is_empty() && !kc_ids.contains(k) {
                    errs.push(format!("root_cause_kc_id「{k}」不在本包知识点表中"));
                }
            }
        }
        "explain" => {
            if let Some(em) = v.get("explanation_md").and_then(|x| x.as_str()) {
                if em.chars().count() > 2000 {
                    errs.push("explanation_md 超过 2000 字".to_string());
                }
            }
            for k in [
                "kc_id",
                "explanation_md",
                "worked_example",
                "misconceptions",
                "followup_question",
                "tool_hints",
                "inferred",
            ] {
                if v.get(k).is_none() {
                    errs.push(format!("缺少字段 {k}"));
                }
            }
            if let Some(k) = v.get("kc_id").and_then(|x| x.as_str()) {
                if !kc_ids.contains(k) {
                    errs.push(format!("kc_id「{k}」不在本包知识点表中"));
                }
            }
            if let Some(g) = v.get("prereq_gap").and_then(|x| x.as_str()) {
                if !g.is_empty() && !kc_ids.contains(g) {
                    errs.push(format!("prereq_gap「{g}」不在本包知识点表中"));
                }
            }
            if let Some(hints) = v.get("tool_hints").and_then(|x| x.as_array()) {
                for h in hints {
                    if let Some(s) = h.as_str() {
                        if !TOOL_HINTS.contains(&s) {
                            errs.push(format!("tool_hints 含未知值「{s}」"));
                        }
                    }
                }
            }
            match v.get("followup_question") {
                Some(q) => {
                    if q.get("stem").and_then(|x| x.as_str()).map_or(true, |s| s.trim().is_empty()) {
                        errs.push("followup_question.stem 为空".to_string());
                    }
                    let opts = q.get("options").and_then(|x| x.as_array()).map(|a| a.len()).unwrap_or(0);
                    if opts != 4 {
                        errs.push(format!("followup_question.options 应为 4 项，实际 {opts}"));
                    }
                    match q.get("answer").and_then(|x| x.as_str()) {
                        Some(a) => {
                            let up = a.trim().to_uppercase();
                            if !matches!(up.as_str(), "A" | "B" | "C" | "D") {
                                errs.push(format!("followup_question.answer「{a}」应为 A–D"));
                            }
                        }
                        None => errs.push("followup_question 缺少 answer".to_string()),
                    }
                }
                None => errs.push("缺少 followup_question".to_string()),
            }
        }
        // T3：处理域内其他设备发来的「错题委托」
        "review-wrong" => {
            if v.get("inferred").is_none() {
                errs.push("缺少字段 inferred".to_string());
            }
            match v.get("reviews").and_then(|x| x.as_array()) {
                Some(arr) => {
                    if arr.is_empty() {
                        errs.push("reviews 为空数组（至少处理 1 道错题）".to_string());
                    }
                    for (i, r) in arr.iter().enumerate() {
                        let tag = format!("reviews[{i}]");
                        for k in ["item_id", "kc_id", "why_wrong_md", "fix_md", "variant"] {
                            if r.get(k).is_none() {
                                errs.push(format!("{tag} 缺少字段 {k}"));
                            }
                        }
                        match r.get("why_wrong_md").and_then(|x| x.as_str()) {
                            Some(s) if s.trim().len() >= 4 => {}
                            _ => errs.push(format!("{tag}.why_wrong_md 过短")),
                        }
                        match r.get("fix_md").and_then(|x| x.as_str()) {
                            Some(s) if s.trim().len() >= 8 => {}
                            _ => errs.push(format!("{tag}.fix_md 过短")),
                        }
                        if let Some(k) = r.get("kc_id").and_then(|x| x.as_str()) {
                            if !kc_ids.contains(k) {
                                errs.push(format!("{tag}.kc_id「{k}」不在本包知识点表中"));
                            }
                        }
                        if let Some(var) = r.get("variant") {
                            if var.get("stem").and_then(|x| x.as_str()).map_or(true, |s| s.trim().is_empty()) {
                                errs.push(format!("{tag}.variant.stem 为空"));
                            }
                            let n = var.get("options").and_then(|x| x.as_array()).map(|a| a.len()).unwrap_or(0);
                            if n < 2 {
                                errs.push(format!("{tag}.variant.options 至少 2 项，实际 {n}"));
                            }
                            if var.get("answer").and_then(|x| x.as_str()).map_or(true, |s| s.trim().is_empty()) {
                                errs.push(format!("{tag}.variant.answer 为空"));
                            }
                        }
                    }
                }
                None => errs.push("缺少 reviews 数组".to_string()),
            }
        }
        other => errs.push(format!("未知任务「{other}」")),
    }

    errs
}

fn check_enum(v: &Value, field: &str, allowed: &[&str], errs: &mut Vec<String>) {
    match v.get(field).and_then(|x| x.as_str()) {
        Some(s) if allowed.contains(&s) => {}
        Some(s) => errs.push(format!("{field}「{s}」不在枚举内")),
        None => {}
    }
}
