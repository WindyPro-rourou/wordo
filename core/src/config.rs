//! 应用配置：模型提供方预设 + 用户配置的读写。
//! ⚠️ 配置里含 API Key —— 文件位置由壳层决定（应用配置目录，**不在仓库内**）。

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct ProviderCfg {
    pub preset: String,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct AppConfig {
    pub providers: Vec<ProviderCfg>,
    pub active: usize,
    /// fast | normal | deep —— 思考强度档位
    pub thinking: String,
}

/// 内置提供方预设（纯 API；OpenAI 兼容协议）
pub fn presets() -> Value {
    json!([
        // 本地网关（magpie）：把多个上游择优成一条路由组，延迟低、不暴露上游 key
        { "id": "magpie", "label": "本地网关 (magpie)", "baseUrl": "http://127.0.0.1:3425/v1",
          "models": ["auto/deepseek-v4.1-flash", "auto/glm-5.3-flash",
                     "auto/kimi-k3.1-pro", "auto/step-5-preview"] },
        // 模型清单以 GET /v1/models 实测为准（2026-11）：EOL 的 llama-3.3-70b 等已移除
        { "id": "nvidia", "label": "NVIDIA NIM", "baseUrl": "https://integrate.api.nvidia.com/v1",
          "models": ["deepseek-ai/deepseek-v4.1-flash",
                     "nvidia/nemotron-3-super-120b-a12b",
                     "nvidia/nemotron-3.5-lightning-30b-a3b",
                     "moonshotai/kimi-k2.6",
                     "z-ai/glm-5.3-flash",
                     "openai/gpt-oss-20b",
                     "mistralai/mistral-large-4-1t-a52b"] },
        { "id": "deepseek", "label": "DeepSeek", "baseUrl": "https://api.deepseek.com/v1",
          "models": ["deepseek-chat", "deepseek-reasoner"] },
        { "id": "moonshot", "label": "Kimi (Moonshot)", "baseUrl": "https://api.moonshot.cn/v1",
          "models": ["moonshot-v1-8k", "moonshot-v1-32k"] },
        { "id": "dashscope", "label": "通义千问", "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
          "models": ["qwen-plus", "qwen-max"] },
        { "id": "openai", "label": "OpenAI", "baseUrl": "https://api.openai.com/v1",
          "models": ["gpt-4o-mini", "gpt-4o"] },
        { "id": "custom", "label": "自定义（OpenAI 兼容）", "baseUrl": "", "models": [] }
    ])
}

pub fn load(path: &Path) -> AppConfig {
    fs::read_to_string(path)
        .ok()
        .and_then(|t| serde_json::from_str(t.trim_start_matches('\u{feff}')).ok())
        .unwrap_or_default()
}

pub fn save(path: &Path, cfg: &AppConfig) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let t = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    fs::write(path, t).map_err(|e| e.to_string())
}

pub fn active_provider(cfg: &AppConfig) -> Option<ProviderCfg> {
    cfg.providers.get(cfg.active).cloned()
}

/// 默认配置文件位置：优先 WORDO_CONFIG，其次 Windows 的 %APPDATA%\app.wordo.desktop\config.json
/// （须与 Tauri identifier 保持一致；CLI 与 GUI 共用同一份配置）
pub fn default_path() -> std::path::PathBuf {
    if let Ok(p) = std::env::var("WORDO_CONFIG") {
        if !p.trim().is_empty() {
            return std::path::PathBuf::from(p);
        }
    }
    let base = std::env::var("APPDATA").unwrap_or_else(|_| ".".to_string());
    std::path::PathBuf::from(base).join("app.wordo.desktop").join("config.json")
}

/// 默认账号域目录：优先 WORDO_DOMAIN，其次 %APPDATA%\app.wordo.desktop\domain\default
/// （把该目录放到同步盘上，就等于把账号域接上了同步通道）
pub fn default_domain_path() -> std::path::PathBuf {
    if let Ok(p) = std::env::var("WORDO_DOMAIN") {
        if !p.trim().is_empty() {
            return std::path::PathBuf::from(p);
        }
    }
    let base = std::env::var("APPDATA").unwrap_or_else(|_| ".".to_string());
    std::path::PathBuf::from(base)
        .join("app.wordo.desktop")
        .join("domain")
        .join("default")
}
