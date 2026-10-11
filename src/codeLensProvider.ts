import * as vscode from "vscode";
import { generateCellRangesFromDocument, isCellLine } from "./cellMatcher";

// Provides "Run Cell" and "Run Above/Below" CodeLenses in JS/TS files
// Mirrors Jupyter extension's DataScienceCodeLensProvider + CodeLensFactory

const JS_LANGS = ["javascript", "typescript", "javascriptreact", "typescriptreact"];

export class DenoteCodeLensProvider implements vscode.CodeLensProvider {
  private didChange = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses: vscode.Event<void> = this.didChange.event;

  constructor() {
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (JS_LANGS.includes(e.document.languageId)) {
        this.didChange.fire();
      }
    });
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (!JS_LANGS.includes(document.languageId)) return [];

    const cells = generateCellRangesFromDocument(
      document.lineCount,
      (i) => document.lineAt(i).text,
    );

    if (cells.length === 0) return [];

    const lenses: vscode.CodeLens[] = [];

    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      const range = new vscode.Range(
        cell.range.start.line, 0,
        cell.range.end.line, cell.range.end.character,
      );

      // "Run Cell" lens on every cell
      lenses.push(
        new vscode.CodeLens(range, {
          title: "$(play) Run Cell",
          command: "denote.runCell",
          arguments: [document.uri, cell.range.start.line],
        }),
      );

      // "Run Above" on non-first cells, else "Run All Cells" on the first cell
      if (i > 0) {
        lenses.push(
          new vscode.CodeLens(range, {
            title: "$(arrow-up) Run Above",
            command: "denote.runAllCellsAbove",
            arguments: [document.uri, cell.range.start.line],
          }),
        );
      } else {
        lenses.push(
          new vscode.CodeLens(range, {
            title: "$(run-all) Run All Cells",
            command: "denote.runAllCells",
            arguments: [document.uri],
          }),
        );
      }

      // "Run Below" on every cell
      lenses.push(
        new vscode.CodeLens(range, {
          title: "$(arrow-down) Run Below",
          command: "denote.runAllCellsBelow",
          arguments: [document.uri, cell.range.start.line],
        }),
      );
    }

    return lenses;
  }
}
