import * as http from "http";
import * as vscode from "vscode";

// Dev-only automation bridge, enabled when DENOTE_DEV_PORT is set.
// Exposes eval/logs over localhost HTTP so a dev host can be driven + inspected without the UI.
export function startDevBridge(logs: string[]): string | undefined {
  const port = Number(process.env.DENOTE_DEV_PORT);
  if (!port) return undefined;

  const replacer = (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);
  const send = (res: http.ServerResponse, body: string, code = 200) => {
    res.writeHead(code, { "content-type": "text/plain; charset=utf-8" });
    res.end(body);
  };

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        if (req.url === "/health") return send(res, "ok");
        if (req.url === "/logs") return send(res, logs.join("\n"));
        if (req.url === "/clear-logs") {
          logs.length = 0;
          return send(res, "cleared");
        }
        if (req.url === "/eval" && req.method === "POST") {
          const { code } = JSON.parse(body || "{}");
          // Dev-only automation hook: intentionally evaluates caller-provided JS in the
          // extension host. Enabled only when DENOTE_DEV_PORT is set. NOSONAR
          // eslint-disable-next-line @typescript-eslint/no-implied-eval
          const run = new Function(
            "vscode",
            "require",
            `return (async () => { ${code} })();`,
          ) as (v: typeof vscode, r: NodeRequire) => Promise<unknown>;
          const result = await run(vscode, require);
          return send(res, JSON.stringify(result === undefined ? null : result, replacer, 2));
        }
        send(res, "not found", 404);
      } catch (err) {
        send(res, err instanceof Error ? (err.stack ?? err.message) : String(err), 500);
      }
    });
  });
  server.listen(port, "127.0.0.1");
  return `http://127.0.0.1:${port}`;
}
