import * as vscode from "vscode";

export type DecorateCellsMode = "currentCell" | "allCells" | "none";
export type CreationMode = "perFile" | "single" | "multiple";
export type ViewColumnMode = "beside" | "active" | "secondGroup";

export interface DenoteConfig {
  denoPath: string;
  defaultCellMarker: string;
  codeRegex: RegExp;
  markdownRegex: RegExp;
  decorateCells: DecorateCellsMode;
  codeLensEnable: boolean;
  codeLensCommands: string[];
  creationMode: CreationMode;
  viewColumn: ViewColumnMode;
  trace: boolean;
}

const FALLBACK_CODE_REGEX = "^//\\s*%%";
const FALLBACK_MARKDOWN_REGEX = "^//\\s*%%\\s*\\[markdown\\]";

function compile(value: string, fallback: string): RegExp {
  try {
    return new RegExp(value || fallback);
  } catch {
    return new RegExp(fallback);
  }
}

function readConfig(): DenoteConfig {
  const config = vscode.workspace.getConfiguration("denote");
  const commands = config.get<string>("codeLens.commands", "");
  return {
    denoPath: config.get<string>("denoPath", ""),
    defaultCellMarker: config.get<string>("defaultCellMarker", "// %%"),
    codeRegex: compile(config.get<string>("cellMarker.codeRegex", ""), FALLBACK_CODE_REGEX),
    markdownRegex: compile(config.get<string>("cellMarker.markdownRegex", ""), FALLBACK_MARKDOWN_REGEX),
    decorateCells: config.get<DecorateCellsMode>("cellMarker.decorateCells", "currentCell"),
    codeLensEnable: config.get<boolean>("codeLens.enable", true),
    codeLensCommands: commands
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean),
    creationMode: config.get<CreationMode>("interactiveWindow.creationMode", "perFile"),
    viewColumn: config.get<ViewColumnMode>("interactiveWindow.viewColumn", "beside"),
    trace: config.get<boolean>("trace", false),
  };
}

let cached = readConfig();
const emitter = new vscode.EventEmitter<void>();
export const onDidChangeConfig = emitter.event;

// Call once during activation; keeps a cached config and refreshes it on change.
export function initConfig(context: vscode.ExtensionContext): void {
  cached = readConfig();
  context.subscriptions.push(
    emitter,
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("denote")) {
        cached = readConfig();
        emitter.fire();
      }
    }),
  );
}

export function getConfig(): DenoteConfig {
  return cached;
}
