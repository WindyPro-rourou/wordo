// 把预览配置切到 magpie 网关（路由组 auto/deepseek-v4.1-flash）
import fs from "node:fs";
import path from "node:path";
const H = process.env.DSH_HOME;
const key = (fs.readFileSync(path.join(H, ".env"), "utf8").match(/^MAGPIE_GATEWAY_KEY=(.*)$/m) || [])[1]?.trim();
const cfg = {
  providers: [
    {
      preset: "magpie",
      base_url: "http://127.0.0.1:3425/v1",
      api_key: key,
      model: "auto/deepseek-v4.1-flash",
    },
  ],
  active: 0,
  thinking: "normal",
};
fs.writeFileSync(".config.json", JSON.stringify(cfg, null, 2), "utf8");
const b = fs.readFileSync(".config.json");
console.log("written bytes:", b.length, "first:", b[0], "keyLen:", key.length);
