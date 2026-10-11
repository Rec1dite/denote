import * as vscode from "vscode";
import { KernelManager } from "./kernelManager";
import { KernelExitedError } from "./kernel/denoKernel";
import {
  IDisplayContent,
  IErrorContent,
  IExecuteInputContent,
  IKernelMessage,
  IStreamContent,
} from "./kernel/protocol";

export const DENO_CONTROLLER_ID = "deno-jupyter";

// How long to coalesce/batch outputs before sending them to VS Code. Streaming 1000 lines as
// 1000 separate appendOutput round-trips is far too slow; batching keeps rendering fast.
const FLUSH_INTERVAL_MS = 16;

// Jupyter sends binary data (images, pdf) base64-encoded; VS Code renderers expect raw bytes.
export const BINARY_MIME = /^image\/(?!svg\+xml)/;

function toOutputItems(data: Record<string, unknown>): vscode.NotebookCellOutputItem[] {
  const items: vscode.NotebookCellOutputItem[] = [];
  for (const [mime, value] of Object.entries(data ?? {})) {
    try {
      if (typeof value === "string") {
        if (BINARY_MIME.test(mime) || mime === "application/pdf") {
          items.push(new vscode.NotebookCellOutputItem(Buffer.from(value, "base64"), mime));
        } else {
          items.push(vscode.NotebookCellOutputItem.text(value, mime));
        }
      } else if (Array.isArray(value) && value.every((v) => typeof v === "number")) {
        items.push(new vscode.NotebookCellOutputItem(Uint8Array.from(value as number[]), mime));
      } else {
        items.push(vscode.NotebookCellOutputItem.json(value, mime));
      }
    } catch {
      // skip mime types that cannot be represented
    }
  }
  return items;
}

// Buffers kernel messages and flushes them to the cell in coalesced batches. Also tracks
// `display_id`s so `update_display_data` can replace an output in place (progress bars, widgets).
class CellOutputSink {
  private readonly outputs: vscode.NotebookCellOutput[] = [];
  private readonly displayOutputs = new Map<string, vscode.NotebookCellOutput>();
  private pendingStream: { name: "stdout" | "stderr"; text: string } | undefined;
  private flushScheduled = false;
  private flushChain: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(private readonly execution: vscode.NotebookCellExecution) {}

  handle(message: IKernelMessage): void {
    switch (message.header.msg_type) {
      case "stream": {
        const content = message.content as IStreamContent;
        this.appendStream(content.name, content.text);
        break;
      }
      case "execute_result":
      case "display_data": {
        this.handleDisplay(message, false);
        break;
      }
      case "update_display_data": {
        this.handleDisplay(message, true);
        break;
      }
      case "error": {
        const content = message.content as IErrorContent;
        this.appendOutput(
          new vscode.NotebookCellOutput([
            vscode.NotebookCellOutputItem.error({
              name: content.ename,
              message: content.evalue,
              stack: (content.traceback || []).join("\n"),
            }),
          ]),
        );
        break;
      }
      case "execute_input": {
        this.execution.executionOrder = (message.content as IExecuteInputContent).execution_count;
        break;
      }
      default:
        break;
    }
  }

  private handleDisplay(message: IKernelMessage, isUpdate: boolean) {
    const content = message.content as IDisplayContent;
    const items = toOutputItems(content.data);
    if (!items.length) return;
    const displayId = content.transient?.display_id;

    if (isUpdate && displayId) {
      const existing = this.displayOutputs.get(displayId);
      if (existing) {
        this.flush();
        this.enqueue(() => this.execution.replaceOutputItems(items, existing));
        return;
      }
      // No known output for this display_id; fall through and append it.
    }

    const output = new vscode.NotebookCellOutput(items, content.metadata);
    if (displayId) {
      // Appending immediately gives the output a stable identity for later updates.
      this.displayOutputs.set(displayId, output);
      this.flush();
      this.enqueue(() => this.execution.appendOutput(output));
    } else {
      this.appendOutput(output);
    }
  }

  private appendStream(name: "stdout" | "stderr", text: string) {
    // Coalesce consecutive output from the same stream into a single output.
    if (this.pendingStream && this.pendingStream.name === name) {
      this.pendingStream.text += text;
    } else {
      this.flushStream();
      this.pendingStream = { name, text };
    }
    this.schedule();
  }

  private appendOutput(output: vscode.NotebookCellOutput) {
    this.flushStream();
    this.outputs.push(output);
    this.schedule();
  }

  private flushStream() {
    if (!this.pendingStream) return;
    const { name, text } = this.pendingStream;
    this.pendingStream = undefined;
    const item =
      name === "stderr"
        ? vscode.NotebookCellOutputItem.stderr(text)
        : vscode.NotebookCellOutputItem.stdout(text);
    this.outputs.push(new vscode.NotebookCellOutput([item]));
  }

  private schedule() {
    if (this.flushScheduled || this.closed) return;
    this.flushScheduled = true;
    setTimeout(() => {
      this.flushScheduled = false;
      void this.flush();
    }, FLUSH_INTERVAL_MS);
  }

  private enqueue(action: () => Thenable<void>): Promise<void> {
    this.flushChain = this.flushChain.then(action).catch(() => undefined);
    return this.flushChain;
  }

  flush(): Promise<void> {
    this.flushStream();
    if (!this.outputs.length) return this.flushChain;
    const batch = this.outputs.splice(0, this.outputs.length);
    return this.enqueue(() => this.execution.appendOutput(batch));
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.flush();
  }
}

// Registers a NotebookController for the `interactive` view type, mirroring vscode-jupyter's
// VSCodeNotebookController: VS Code drives execution, we stream kernel output into the cell.
export class DenoKernelController implements vscode.Disposable {
  private readonly controller: vscode.NotebookController;
  private readonly activeExecutions = new Map<string, Set<AbortController>>();

  constructor(
    private readonly manager: KernelManager,
    private readonly log: (...args: unknown[]) => void,
  ) {
    this.controller = vscode.notebooks.createNotebookController(
      DENO_CONTROLLER_ID,
      "interactive",
      "Deno",
      (cells, notebook) => this.executeCells(cells, notebook),
    );
    this.controller.supportsExecutionOrder = true;
    this.controller.supportedLanguages = [
      "javascript",
      "typescript",
      "javascriptreact",
      "typescriptreact",
    ];
    this.controller.description = "Deno";
    this.controller.detail = "Deno Jupyter kernel (deno jupyter)";
    this.controller.interruptHandler = (notebook) => this.interrupt(notebook);
  }

  get id(): string {
    return this.controller.id;
  }

  // Mark this controller as the preferred kernel for an interactive window.
  prefer(notebook: vscode.NotebookDocument) {
    this.controller.updateNotebookAffinity(notebook, vscode.NotebookControllerAffinity.Preferred);
  }

  // Interrupt the kernel and stop any client-side draining so the cell ends promptly.
  async interrupt(notebook: vscode.NotebookDocument): Promise<void> {
    this.abortExecutions(notebook.uri.toString());
    await this.manager.interruptKernel(notebook);
  }

  async restart(notebook: vscode.NotebookDocument): Promise<void> {
    this.abortExecutions(notebook.uri.toString());
    await this.manager.restartKernel(notebook);
  }

  private abortExecutions(key: string) {
    for (const abort of this.activeExecutions.get(key) ?? []) abort.abort();
  }

  private async executeCells(cells: vscode.NotebookCell[], notebook: vscode.NotebookDocument) {
    for (const cell of cells) {
      if (cell.kind !== vscode.NotebookCellKind.Code) continue;
      await this.runCell(cell, notebook);
    }
  }

  // Execute a single cell through this controller (mirrors vscode-jupyter's executeCell).
  executeCell(cell: vscode.NotebookCell): Promise<void> {
    return this.runCell(cell, cell.notebook);
  }

  private async runCell(cell: vscode.NotebookCell, notebook: vscode.NotebookDocument) {
    let execution: vscode.NotebookCellExecution;
    try {
      execution = this.controller.createNotebookCellExecution(cell);
    } catch {
      // Our controller is not the selected kernel for this notebook (e.g. the user picked another
      // controller); let VS Code run the cell through whichever controller is selected.
      await vscode.commands.executeCommand("notebook.cell.execute", {
        document: notebook.uri,
        ranges: [new vscode.NotebookRange(cell.index, cell.index + 1)],
      });
      return;
    }

    execution.start(Date.now());
    execution.clearOutput();
    const code = cell.document.getText();
    this.log("executing cell", cell.index, "code:", code.slice(0, 60));

    const key = notebook.uri.toString();
    const abort = new AbortController();
    this.trackExecution(key, abort);
    const sink = new CellOutputSink(execution);
    const cancelled = execution.token.onCancellationRequested(() => {
      this.interrupt(notebook).catch(() => undefined);
    });

    try {
      const kernel = await this.manager.getKernel(notebook);
      const result = await kernel.execute(code, (message) => sink.handle(message), abort.signal);
      await sink.close();
      if (result.executionCount) execution.executionOrder = result.executionCount;
      execution.end(result.status === "ok", Date.now());
    } catch (err) {
      await sink.close();
      if (err instanceof KernelExitedError && this.manager.isTerminating(notebook)) {
        // Interrupt/restart ends the execution quietly.
        execution.end(false, Date.now());
      } else {
        const error = err instanceof Error ? err : new Error(String(err));
        this.log("execution failed", error);
        await execution.replaceOutput([
          new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.error(error)]),
        ]);
        execution.end(false, Date.now());
      }
    } finally {
      cancelled.dispose();
      this.untrackExecution(key, abort);
    }
  }

  private trackExecution(key: string, abort: AbortController) {
    let set = this.activeExecutions.get(key);
    if (!set) {
      set = new Set();
      this.activeExecutions.set(key, set);
    }
    set.add(abort);
  }

  private untrackExecution(key: string, abort: AbortController) {
    const set = this.activeExecutions.get(key);
    if (!set) return;
    set.delete(abort);
    if (!set.size) this.activeExecutions.delete(key);
  }

  dispose(): void {
    for (const set of this.activeExecutions.values()) {
      for (const abort of set) abort.abort();
    }
    this.activeExecutions.clear();
    this.controller.dispose();
  }
}
