import * as vscode from "vscode";
import { Decorator } from "./decorator";
import { DenoteCodeLensProvider } from "./codeLensProvider";
import { startDevBridge } from "./devBridge";
import { KernelManager } from "./kernelManager";
import { DenoKernelController, BINARY_MIME } from "./notebookController";
import { InteractiveWindowProvider } from "./interactiveWindow";
import { initConfig, getConfig } from "./config";
import { generateCellRangesFromDocument, stripFirstMarker, stripMarkdownTerminator, ICellRange } from "./cellMatcher";

const JS_LANGS = ["javascript", "typescript", "javascriptreact", "typescriptreact"];

const logBuffer: string[] = [];
let outputChannel: vscode.OutputChannel | undefined;

function log(...args: unknown[]) {
  const line = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
  logBuffer.push(line);
  outputChannel?.appendLine(line);
  if (getConfig().trace) console.warn("[Denote]", ...args);
}

function isJsLang(document: vscode.TextDocument): boolean {
  return JS_LANGS.includes(document.languageId);
}

function getCellRanges(document: vscode.TextDocument): ICellRange[] {
  const config = getConfig();
  return generateCellRangesFromDocument(document.lineCount, (i) => document.lineAt(i).text, config);
}

function cellCode(document: vscode.TextDocument, cell: ICellRange): string {
  return document.getText(
    new vscode.Range(cell.range.start.line, 0, cell.range.end.line, cell.range.end.character),
  );
}

function activeInteractiveNotebook(): vscode.NotebookDocument | undefined {
  const notebook = vscode.window.activeNotebookEditor?.notebook;
  return notebook && notebook.notebookType === "interactive" ? notebook : undefined;
}

export function activate(context: vscode.ExtensionContext) {
  const hasCellsKey = "denote.hasCodeCells";
  const extensionId = context.extension.id;

  initConfig(context);

  outputChannel = vscode.window.createOutputChannel("Denote");
  context.subscriptions.push(outputChannel);

  const bridge = startDevBridge(logBuffer);
  if (bridge) log("dev bridge:", bridge);

  const kernelManager = new KernelManager(log);
  const controller = new DenoKernelController(kernelManager, log);
  const interactiveWindows = new InteractiveWindowProvider(controller, extensionId, log);

  context.subscriptions.push(kernelManager, controller, interactiveWindows, new Decorator());

  function updateContext(editor: vscode.TextEditor | undefined) {
    if (!editor || !isJsLang(editor.document)) {
      vscode.commands.executeCommand("setContext", hasCellsKey, false);
      return;
    }
    const cells = getCellRanges(editor.document);
    vscode.commands.executeCommand("setContext", hasCellsKey, cells.length > 0);
  }

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(updateContext),
    vscode.workspace.onDidChangeTextDocument((e) => {
      const editor = vscode.window.activeTextEditor;
      if (editor && e.document === editor.document) updateContext(editor);
    }),
  );
  updateContext(vscode.window.activeTextEditor);

  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      JS_LANGS.map((language) => ({ language, scheme: "*" })),
      new DenoteCodeLensProvider(),
    ),
  );

  function documentFor(uri?: vscode.Uri): vscode.TextDocument | undefined {
    if (uri) {
      return (
        vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString()) ??
        vscode.window.activeTextEditor?.document
      );
    }
    return vscode.window.activeTextEditor?.document;
  }

  // Insert a cell into the interactive window and run it through our controller.
  async function executeCell(document: vscode.TextDocument, cell: ICellRange): Promise<void> {
    const isMarkdown = cell.cellType === "markdown";
    let code = stripFirstMarker(cellCode(document, cell), getConfig());
    if (isMarkdown) code = stripMarkdownTerminator(code);
    const notebookCell = await interactiveWindows.addCode(
      code,
      document.uri,
      cell.range.start.line,
      document.languageId,
      isMarkdown,
    );
    if (!isMarkdown) {
      await controller.executeCell(notebookCell);
    }
  }

  function cellAtLine(document: vscode.TextDocument, line: number): ICellRange | undefined {
    return getCellRanges(document).find(
      (c) => line >= c.range.start.line && line <= c.range.end.line,
    );
  }

  async function runCell(uri: vscode.Uri | undefined, startLine: number | undefined) {
    const document = documentFor(uri);
    if (!document || !isJsLang(document)) return;
    const editor = vscode.window.activeTextEditor;

    const targetLine = startLine ?? editor?.selection.active.line ?? 0;
    const cell = cellAtLine(document, targetLine);
    if (!cell) {
      log("no cell found at line", targetLine);
      return;
    }
    log("runCell", document.uri.toString(), "line", cell.range.start.line);
    await executeCell(document, cell);
  }

  async function runCells(
    document: vscode.TextDocument,
    predicate: (cell: ICellRange, index: number) => boolean,
  ) {
    if (!isJsLang(document)) return;
    const cells = getCellRanges(document);
    for (let i = 0; i < cells.length; i++) {
      if (predicate(cells[i], i)) {
        await executeCell(document, cells[i]);
      }
    }
  }

  async function clearAllCells() {
    const notebook = activeInteractiveNotebook();
    if (!notebook) return;
    const edit = new vscode.WorkspaceEdit();
    edit.set(notebook.uri, [
      vscode.NotebookEdit.replaceCells(new vscode.NotebookRange(0, notebook.cellCount), []),
    ]);
    await vscode.workspace.applyEdit(edit);
  }

  async function exportInteractiveWindow(asNotebook: boolean) {
    const notebook = activeInteractiveNotebook();
    if (!notebook) return;

    const defaultUri = vscode.Uri.joinPath(
      vscode.workspace.workspaceFolders?.[0]?.uri ?? vscode.Uri.file(process.cwd()),
      asNotebook ? "interactive.ipynb" : "interactive.ts",
    );
    const target = await vscode.window.showSaveDialog({
      defaultUri,
      filters: asNotebook ? { Jupyter: ["ipynb"] } : { TypeScript: ["ts"], JavaScript: ["js"] },
    });
    if (!target) return;

    const content = asNotebook ? serializeNotebook(notebook) : serializeSource(notebook);
    await vscode.workspace.fs.writeFile(target, Buffer.from(content, "utf8"));
    const opened = await vscode.workspace.openTextDocument(target);
    await vscode.window.showTextDocument(opened);
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("denote.runCell", (uri?: vscode.Uri, startLine?: number) =>
      runCell(uri, startLine),
    ),

    vscode.commands.registerCommand("denote.runCellAndAdvance", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isJsLang(editor.document)) return;
      const document = editor.document;
      const cell = cellAtLine(document, editor.selection.active.line);
      if (!cell) return;
      await executeCell(document, cell);

      const cells = getCellRanges(document);
      const next = cells.find((c) => c.range.start.line > cell.range.start.line);
      const position = next
        ? new vscode.Position(next.range.start.line, 0)
        : new vscode.Position(document.lineCount, 0);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position));
    }),

    vscode.commands.registerCommand("denote.execSelectionInInteractive", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isJsLang(editor.document)) return;
      const { document, selection } = editor;
      const code = document.getText(selection) || document.lineAt(selection.active.line).text;
      if (!code.trim()) return;
      const notebookCell = await interactiveWindows.addCode(
        code,
        document.uri,
        selection.active.line,
        document.languageId,
      );
      await controller.executeCell(notebookCell);
    }),

    vscode.commands.registerCommand("denote.runAllCells", async (uri?: vscode.Uri) => {
      const document = documentFor(uri);
      if (document) await runCells(document, () => true);
    }),

    vscode.commands.registerCommand(
      "denote.runAllCellsAbove",
      async (uri?: vscode.Uri, startLine?: number) => {
        const document = documentFor(uri);
        if (document) await runCells(document, (cell) => cell.range.start.line < (startLine ?? 0));
      },
    ),

    vscode.commands.registerCommand(
      "denote.runAllCellsBelow",
      async (uri?: vscode.Uri, startLine?: number) => {
        const document = documentFor(uri);
        if (document) await runCells(document, (cell) => cell.range.start.line >= (startLine ?? 0));
      },
    ),

    vscode.commands.registerCommand("denote.insertCellBelow", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isJsLang(editor.document)) return;
      const line = editor.selection.active.line;
      editor.edit((eb) => eb.insert(new vscode.Position(line + 1, 0), `${getConfig().defaultCellMarker}\n\n`));
    }),

    vscode.commands.registerCommand("denote.insertCellAbove", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isJsLang(editor.document)) return;
      const line = editor.selection.active.line;
      editor.edit((eb) => eb.insert(new vscode.Position(line, 0), `${getConfig().defaultCellMarker}\n\n`));
    }),

    vscode.commands.registerCommand("denote.clearAllCells", clearAllCells),

    vscode.commands.registerCommand("denote.restartKernel", async () => {
      const notebook = activeInteractiveNotebook();
      if (notebook) await controller.restart(notebook);
    }),

    vscode.commands.registerCommand("denote.export", () => exportInteractiveWindow(false)),

    vscode.commands.registerCommand("denote.exportAsNotebook", () => exportInteractiveWindow(true)),

    vscode.commands.registerCommand("denote.expandAllCells", () =>
      vscode.commands.executeCommand("notebook.cell.expandAllCellInputs"),
    ),

    vscode.commands.registerCommand("denote.collapseAllCells", () =>
      vscode.commands.executeCommand("notebook.cell.collapseAllCellInputs"),
    ),
  );
}

function toSourceArray(text: string): string[] {
  if (!text) return [];
  return text.match(/[^\n]*\n|[^\n]+/g) ?? [];
}

function decodeItem(item: vscode.NotebookCellOutputItem): string {
  return Buffer.from(item.data).toString("utf8");
}

function toIpynbOutputs(outputs: readonly vscode.NotebookCellOutput[]): unknown[] {
  const result: unknown[] = [];
  for (const output of outputs) {
    for (const item of output.items) {
      if (item.mime === "application/vnd.code.notebook.stdout") {
        result.push({ output_type: "stream", name: "stdout", text: decodeItem(item) });
      } else if (item.mime === "application/vnd.code.notebook.stderr") {
        result.push({ output_type: "stream", name: "stderr", text: decodeItem(item) });
      } else if (item.mime === "application/vnd.code.notebook.error") {
        try {
          const parsed = JSON.parse(decodeItem(item)) as { name?: string; message?: string; stack?: string };
          result.push({
            output_type: "error",
            ename: parsed.name ?? "Error",
            evalue: parsed.message ?? "",
            traceback: (parsed.stack ?? "").split("\n"),
          });
        } catch {
          result.push({ output_type: "error", ename: "Error", evalue: decodeItem(item), traceback: [] });
        }
      } else {
        const isBinary = BINARY_MIME.test(item.mime) || item.mime === "application/pdf";
        result.push({
          output_type: "execute_result",
          data: { [item.mime]: isBinary ? Buffer.from(item.data).toString("base64") : decodeItem(item) },
          metadata: output.metadata ?? {},
          execution_count: null,
        });
      }
    }
  }
  return result;
}

export function serializeNotebook(notebook: vscode.NotebookDocument): string {
  const cells = notebook.getCells().map((cell) => {
    if (cell.kind === vscode.NotebookCellKind.Markup) {
      return { cell_type: "markdown", metadata: {}, source: toSourceArray(cell.document.getText()) };
    }
    return {
      cell_type: "code",
      metadata: {},
      execution_count: cell.executionSummary?.executionOrder ?? null,
      source: toSourceArray(cell.document.getText()),
      outputs: toIpynbOutputs(cell.outputs),
    };
  });
  return JSON.stringify(
    {
      cells,
      metadata: {
        kernelspec: { name: "deno", display_name: "Deno", language: "typescript" },
        language_info: { name: "typescript" },
      },
      nbformat: 4,
      nbformat_minor: 5,
    },
    null,
    2,
  );
}

export function serializeSource(notebook: vscode.NotebookDocument): string {
  const marker = getConfig().defaultCellMarker;
  const markdownOpen = `${marker.replace(/^\/\//, "/*")} [markdown]`;
  return notebook
    .getCells()
    .map((cell) =>
      cell.kind === vscode.NotebookCellKind.Markup
        ? `${markdownOpen}\n${cell.document.getText()}\n*/`
        : `${marker}\n${cell.document.getText()}`,
    )
    .join("\n\n");
}

export function deactivate() {}
