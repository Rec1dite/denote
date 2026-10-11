import { execSync } from "node:child_process";
import { createServer } from "node:http";
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import svelte from "rollup-plugin-svelte";
import resolvePlugin from "@rollup/plugin-node-resolve";
import terser from "@rollup/plugin-terser";

const production = !process.env.ROLLUP_WATCH;
const root = resolve(import.meta.dirname ?? ".");
const devPort = Number(process.env.DOCS_PORT ?? 8086);

// Regenerates the derived sources (icons, latest release, highlighted snippets) on every build,
// and watches their inputs so editing a snippet or icon triggers a rebuild.
function generate() {
  return {
    name: "denote-generate",
    buildStart() {
      execSync("node scripts/icons.mjs && node scripts/release.mjs && node scripts/highlight.mjs", {
        stdio: "inherit",
      });
      this.addWatchFile(resolve(root, "src/snippets.js"));
      for (const file of readdirSync(resolve(root, "icons"))) {
        this.addWatchFile(resolve(root, "icons", file));
      }
    },
  };
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
};

// Serves docs/ and live-reloads connected browsers after each rebuild (dev only, no deps).
function devServer() {
  let clients = [];
  let server;
  return {
    name: "denote-dev-server",
    buildStart() {
      if (server) return;
      server = createServer((req, res) => {
        const url = new URL(req.url, `http://localhost:${devPort}`);
        if (url.pathname === "/__reload") {
          res.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            connection: "keep-alive",
          });
          res.write("retry: 500\n\n");
          clients.push(res);
          req.on("close", () => {
            clients = clients.filter((client) => client !== res);
          });
          return;
        }
        let pathname = decodeURIComponent(url.pathname);
        if (pathname === "/") pathname = "/index.html";
        const file = join(root, normalize(pathname).replace(/^(\.\.[/\\])+/, ""));
        try {
          const body = readFileSync(file);
          const type = MIME[extname(file)] ?? "application/octet-stream";
          const headers = { "content-type": type, "cache-control": "no-store" };
          if (type.startsWith("text/html")) {
            const html = body
              .toString("utf8")
              .replace("</body>", `<script>new EventSource('/__reload').onmessage=()=>location.reload()</script></body>`);
            res.writeHead(200, headers);
            res.end(html);
          } else {
            res.writeHead(200, headers);
            res.end(body);
          }
        } catch {
          res.writeHead(404, { "content-type": "text/plain" });
          res.end("Not found");
        }
      });
      server.listen(devPort, "127.0.0.1", () => {
        console.log(`\n  docs dev server  http://localhost:${devPort}  (live reload)\n`);
      });
    },
    writeBundle() {
      for (const client of clients) client.write("data: reload\n\n");
    },
  };
}

export default {
  input: "src/main.js",
  output: {
    file: "build/bundle.js",
    format: "iife",
    name: "DenoteDocs",
    sourcemap: false,
  },
  plugins: [
    generate(),
    svelte({ compilerOptions: { dev: !production } }),
    resolvePlugin({ browser: true, dedupe: ["svelte"] }),
    production && terser(),
    !production && devServer(),
  ],
  watch: { clearScreen: false },
};
