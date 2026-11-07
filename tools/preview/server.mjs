// WORDO 预览服务器：静态托管 apps/desktop/src + /api/<name> 桥接到 backend.mjs
// 用法: node server.mjs [--port 4310] [--packs <dir>] [--domain <dir>] [--config <file>]
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { invoke, state } from "./backend.mjs";

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const SRC = path.join(REPO, "apps/desktop/src");

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const PORT = Number(arg("port", 4310));
state.packsDir = path.resolve(arg("packs", path.join(REPO, "packs")));
state.domain = path.resolve(arg("domain", path.join(HERE, "domain")));
state.configPath = path.resolve(arg("config", path.join(HERE, ".config.json")));

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };

function send(res, code, body, type) {
  res.writeHead(code, { "Content-Type": type || "text/plain; charset=utf-8", "Cache-Control": "no-store" });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const u = url.parse(req.url, true);

  // ---- API ----
  if (u.pathname.startsWith("/api/") && req.method === "POST") {
    const name = u.pathname.slice("/api/".length);
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", async () => {
      let args = {};
      try { args = raw ? JSON.parse(raw) : {}; } catch { return send(res, 400, JSON.stringify({ ok: false, error: "参数不是合法 JSON" }), MIME[".json"]); }
      const t0 = Date.now();
      try {
        const data = await invoke(name, args);
        console.log(`[api] ${name} ${Date.now() - t0}ms ok`);
        send(res, 200, JSON.stringify({ ok: true, data }), MIME[".json"]);
      } catch (e) {
        console.log(`[api] ${name} ${Date.now() - t0}ms ERROR ${e.message}`);
        send(res, 200, JSON.stringify({ ok: false, error: String(e && e.message || e) }), MIME[".json"]);
      }
    });
    return;
  }

  // ---- 静态 ----
  let p = u.pathname === "/" ? "/index.html" : u.pathname;

  if (p === "/favicon.ico") return send(res, 204, "");

  // 垫片必须在静态存在性检查之前处理（它不是 src 下的真实文件）
  if (p === "/__shim.js") {
    return send(res, 200, fs.readFileSync(path.join(HERE, "shim.js")), MIME[".js"]);
  }

  const file = path.join(SRC, p);
  if (!file.startsWith(SRC) || !fs.existsSync(file)) return send(res, 404, "not found");
  let body = fs.readFileSync(file);
  if (p === "/index.html") {
    // 注入 Tauri 兼容垫片（在 app.js 之前）
    body = body.toString("utf8").replace('<script src="app.js"></script>', '<script src="/__shim.js"></script>\n  <script src="app.js"></script>');
  }
  send(res, 200, body, MIME[path.extname(file)] || "application/octet-stream");
});

server.listen(PORT, () => {
  console.log(`WORDO 预览: http://127.0.0.1:${PORT}`);
  console.log(`  packs  : ${state.packsDir}`);
  console.log(`  domain : ${state.domain}`);
  console.log(`  config : ${state.configPath}`);
});
