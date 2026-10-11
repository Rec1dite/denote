import * as vscode from "vscode";
import * as path from "path";
import { DenoKernel } from "./kernel/denoKernel";

// After an interrupt, wait this long for the kernel to go idle before restarting it.
// The Deno kernel can only terminate synchronous execution; a pending `await` needs a restart.
const INTERRUPT_GRACE_MS = 2000;

// One Deno kernel per notebook (interactive window), started lazily on first execution.
export class KernelManager implements vscode.Disposable {
  private readonly kernels = new Map<string, Promise<DenoKernel>>();
  private readonly terminating = new Set<string>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly log: (...args: unknown[]) => void) {
    this.disposables.push(
      vscode.workspace.onDidCloseNotebookDocument((doc) => this.disposeKernel(doc.uri.toString())),
    );
  }

  // The kernel runs with the owning source file's directory as its cwd, so relative imports
  // resolve exactly as they do with `deno run`.
  private kernelCwd(notebook: vscode.NotebookDocument): string {
    for (const cell of notebook.getCells()) {
      const uri = (cell.metadata as { interactive?: { uristring?: string } })?.interactive?.uristring;
      if (uri) return path.dirname(vscode.Uri.parse(uri).fsPath);
    }
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
  }

  getKernel(notebook: vscode.NotebookDocument): Promise<DenoKernel> {
    const key = notebook.uri.toString();
    let kernel = this.kernels.get(key);
    if (!kernel) {
      kernel = this.startKernel(notebook, key);
    }
    return kernel;
  }

  private startKernel(notebook: vscode.NotebookDocument, key: string): Promise<DenoKernel> {
    const cwd = this.kernelCwd(notebook);
    const denoPath = vscode.workspace.getConfiguration("denote").get<string>("denoPath") || undefined;
    this.log("starting kernel for", key, "cwd:", cwd);
    const kernel = DenoKernel.start(this.log, { cwd, denoPath });
    this.kernels.set(key, kernel);
    kernel
      .then((k) =>
        k.onDidExit(() => {
          if (this.kernels.get(key) === kernel) this.kernels.delete(key);
        }),
      )
      .catch(() => {
        if (this.kernels.get(key) === kernel) this.kernels.delete(key);
      });
    return kernel;
  }

  async restartKernel(notebook: vscode.NotebookDocument): Promise<DenoKernel> {
    const key = notebook.uri.toString();
    this.log("restarting kernel for", key);
    this.terminating.add(key);
    try {
      await this.disposeKernel(key);
      return await this.startKernel(notebook, key);
    } finally {
      this.terminating.delete(key);
    }
  }

  // Interrupt the running cell. The Deno kernel can only terminate synchronous execution, so if
  // it stays busy (e.g. a pending `await`), restart it to unblock the kernel.
  async interruptKernel(notebook: vscode.NotebookDocument): Promise<void> {
    const key = notebook.uri.toString();
    this.log("interrupt requested for", key);
    const kernel = await this.getKernel(notebook);
    this.terminating.add(key);
    try {
      await kernel.interrupt();
      this.log("interrupt sent; awaiting idle");
      const idle = await kernel.waitForIdle(INTERRUPT_GRACE_MS);
      this.log("kernel idle after interrupt:", idle);
      if (!idle) {
        this.log("kernel still busy after interrupt; restarting");
        await this.restartKernel(notebook);
      }
    } finally {
      this.terminating.delete(key);
    }
  }

  isTerminating(notebook: vscode.NotebookDocument): boolean {
    return this.terminating.has(notebook.uri.toString());
  }

  private async disposeKernel(key: string) {
    const kernel = this.kernels.get(key);
    if (kernel) {
      this.kernels.delete(key);
      try {
        (await kernel).dispose();
      } catch {
        // ignore
      }
    }
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    for (const kernel of this.kernels.values()) {
      kernel.then((k) => k.dispose()).catch(() => undefined);
    }
    this.kernels.clear();
  }
}
