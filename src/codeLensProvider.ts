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

// Pre-0.2 CodeLens command IDs, mapped to their `denote.cell.*` equivalents.
const LEGACY_LENS_COMMANDS: Record<string, string> = {
  "denote.runCell": "denote.cell.run",
  "denote.runAllCells": "denote.cell.runAll",
  "denote.runAllCellsAbove": "denote.cell.runAbove",
  "denote.runAllCellsBelow": "denote.cell.runBelow",
};

function createLens(
  command: string,
  uri: vscode.Uri,
  line: number,
  isFirst: boolean,
  range: vscode.Range,
): vscode.CodeLens | undefined {
  const id = LEGACY_LENS_COMMANDS[command] ?? command;
  switch (id) {
    case "denote.cell.run":
      return new vscode.CodeLens(range, { title: "$(play) Run Cell", command: id, arguments: [uri, line] });
    case "denote.cell.runAll":
      return isFirst
        ? new vscode.CodeLens(range, { title: "$(run-all) Run All Cells", command: id, arguments: [uri] })
        : undefined;
    case "denote.cell.runAbove":
      return new vscode.CodeLens(range, {
        title: isFirst ? "$(run-all) Run All Cells" : "$(arrow-up) Run Above",
        command: isFirst ? "denote.cell.runAll" : id,
        arguments: isFirst ? [uri] : [uri, line],
      });
    case "denote.cell.runBelow":
      return new vscode.CodeLens(range, { title: "$(arrow-down) Run Below", command: id, arguments: [uri, line] });
    default:
      return undefined;
  }
}
