import * as vscode from "vscode";
import * as path from "path";
import * as crypto from "crypto";
import { DenoKernelController } from "./notebookController";

export interface IInteractiveWindow {
  notebook: vscode.NotebookDocument;
  inputUri: vscode.Uri;
  owner: vscode.Uri;
}

// Cells are inserted before the interactive input, which is always the last cell.
function appendIndex(notebook: vscode.NotebookDocument): number {
  return Math.max(0, notebook.cellCount - 1);
}

// Reuses one interactive window per source file, mirroring vscode-jupyter's InteractiveWindowProvider.
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

  async getOrCreate(owner: vscode.Uri): Promise<IInteractiveWindow> {
    const key = owner.toString();
    const existing = this.windows.get(key);
    if (existing) {
      this.log("reusing interactive window", existing.notebook.uri.toString());
      return existing;
    }

    const preferredControllerId = `${this.extensionId}/${this.controller.id}`;
    this.log("opening interactive window, preferred controller:", preferredControllerId);
    const result = (await vscode.commands.executeCommand(
      "interactive.open",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
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

  // Strip the cell marker, insert the cell at the REPL append index, and return it.
  async addCode(
    code: string,
    owner: vscode.Uri,
    line: number,
    languageId: string,
    isMarkdown = false,
  ): Promise<vscode.NotebookCell> {
    const iw = await this.getOrCreate(owner);
    const index = appendIndex(iw.notebook);

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
