import * as vscode from "vscode";
import * as path from "path";
import * as crypto from "crypto";
import { DenoKernelController } from "./notebookController";
import { getConfig } from "./config";

export interface IInteractiveWindow {
  notebook: vscode.NotebookDocument;
  inputUri: vscode.Uri;
  owner: vscode.Uri;
}

// Cells are appended after existing ones; if the input cell is part of the document, insert before it.
function appendIndex(iw: IInteractiveWindow): number {
  const cells = iw.notebook.getCells();
  const last = cells[cells.length - 1];
  if (last && last.document.uri.toString() === iw.inputUri.toString()) {
    return cells.length - 1;
  }
  return cells.length;
}

function viewColumn(): vscode.ViewColumn {
  switch (getConfig().viewColumn) {
    case "active":
      return vscode.ViewColumn.Active;
    case "secondGroup":
      return vscode.ViewColumn.Two;
    default:
      return vscode.ViewColumn.Beside;
  }
}

// Reuses interactive windows according to `denote.interactiveWindow.creationMode`,
// mirroring vscode-jupyter's InteractiveWindowProvider.
export class InteractiveWindowProvider implements vscode.Disposable {
  private readonly windows = new Map<string, IInteractiveWindow>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly controller: DenoKernelController,
    private readonly extensionId: string,
    private readonly log: (...args: unknown[]) => void,
  ) {
    this.disposables.push(
      vscode.workspace.onDidCloseNotebookDocument((doc) => {
        for (const [key, iw] of this.windows) {
          if (iw.notebook.uri.toString() === doc.uri.toString()) {
            this.log("closing tracked interactive window for", key);
            this.windows.delete(key);
            break;
          }
        }
      }),
    );
  }

  // `perFile` keys by the source file, `single` shares one key, `multiple` always gets a new key.
  private keyFor(owner: vscode.Uri): string {
    switch (getConfig().creationMode) {
      case "single":
        return "single";
      case "multiple":
        return `${owner.toString()}#${crypto.randomUUID()}`;
      default:
        return owner.toString();
    }
  }

  async getOrCreate(owner: vscode.Uri): Promise<IInteractiveWindow> {
    const key = this.keyFor(owner);
    const existing = this.windows.get(key);
    if (existing) {
      this.log("reusing interactive window", existing.notebook.uri.toString());
      return existing;
    }

    const preferredControllerId = `${this.extensionId}/${this.controller.id}`;
    this.log("opening interactive window, preferred controller:", preferredControllerId);
    const result = (await vscode.commands.executeCommand(
      "interactive.open",
      { viewColumn: viewColumn(), preserveFocus: true },
      undefined,
      preferredControllerId,
      path.basename(owner.fsPath) || "Deno",
    )) as
      | { notebookUri: vscode.Uri; inputUri: vscode.Uri; notebookEditor?: vscode.NotebookEditor }
      | undefined;

    const notebook =
      result?.notebookEditor?.notebook ??
      vscode.workspace.notebookDocuments.find(
        (doc) => result?.notebookUri && doc.uri.toString() === result.notebookUri.toString(),
      );
    if (!notebook || !result) {
      throw new Error("interactive.open did not return an interactive window");
    }

    const iw: IInteractiveWindow = { notebook, inputUri: result.inputUri, owner };
    this.windows.set(key, iw);
    this.controller.prefer(notebook);
    return iw;
  }

  // Insert the cell at the append index and return it.
  async addCode(
    code: string,
    owner: vscode.Uri,
    line: number,
    languageId: string,
    isMarkdown = false,
  ): Promise<vscode.NotebookCell> {
    const iw = await this.getOrCreate(owner);
    const index = appendIndex(iw);

    const cellData = new vscode.NotebookCellData(
      isMarkdown ? vscode.NotebookCellKind.Markup : vscode.NotebookCellKind.Code,
      code,
      isMarkdown ? "markdown" : languageId,
    );
    cellData.metadata = {
      interactive: {
        uristring: owner.toString(),
        lineIndex: line,
        originalSource: code,
      },
      id: crypto.randomUUID(),
    };

    const edit = new vscode.WorkspaceEdit();
    edit.set(iw.notebook.uri, [vscode.NotebookEdit.insertCells(index, [cellData])]);
    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) {
      throw new Error("failed to insert cell into interactive window");
    }
    return iw.notebook.cellAt(index);
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}
