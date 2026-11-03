//! 模型调用（唯一实现）：装配提示词 → 请求 → 抽取 JSON → 按 output-schema/1 校验 → 不合格重试。
//! CLI 与 GUI 都走这里，保证「同一条代码路径」，M4 的跨模型一致性测试才能 headless 跑。

use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::Path;

use crate::config::{self, AppConfig, ProviderCfg};

pub struct AskResult {
    pub ok: bool,
    pub data: Option<Value>,
    pub issues: Vec<String>,
    /// 首次尝试的校验问题——用来观测「闸门到底拦下了什么」（A3 留痕）
    pub first_issues: Vec<String>,
    pub raw: String,
    pub model: String,
    pub attempts: u32,
}

impl AskResult {
    pub fn to_json(&self) -> Value {
        json!({
            "ok": self.ok,
            "data": self.data,
            "issues": self.issues,
            "first_issues": self.first_issues,
            "raw": self.raw,
            "model": self.model,
            "attempts": self.attempts,
        })
    }
}

/// 思考强度 → 温度（档位越低越发散；deep 用于强模型/需要稳的场合）
pub fn temperature_for(thinking: &str) -> f64 {
    match thinking {
        "fast" => 0.6,
        "deep" => 0.2,
        _ => 0.35,
    }
}

/// 一次 OpenAI 兼容的 chat 调用，返回 message.content 原文
pub fn chat(prov: &ProviderCfg, temperature: f64, system: &str, user: &str) -> Result<String, String> {
    if prov.base_url.trim().is_empty() || prov.api_key.trim().is_empty() || prov.model.trim().is_empty() {
        return Err("模型配置不完整：需要 baseURL / API Key / 模型名".to_string());
    }
    let url = format!("{}/chat/completions", prov.base_url.trim_end_matches('/'));
    let body = json!({
        "model": prov.model,
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": user }
        ],
        "temperature": temperature,
        "max_tokens": 2048,
        "stream": false
    });

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .post(&url)
        .bearer_auth(prov.api_key.trim())
        .json(&body)
        .send()
        .map_err(|e| format!("请求失败: {e}"))?;
    let status = resp.status();
    let text = resp.text().map_err(|e| e.to_string())?;
    if !status.is_success() {
        let brief: String = text.chars().take(600).collect();
        return Err(format!("HTTP {status}：{brief}"));
    }
    let v: Value = serde_json::from_str(&text).map_err(|e| format!("响应不是 JSON: {e}"))?;
    Ok(v.pointer("/choices/0/message/content")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string())
}

/// 从模型输出里抽取 JSON（容忍 ```json 围栏、前后废话、首个 { 到末个 }）
pub fn extract_json(s: &str) -> Option<Value> {
    let t = s.trim();
    if let Ok(v) = serde_json::from_str::<Value>(t) {
        return Some(v);
    }
    let t2 = t
        .strip_prefix("```json")
        .or_else(|| t.strip_prefix("```"))
        .unwrap_or(t);
    let t2 = t2.strip_suffix("```").unwrap_or(t2).trim();
    if let Ok(v) = serde_json::from_str::<Value>(t2) {
        return Some(v);
    }
    let start = t.find('{')?;
    let end = t.rfind('}')?;
    if end > start {
        if let Ok(v) = serde_json::from_str::<Value>(&t[start..=end]) {
            return Some(v);
        }
    }
    None
}

fn check(task: &str, pack: &Path, data: &Option<Value>) -> Vec<String> {
    // 单包或包根目录都支持（T3 委托处理可能跨包）
    let kc_ids: HashSet<String> = crate::prompt::kc_scope(pack);
    match data {
        Some(v) => crate::outcheck::check(task, v, &kc_ids),
        None => vec!["模型输出不是合法 JSON".to_string()],
    }
}

/// 单轮：不重试
pub fn ask(cfg: &AppConfig, task: &str, pack: &Path, payload: &Value) -> Result<AskResult, String> {
    let prov = config::active_provider(cfg)
        .ok_or_else(|| "未配置模型提供方：请先在「设置」里选择提供方并填入 API Key".to_string())?;
    let prompt = crate::prompt::build(task, pack, payload)?;
    let sys = prompt.get("system").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let usr = prompt.get("user").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let raw = chat(&prov, temperature_for(&cfg.thinking), &sys, &usr)?;
    let data = extract_json(&raw);
    let issues = check(task, pack, &data);
    Ok(AskResult {
        ok: data.is_some() && issues.is_empty(),
        data,
        issues,
        first_issues: Vec::new(),
        raw,
        model: prov.model,
        attempts: 1,
    })
}

/// 带重试：校验不合格时把问题回灌给模型，最多 `max_retry` 次追加尝试。
/// 这是「跨模型效果趋同」的闸门——不合格的输出不进系统。
pub fn ask_retry(
    cfg: &AppConfig,
    task: &str,
    pack: &Path,
    payload: &Value,
    max_retry: u32,
) -> Result<AskResult, String> {
    let mut res = ask(cfg, task, pack, payload)?;
    let first_issues = res.issues.clone();
    let mut attempt: u32 = 1;
    while !res.ok && attempt <= max_retry {
        let prov = config::active_provider(cfg).ok_or("未配置模型提供方")?;
        let prompt = crate::prompt::build(task, pack, payload)?;
        let sys = prompt.get("system").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let base_user = prompt.get("user").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let fix = format!(
            "{base_user}\n\n【上一次输出未通过校验，请严格修正后只输出 JSON】\n问题：\n{}",
            res.issues
                .iter()
                .map(|s| format!("- {s}"))
                .collect::<Vec<_>>()
                .join("\n")
        );
        let raw = chat(&prov, temperature_for(&cfg.thinking), &sys, &fix)?;
        let data = extract_json(&raw);
        let issues = check(task, pack, &data);
        attempt += 1;
        res = AskResult {
            ok: data.is_some() && issues.is_empty(),
            data,
            issues,
            first_issues: first_issues.clone(),
            raw,
            model: prov.model,
            attempts: attempt,
        };
    }
    Ok(res)
}

/// 针对某个知识点请求讲解（T2）
pub fn explain_kc(cfg: &AppConfig, pack: &Path, kc_id: &str, kc_name: &str) -> Result<AskResult, String> {
    let payload = json!({ "kc_id": kc_id, "kc_name": kc_name, "learner": {} });
    ask_retry(cfg, "explain", pack, &payload, 2)
}
