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

  // Publishes editor/cell state as `when`-clause context keys for keyboard customisation.
  function updateContext(editor: vscode.TextEditor | undefined) {
    const set = (key: string, value: unknown) =>
      vscode.commands.executeCommand("setContext", key, value);
    if (!editor || !isJsLang(editor.document)) {
      set("denote.hasCells", false);
      set("denote.hasCodeCells", false);
      set("denote.cellCount", 0);
      set("denote.inCell", false);
      set("denote.cellType", "");
      set("denote.cellIndex", -1);
      set("denote.isFirstCell", false);
      set("denote.isLastCell", false);
      return;
    }
    const document = editor.document;
    const cells = getCellRanges(document);
    const line = editor.selection.active.line;
    const index = cells.findIndex((c) => line >= c.range.start.line && line <= c.range.end.line);
    const cell = index >= 0 ? cells[index] : undefined;
    set("denote.hasCells", cells.length > 0);
    set("denote.hasCodeCells", cells.length > 0);
    set("denote.cellCount", cells.length);
    set("denote.inCell", index >= 0);
    set("denote.cellType", cell ? cell.cellType : "");
    set("denote.cellIndex", index);
    set("denote.isFirstCell", index === 0);
    set("denote.isLastCell", index >= 0 && index === cells.length - 1);
  }

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(updateContext),
    vscode.window.onDidChangeTextEditorSelection((e) => updateContext(e.textEditor)),
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

  // Move the cursor to the start of a cell. `next`/`previous` step from the cell at the cursor.
  function focusCell(target: "next" | "previous" | "first" | "last"): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !isJsLang(editor.document)) return;
    const document = editor.document;
    const cells = getCellRanges(document);
    if (cells.length === 0) return;
    const line = editor.selection.active.line;
    const inside = cells.findIndex((c) => line >= c.range.start.line && line <= c.range.end.line);
    let index = -1;
    if (target === "first") {
      index = 0;
    } else if (target === "last") {
      index = cells.length - 1;
    } else if (target === "next") {
      index = inside >= 0 ? inside + 1 : cells.findIndex((c) => c.range.start.line > line);
    } else if (inside >= 0) {
      index = inside - 1;
    } else {
      for (let i = 0; i < cells.length; i++) {
        if (cells[i].range.start.line < line) index = i;
      }
    }
    const cell = cells[index];
    if (!cell) return;
    const position = new vscode.Position(cell.range.start.line, 0);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(
      new vscode.Range(position, position),
      vscode.TextEditorRevealType.InCenterIfOutsideViewport,
    );
  }

  // Full-line range for `startLine..endLine`, absorbing a neighbouring newline where possible.
  function fullLineRange(
    document: vscode.TextDocument,
    startLine: number,
    endLine: number,
  ): vscode.Range {
    if (endLine + 1 < document.lineCount) {
      return new vscode.Range(startLine, 0, endLine + 1, 0);
    }
    if (startLine > 0) {
      return new vscode.Range(
        startLine - 1,
        document.lineAt(startLine - 1).text.length,
        endLine,
        document.lineAt(endLine).text.length,
      );
    }
    return new vscode.Range(startLine, 0, endLine, document.lineAt(endLine).text.length);
  }

  async function deleteCell(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !isJsLang(editor.document)) return;
    const cell = cellAtLine(editor.document, editor.selection.active.line);
    if (!cell) return;
    const startLine = cell.range.start.line;
    const range = fullLineRange(editor.document, startLine, cell.range.end.line);
    if (!(await editor.edit((eb) => eb.delete(range)))) return;
    const line = Math.min(startLine, Math.max(0, editor.document.lineCount - 1));
    const position = new vscode.Position(line, 0);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position));
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

  // `denote.cell.*` acts on cells in the source editor; `denote.interactive.*` on the window.
  // Pre-0.2 command IDs stay registered as aliases so existing keybindings/settings keep working.
  type CommandHandler = Parameters<typeof vscode.commands.registerCommand>[1];
  function register(id: string, handler: CommandHandler, ...aliases: string[]): void {
    for (const command of [id, ...aliases]) {
      context.subscriptions.push(vscode.commands.registerCommand(command, handler));
    }
  }

  register(
    "denote.cell.run",
    (uri?: vscode.Uri, startLine?: number) => runCell(uri, startLine),
    "denote.runCell",
  );

  register(
    "denote.cell.runAndAdvance",
    async () => {
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
    },
    "denote.runCellAndAdvance",
  );

  register(
    "denote.cell.runSelection",
    async () => {
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
    },
    "denote.execSelectionInInteractive",
  );

  register(
    "denote.cell.runAll",
    async (uri?: vscode.Uri) => {
      const document = documentFor(uri);
      if (document) await runCells(document, () => true);
    },
    "denote.runAllCells",
  );

  register(
    "denote.cell.runAbove",
    async (uri?: vscode.Uri, startLine?: number) => {
      const document = documentFor(uri);
      if (document) await runCells(document, (cell) => cell.range.start.line < (startLine ?? 0));
    },
    "denote.runAllCellsAbove",
  );

  register(
    "denote.cell.runBelow",
    async (uri?: vscode.Uri, startLine?: number) => {
      const document = documentFor(uri);
      if (document) await runCells(document, (cell) => cell.range.start.line >= (startLine ?? 0));
    },
    "denote.runAllCellsBelow",
  );

  register(
    "denote.cell.insertAbove",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isJsLang(editor.document)) return;
      const line = editor.selection.active.line;
      editor.edit((eb) => eb.insert(new vscode.Position(line, 0), `${getConfig().defaultCellMarker}\n\n`));
    },
    "denote.insertCellAbove",
  );

  register(
    "denote.cell.insertBelow",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isJsLang(editor.document)) return;
      const line = editor.selection.active.line;
      editor.edit((eb) =>
        eb.insert(new vscode.Position(line + 1, 0), `${getConfig().defaultCellMarker}\n\n`),
      );
    },
    "denote.insertCellBelow",
  );

  register("denote.cell.delete", deleteCell);

  register("denote.cell.next", () => focusCell("next"));

  register("denote.cell.previous", () => focusCell("previous"));

  register("denote.cell.first", () => focusCell("first"));

  register("denote.cell.last", () => focusCell("last"));

  register("denote.interactive.clear", clearAllCells, "denote.clearAllCells");

  register(
    "denote.interactive.restart",
    async () => {
      const notebook = activeInteractiveNotebook();
      if (notebook) await controller.restart(notebook);
    },
    "denote.restartKernel",
  );

  register(
    "denote.interactive.save",
    () => exportInteractiveWindow(true),
    "denote.exportAsNotebook",
  );

  register("denote.interactive.export", () => exportInteractiveWindow(false), "denote.export");

  register(
    "denote.interactive.expandAll",
    () => vscode.commands.executeCommand("notebook.cell.expandAllCellInputs"),
    "denote.expandAllCells",
  );

  register(
    "denote.interactive.collapseAll",
    () => vscode.commands.executeCommand("notebook.cell.collapseAllCellInputs"),
    "denote.collapseAllCells",
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
