import * as vscode from "vscode";
import { generateCellRangesFromDocument } from "./cellMatcher";
import { getConfig, onDidChangeConfig } from "./config";

// Provides "Run Cell" / "Run Above" / "Run All Cells" / "Run Below" CodeLenses.
// Which lenses appear is configurable via `denote.codeLens.*`.

const JS_LANGS = ["javascript", "typescript", "javascriptreact", "typescriptreact"];

export class DenoteCodeLensProvider implements vscode.CodeLensProvider {
  private didChange = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses: vscode.Event<void> = this.didChange.event;
  private disposables: vscode.Disposable[] = [];

  constructor() {
    this.disposables.push(
      this.didChange,
      onDidChangeConfig(() => this.didChange.fire()),
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (JS_LANGS.includes(e.document.languageId)) this.didChange.fire();
      }),
    );
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const config = getConfig();
    if (!config.codeLensEnable || !JS_LANGS.includes(document.languageId)) return [];

    const cells = generateCellRangesFromDocument(
      document.lineCount,
      (i) => document.lineAt(i).text,
      config,
    );
    if (cells.length === 0) return [];

    const lenses: vscode.CodeLens[] = [];
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      const range = new vscode.Range(
        cell.range.start.line,
        0,
        cell.range.end.line,
        cell.range.end.character,
      );
      const isFirst = i === 0;
      for (const command of config.codeLensCommands) {
        const lens = createLens(command, document.uri, cell.range.start.line, isFirst, range);
        if (lens) lenses.push(lens);
      }
    }
    return lenses;
  }
}

function createLens(
  command: string,
  uri: vscode.Uri,
  line: number,
  isFirst: boolean,
  range: vscode.Range,
): vscode.CodeLens | undefined {
  switch (command) {
    case "denote.runCell":
      return new vscode.CodeLens(range, { title: "$(play) Run Cell", command, arguments: [uri, line] });
    case "denote.runAllCells":
      return isFirst
        ? new vscode.CodeLens(range, { title: "$(run-all) Run All Cells", command, arguments: [uri] })
        : undefined;
    case "denote.runAllCellsAbove":
      return new vscode.CodeLens(range, {
        title: isFirst ? "$(run-all) Run All Cells" : "$(arrow-up) Run Above",
        command: isFirst ? "denote.runAllCells" : command,
        arguments: isFirst ? [uri] : [uri, line],
      });
    case "denote.runAllCellsBelow":
      return new vscode.CodeLens(range, { title: "$(arrow-down) Run Below", command, arguments: [uri, line] });
    default:
      return undefined;
  }
}
