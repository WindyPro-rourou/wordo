//! 数据模型：对应 subject-pack/1 的各类文件。
//! 刻意宽松：所有字段都是 Option/带默认值——校验规则在 validate.rs 里做，
//! 这样能给出精确的中文错误信息，而不是 serde 的英文报错。

use serde::Deserialize;

#[derive(Deserialize, Debug, Clone, Default)]
#[serde(default)]
pub struct SubjectMeta {
    pub id: Option<String>,
    pub name: Option<String>,
    pub version: Option<String>,
    pub schema: Option<String>,
    pub license: Option<String>,
    pub author: Option<String>,
    pub description: Option<String>,
    pub depends: Vec<String>,
    pub language: Option<String>,
    pub presentation: Vec<String>,
}

#[derive(Deserialize, Debug, Clone, Default)]
#[serde(default)]
pub struct Kc {
    pub id: Option<String>,
    pub name: Option<String>,
    pub toc: Vec<String>,
    pub difficulty: Option<f64>,
    pub bloom: Option<String>,
    pub aliases: Vec<String>,
}

#[derive(Deserialize, Debug, Clone, Default)]
#[serde(default)]
pub struct Prereq {
    pub from: Option<String>,
    pub to: Option<String>,
    pub strength: Option<String>,
    pub reason: Option<String>,
}

#[derive(Deserialize, Debug, Clone, Default)]
#[serde(default)]
pub struct ItemOption {
    pub key: Option<String>,
    pub text: Option<String>,
}

#[derive(Deserialize, Debug, Clone, Default)]
#[serde(default)]
pub struct Origin {
    pub source_type: Option<String>,
    pub source_ref: Option<String>,
    pub redistributable: Option<bool>,
}

#[derive(Deserialize, Debug, Clone, Default)]
#[serde(default)]
pub struct Verification {
    pub answer_checked_by: Option<String>,
    pub human_reviewed: Option<bool>,
}

#[derive(Deserialize, Debug, Clone, Default)]
#[serde(default)]
pub struct Item {
    pub id: Option<String>,
    #[serde(rename = "type")]
    pub item_type: Option<String>,
    pub kc_ids: Vec<String>,
    pub stem: Option<String>,
    pub options: Vec<ItemOption>,
    pub answer: Option<String>,
    pub answer_text: Option<String>,
    pub analysis: Option<String>,
    pub difficulty: Option<f64>,
    pub origin: Origin,
    pub verification: Verification,
}

pub const SCHEMA_VERSION: &str = "subject-pack/1";

pub const ITEM_TYPES: &[&str] = &[
    "single_choice",
    "multi_choice",
    "fill_blank",
    "short_answer",
    "judge",
];

pub const SOURCE_TYPES: &[&str] = &["scraped", "generated", "user_note", "licensed"];

pub const STRENGTHS: &[&str] = &["hard", "soft"];

pub const BLOOM_LEVELS: &[&str] = &[
    "记忆", "理解", "应用", "分析", "评价", "创造",
];
