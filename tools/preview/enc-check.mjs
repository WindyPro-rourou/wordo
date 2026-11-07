// 编码诊断：判断前端源码是否被双重编码（UTF-8 字节被当 GBK 读再存回 UTF-8）
import fs from "node:fs";

const files = ["apps/desktop/src/index.html", "apps/desktop/src/app.js", "apps/desktop/src/style.css"];
// U+5B66 学 = E5 AD A6 ; U+701B 瀛 = E7 80 9B
const XUE = Buffer.from([0xe5, 0xad, 0xa6]);
const YING = Buffer.from([0xe7, 0x80, 0x9b]);

for (const f of files) {
  const b = fs.readFileSync(f);
  const bom = b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf;
  const txt = b.toString("utf8");
  const title = (txt.match(/<title>([^<]*)<\/title>/) || [])[1] || "";
  const hasBad = /[\uFFFD]/.test(txt);
  console.log(f);
  console.log("  BOM:", bom, "含U+FFFD(解码失败):", hasBad);
  console.log("  真学(E5ADA6)出现:", b.includes(XUE), " | 瀛(E7809B)出现:", b.includes(YING));
  if (title) console.log("  title:", JSON.stringify(title), "码点:", [...title].map((c) => c.codePointAt(0).toString(16)).join(" "));
  // 采样首 200 字符的可读性
  const head = txt.slice(0, 120).replace(/\s+/g, " ");
  console.log("  head:", JSON.stringify(head));
}
