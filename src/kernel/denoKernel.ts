import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as net from "net";
import * as crypto from "crypto";
import { ChildProcess, spawn } from "child_process";
import { IConnectionFile, IKernelMessage } from "./protocol";
import { JupyterSession, IExecuteResult } from "./session";

const DENO_KERNEL_SPEC_DIRS = [
  process.env.JUPYTER_DATA_DIR,
  path.join(os.homedir(), ".local", "share", "jupyter", "kernels"),
  "/usr/local/share/jupyter/kernels",
  "/usr/share/jupyter/kernels",
].filter((p): p is string => !!p);

export class KernelExitedError extends Error {
  constructor() {
    super("The Deno kernel exited");
    this.name = "KernelExitedError";
  }
}

// Locate the deno kernel launch command, preferring an explicit path, then the registered kernelspec.
export function getDenoKernelCommand(
  connFile: string,
  denoPath?: string,
): { command: string; args: string[] } {
  if (denoPath) {
    return { command: denoPath, args: ["jupyter", "--kernel", "--conn", connFile] };
  }
  for (const dir of DENO_KERNEL_SPEC_DIRS) {
    const specFile = path.join(dir, "deno", "kernel.json");
    if (fs.existsSync(specFile)) {
      try {
        const spec = JSON.parse(fs.readFileSync(specFile, "utf8")) as { argv?: string[] };
        const argv = spec.argv;
        if (argv?.length) {
          return {
            command: argv[0],
            args: argv.slice(1).map((a) => (a === "{connection_file}" ? connFile : a)),
          };
        }
      } catch {
        // fall through to the default invocation
      }
    }
  }
  const deno = process.env.DENO_BIN || path.join(os.homedir(), ".deno", "bin", "deno");
  return { command: deno, args: ["jupyter", "--kernel", "--conn", connFile] };
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function createConnectionFile(dir: string): Promise<{ connection: IConnectionFile; file: string }> {
  const [shell_port, iopub_port, stdin_port, control_port, hb_port] = await Promise.all([
    freePort(),
    freePort(),
    freePort(),
    freePort(),
    freePort(),
  ]);
  const connection: IConnectionFile = {
    transport: "tcp",
    ip: "127.0.0.1",
    shell_port,
    iopub_port,
    stdin_port,
    control_port,
    hb_port,
    signature_scheme: "hmac-sha256",
    key: crypto.randomUUID(),
    kernel_name: "deno",
  };
  const file = path.join(dir, "connection.json");
  fs.writeFileSync(file, JSON.stringify(connection, null, 2));
  return { connection, file };
}

export interface IStartOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  denoPath?: string;
}

// Owns a `deno jupyter --kernel` child process and its Jupyter session.
export class DenoKernel implements vscode.Disposable {
  private readonly exitEmitter = new vscode.EventEmitter<void>();
  readonly onDidExit = this.exitEmitter.event;

  private disposed = false;
  private exited = false;

  private readonly killOnHostExit = () => {
    try {
      this.proc.kill("SIGKILL");
    } catch {
      // ignore
    }
  };

  private constructor(
    private readonly proc: ChildProcess,
    private readonly session: JupyterSession,
    private readonly runtimeDir: string,
    private readonly log: (...args: unknown[]) => void,
  ) {
    proc.on("exit", (code, signal) => {
      this.exited = true;
      this.log(`kernel exited code=${code} signal=${signal}`);
      this.exitEmitter.fire();
    });
    // Ensure the kernel dies if the extension host goes away (e.g. window reload).
    proc.once("exit", () => process.removeListener("exit", this.killOnHostExit));
    process.once("exit", this.killOnHostExit);
  }

  static async start(log: (...args: unknown[]) => void, options: IStartOptions = {}): Promise<DenoKernel> {
    const runtimeDir = path.join(os.tmpdir(), "denote", `kernel-${crypto.randomUUID()}`);
    fs.mkdirSync(runtimeDir, { recursive: true });
    const { connection, file } = await createConnectionFile(runtimeDir);
    const { command, args } = getDenoKernelCommand(file, options.denoPath);
    log("starting deno kernel:", command, args.join(" "));

    const proc = spawn(command, args, {
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    proc.stdout?.on("data", (data) => log(`kernel stdout: ${String(data).trimEnd()}`));
    proc.stderr?.on("data", (data) => log(`kernel stderr: ${String(data).trimEnd()}`));

    const session = new JupyterSession(connection, log);
    const kernel = new DenoKernel(proc, session, runtimeDir, log);
    try {
      await new Promise<void>((resolve, reject) => {
        proc.once("error", reject);
        proc.once("spawn", () => resolve());
      });
      await session.start();
    } catch (err) {
      await kernel.dispose();
      throw err;
    }
    return kernel;
  }

  async execute(
    code: string,
    onMessage: (message: IKernelMessage) => void | Promise<void>,
    signal?: AbortSignal,
  ): Promise<IExecuteResult> {
    if (this.exited) throw new KernelExitedError();
    let subscription: vscode.Disposable | undefined;
    const exit = new Promise<never>((_, reject) => {
      subscription = this.onDidExit(() => reject(new KernelExitedError()));
    });
    try {
      return await Promise.race([this.session.execute(code, onMessage, signal), exit]);
    } finally {
      subscription?.dispose();
    }
  }

  interrupt(): Promise<void> {
    return this.session.interrupt();
  }

  waitForIdle(timeoutMs: number): Promise<boolean> {
    return this.session.waitForIdle(timeoutMs);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.exited = true;
    this.exitEmitter.fire();
    try {
      await this.session.shutdown();
    } catch {
      // ignore
    }
    this.session.dispose();
    this.exitEmitter.dispose();
    process.removeListener("exit", this.killOnHostExit);
    try {
      this.proc.kill("SIGKILL");
    } catch {
      // ignore
    }
    try {
      fs.rmSync(this.runtimeDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}
