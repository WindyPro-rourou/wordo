import fs from "node:fs";
const P="core/src/outcheck.rs";
let t=fs.readFileSync(P,"utf8");
if(!t.includes("schema_ver")){
  t=t.replace(`    if v.get("warnings").and_then(|x| x.as_array()).is_none() {
        errs.push("缺少 warnings 数组".to_string());
    }`,
`    if v.get("warnings").and_then(|x| x.as_array()).is_none() {
        errs.push("缺少 warnings 数组".to_string());
    } else if v.get("warnings").and_then(|x| x.as_array()).map_or(false, |a| a.iter().any(|w| !w.is_string())) {
        errs.push("warnings 元素必须是字符串".to_string());
    }
    if v.get("schema_ver").and_then(|x| x.as_str()) != Some("1") {
        errs.push("schema_ver 必须为 \\"1\\"".to_string());
    }`);
  t=t.replace(`            check_enum(v, "error_type", ERROR_TYPES, &mut errs);`,
`            check_enum(v, "error_type", ERROR_TYPES, &mut errs);
            if let Some(sf) = v.get("secondary_factor").and_then(|x| x.as_str()) {
                if !ERROR_TYPES.contains(&sf) || sf == "none" {
                    errs.push(format!("secondary_factor「{sf}」不在允许枚举内"));
                }
            }`);
  t=t.replace(`        "explain" => {`,
`        "explain" => {
            if let Some(em) = v.get("explanation_md").and_then(|x| x.as_str()) {
                if em.chars().count() > 2000 {
                    errs.push("explanation_md 超过 2000 字".to_string());
                }
            }`);
  fs.writeFileSync(P,t,"utf8"); console.log("✅ rust outcheck 收紧");
} else console.log("rust 已收紧");
