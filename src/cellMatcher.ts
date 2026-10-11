// Cell marker detection - mirrors Jupyter extension's CellMatcher
// Detects `// %%` and `// %% [markdown]` cell boundaries

export const DEFAULT_CELL_MARKER = "// %%";
export const CODE_CELL_REGEX = /^\/\/\s*%%/;
export const MARKDOWN_CELL_REGEX = /^\/\/\s*%%\s*\[markdown\]/;

export interface ICellRange {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  cellType: "code" | "markdown";
}

export function isCellLine(text: string): boolean {
  return CODE_CELL_REGEX.test(text.trim());
}

export function isMarkdownCell(text: string): boolean {
  return MARKDOWN_CELL_REGEX.test(text.trim());
}

export function getCellType(text: string): "code" | "markdown" {
  return isMarkdownCell(text) ? "markdown" : "code";
}

export function getFirstMarker(code: string): string | undefined {
  const lines = code.split("\n");
  if (lines.length > 0 && isCellLine(lines[0])) {
    return lines[0];
  }
  return undefined;
}

export function stripFirstMarker(code: string): string {
  const lines = code.split("\n");
  if (lines.length > 0 && isCellLine(lines[0])) {
    return lines.slice(1).join("\n");
  }
  return code;
}

export function generateCellRangesFromDocument(
  lineCount: number,
  lineAt: (i: number) => string,
): ICellRange[] {
  const cells: ICellRange[] = [];
  for (let i = 0; i < lineCount; i++) {
    const text = lineAt(i);
    if (isCellLine(text)) {
      if (cells.length > 0) {
        const prev = cells[cells.length - 1];
        prev.range.end = { line: i - 1, character: lineAt(i - 1).length };
      }
      cells.push({
        range: {
          start: { line: i, character: 0 },
          end: { line: i, character: text.length },
        },
        cellType: getCellType(text),
      });
    }
  }
  if (cells.length > 0 && lineCount > 0) {
    const last = cells[cells.length - 1];
    last.range.end = { line: lineCount - 1, character: lineAt(lineCount - 1).length };
  }
  return cells;
}
