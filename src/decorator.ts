import * as vscode from "vscode";
import { generateCellRangesFromDocument } from "./cellMatcher";
import { getConfig, onDidChangeConfig } from "./config";

// In-editor cell borders, mirroring the Jupyter extension's Decorator.
// The current cell gets an active border, other cells an inactive top border.
const JS_LANGUAGES = ["javascript", "typescript", "javascriptreact", "typescriptreact"];

export class Decorator implements vscode.Disposable {
  private currentCellTop: vscode.TextEditorDecorationType;
  private currentCellBottom: vscode.TextEditorDecorationType;
  private otherCellsTop: vscode.TextEditorDecorationType;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposables: vscode.Disposable[] = [];

  constructor() {
    this.currentCellTop = vscode.window.createTextEditorDecorationType({
      borderColor: new vscode.ThemeColor("interactive.activeCodeBorder"),
      borderWidth: "2px 0px 0px 0px",
      borderStyle: "solid",
      isWholeLine: true,
    });
    this.currentCellBottom = vscode.window.createTextEditorDecorationType({
      borderColor: new vscode.ThemeColor("interactive.activeCodeBorder"),
      borderWidth: "0px 0px 1px 0px",
      borderStyle: "solid",
      isWholeLine: true,
    });
    this.otherCellsTop = vscode.window.createTextEditorDecorationType({
      borderColor: new vscode.ThemeColor("interactive.inactiveCodeBorder"),
      borderWidth: "2px 0px 0px 0px",
      borderStyle: "solid",
      isWholeLine: true,
    });

    this.disposables.push(
      this.currentCellTop,
      this.currentCellBottom,
      this.otherCellsTop,
      onDidChangeConfig(() => this.scheduleUpdate()),
      vscode.window.onDidChangeActiveTextEditor(() => this.scheduleUpdate()),
      vscode.window.onDidChangeTextEditorSelection(() => this.scheduleUpdate()),
      vscode.workspace.onDidChangeTextDocument((e) => {
        const editor = vscode.window.activeTextEditor;
        if (editor && e.document === editor.document) this.scheduleUpdate();
      }),
    );
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
    if (this.timer) clearTimeout(this.timer);
  }

  private scheduleUpdate() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.update(), 100);
  }

  private update() {
    this.timer = undefined;
    const editor = vscode.window.activeTextEditor;
    if (!editor || !JS_LANGUAGES.includes(editor.document.languageId)) return;

    const config = getConfig();
    if (config.decorateCells === "none") {
      this.clear(editor);
      return;
    }

    const cells = generateCellRangesFromDocument(
      editor.document.lineCount,
      (i) => editor.document.lineAt(i).text,
      config,
    );

    if (config.decorateCells === "allCells") {
      editor.setDecorations(this.otherCellsTop, cells.map((c) => rangeAt(c.range.start.line)));
      editor.setDecorations(this.currentCellTop, []);
      editor.setDecorations(this.currentCellBottom, []);
      return;
    }

    const current = cells.find(
      (c) => c.range.start.line <= editor.selection.active.line && editor.selection.active.line <= c.range.end.line,
    );
    editor.setDecorations(this.currentCellTop, current ? [rangeAt(current.range.start.line)] : []);
    editor.setDecorations(this.currentCellBottom, current ? [rangeAt(current.range.end.line)] : []);
    editor.setDecorations(
      this.otherCellsTop,
      cells.filter((c) => !current || c.range.start.line !== current.range.start.line).map((c) => rangeAt(c.range.start.line)),
    );
  }

  private clear(editor: vscode.TextEditor) {
    editor.setDecorations(this.currentCellTop, []);
    editor.setDecorations(this.currentCellBottom, []);
    editor.setDecorations(this.otherCellsTop, []);
  }
}

function rangeAt(line: number): vscode.Range {
  return new vscode.Range(line, 0, line, 0);
}
