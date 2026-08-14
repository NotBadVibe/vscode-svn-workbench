/*
 * Spike 专用静态服务器：服务 tests/spike/dist 构建产物，
 * 按 ?csp= 参数在文档响应上注入与生产 Webview 等价的 CSP 响应头。
 *
 * 生产 CSP（renderWebviewShell.ts）：
 *   default-src 'none'; img-src ${cspSource} data:; font-src ${cspSource};
 *   style-src ${cspSource}; script-src 'nonce-…' ${cspSource}; connect-src 'none'
 * spike 等价替换：cspSource → 'self'（普通 http origin 下的同源自指）。
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "dist");
const port = Number(process.env.SPIKE_PORT ?? 41831);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

function cspFor(mode) {
  switch (mode) {
    case "strict":
      // 与生产一致：style-src 无 'unsafe-inline'
      return "default-src 'none'; img-src 'self' data:; font-src 'self'; style-src 'self'; script-src 'self' 'nonce-spike'; connect-src 'none'";
    case "unsafe-inline":
      // 归因对照组：仅放开 style-src 内联
      return "default-src 'none'; img-src 'self' data:; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'nonce-spike'; connect-src 'none'";
    default:
      return null;
  }
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
    const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
    const filePath = path.join(root, path.normalize(pathname));
    if (!filePath.startsWith(root)) {
      response.writeHead(403).end("forbidden");
      return;
    }
    const body = await readFile(filePath);
    const headers = {
      "content-type":
        MIME[path.extname(filePath)] ?? "application/octet-stream",
    };
    if (filePath.endsWith("index.html")) {
      const params = new URLSearchParams(url.search);
      const csp = cspFor(params.get("csp") ?? "strict");
      if (csp != null) headers["content-security-policy"] = csp;
    }
    response.writeHead(200, headers).end(body);
  } catch {
    response.writeHead(404).end("not found");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`spike server: http://127.0.0.1:${port} (root=${root})`);
});
