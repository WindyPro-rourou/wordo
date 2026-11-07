import fs from "node:fs";

/* ================= Rust learn.rs ================= */
const L = "core/src/learn.rs";
let t = fs.readFileSync(L, "utf8");

// 1) hist 增加 error_type
t = t.replace(
  "let mut hist: HashMap<String, Vec<(bool, DateTime<FixedOffset>, Option<String>)>> = HashMap::new();",
  "let mut hist: HashMap<String, Vec<(bool, DateTime<FixedOffset>, Option<String>, Option<String>)>> = HashMap::new();"
);
t = t.replace(
  "hist.entry(kc.clone()).or_default().push((ok, ts, ev.confidence.clone()));",
  "hist.entry(kc.clone()).or_default().push((ok, ts, ev.confidence.clone(), ev.error_type.clone()));"
);
t = t.replace("for (ok, ts, conf) in list {", "for (ok, ts, conf, etype) in list {");

// 2) 调度与掌握度规则（蒙对按错处理 + 说不准增速减半 + 看错题不影响掌握度）
const oldLoop = `            st.attempts += 1;
            if *ok {
                st.correct += 1;
                st.streak += 1;
                interval = if st.streak == 1 { 24.0 } else { (interval * 2.0).min(MAX_INTERVAL_HOURS) };
            } else {
                st.wrong += 1;
                st.streak = 0;
                interval = if interval <= 0.0 { MIN_INTERVAL_HOURS } else { (interval / 2.0).max(MIN_INTERVAL_HOURS) };
            }`;
const newLoop = `            st.attempts += 1;
            let guess = conf.as_deref() == Some("guess");
            let unsure = conf.as_deref() == Some("unsure");
            let misread = etype.as_deref() == Some("misread");
            if *ok {
                st.correct += 1;
                if guess {
                    // 蒙对 = 没有真实记忆证据：按「未掌握」调度，并打断连对
                    st.streak = 0;
                    interval = MIN_INTERVAL_HOURS;
                } else {
                    st.streak += 1;
                    let growth = if unsure { 1.4 } else { 2.0 };
                    interval = if st.streak == 1 { 24.0 } else { (interval * growth).min(MAX_INTERVAL_HOURS) };
                }
            } else {
                st.wrong += 1;
                st.streak = 0;
                interval = if interval <= 0.0 { MIN_INTERVAL_HOURS } else { (interval / 2.0).max(MIN_INTERVAL_HOURS) };
            }`;
if (!t.includes("蒙对 = 没有真实记忆证据")) {
  t = t.replace(oldLoop, newLoop);
  console.log("✅ 调度规则（蒙对/说不准）");
}

// 3) 掌握度：蒙对权重降到 0.15；看错题（misread）不进掌握度统计
t = t.replace(
  `            wsum += w;
            if *ok {
                // 「蒙对」只按 40% 计入掌握度，避免高估
                let cw = if conf.as_deref() == Some("guess") { 0.4 } else { 1.0 };
                oksum += w * cw;
            }`,
  `            // 「看错题」是审题问题，不代表知识点没掌握 → 不计入掌握度
            if !(!*ok && misread) {
                wsum += w;
                if *ok {
                    // 蒙对几乎没有记忆证据，只按 15% 计入
                    let cw = if guess { 0.15 } else if unsure { 0.7 } else { 1.0 };
                    oksum += w * cw;
                }
            }`
);

// 4) 已掌握 → 低频抽查（至少 14 天），不占每日配额
t = t.replace(
  `        st.interval_hours = interval;
        st.mastery = if wsum > 0.0 { oksum / wsum } else { 0.0 };
        st.mastered = st.mastery >= MASTERY_OK && st.streak >= STREAK_OK;`,
  `        st.mastery = if wsum > 0.0 { oksum / wsum } else { 0.0 };
        st.mastered = st.mastery >= MASTERY_OK && st.streak >= STREAK_OK;
        // 已掌握进入低频抽查（≥14 天），避免占掉每日复习配额
        if st.mastered && interval < 336.0 {
            interval = 336.0;
        }
        st.interval_hours = interval;`
);

// 5) 到期排序：概念不清优先
t = t.replace(
  `    v.sort_by(|a, b| {
        b.wrong
            .cmp(&a.wrong)
            .then(a.due_ts.cmp(&b.due_ts))
    });`,
  `    v.sort_by(|a, b| {
        let ca = a.error_types.contains_key("concept_confused");
        let cb = b.error_types.contains_key("concept_confused");
        cb.cmp(&ca) // 概念不清排前面
            .then(b.wrong.cmp(&a.wrong))
            .then(a.due_ts.cmp(&b.due_ts))
    });`
);
fs.writeFileSync(L, t, "utf8");
console.log("learn.rs patched");

/* ================= 预览后端 ================= */
const B = "tools/preview/backend.mjs";
let b = fs.readFileSync(B, "utf8");
// derive: 三档 + misread + mastered 抽查
b = b.replace(
  `      st.attempts++;
      if (ok) { st.correct++; st.streak++; st.interval_hours = st.streak === 1 ? 24 : Math.min(st.interval_hours * 2, MAX_INTERVAL); }
      else { st.wrong++; st.streak = 0; st.interval_hours = st.interval_hours <= 0 ? MIN_INTERVAL : Math.max(st.interval_hours / 2, MIN_INTERVAL); }`,
  `      st.attempts++;
      const guess = ev.confidence === "guess", unsure = ev.confidence === "unsure", misread = ev.error_type === "misread";
      if (ok) {
        st.correct++;
        if (guess) { st.streak = 0; st.interval_hours = MIN_INTERVAL; }
        else { st.streak++; const g = unsure ? 1.4 : 2; st.interval_hours = st.streak === 1 ? 24 : Math.min(st.interval_hours * g, MAX_INTERVAL); }
      } else {
        st.wrong++; st.streak = 0;
        st.interval_hours = st.interval_hours <= 0 ? MIN_INTERVAL : Math.max(st.interval_hours / 2, MIN_INTERVAL);
      }`
);
b = b.replace(
  `      const w = Math.pow(0.5, hours / 72);
      st._w += w;
      if (ok) st._o += w * (ev.confidence === "guess" ? 0.4 : 1);`,
  `      const w = Math.pow(0.5, hours / 72);
      if (!(!ok && misread)) {
        st._w += w;
        if (ok) st._o += w * (guess ? 0.15 : unsure ? 0.7 : 1);
      }`
);
b = b.replace(
  `    st.mastered = st.mastery >= MASTERY_OK && st.streak >= STREAK_OK;`,
  `    st.mastered = st.mastery >= MASTERY_OK && st.streak >= STREAK_OK;
    if (st.mastered && st.interval_hours < 336) st.interval_hours = 336; // 已掌握→低频抽查`
);
// dueList 排序：概念不清优先
b = b.replace(
  `    .sort((a, b) => b.wrong - a.wrong || String(a.due_ts).localeCompare(String(b.due_ts)));`,
  `    .sort((a, b) => (b.error_types && b.error_types.concept_confused ? 1 : 0) - (a.error_types && a.error_types.concept_confused ? 1 : 0) || b.wrong - a.wrong || String(a.due_ts).localeCompare(String(b.due_ts)));`
);
fs.writeFileSync(B, b, "utf8");
console.log("backend patched");
