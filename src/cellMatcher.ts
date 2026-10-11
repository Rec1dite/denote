// Cell marker detection, mirroring the Jupyter extension's CellMatcher.
// Regexes and the default marker are configurable via `denote.cellMarker.*`.

export interface CellMarkerOptions {
  codeRegex: RegExp;
  markdownRegex: RegExp;
  defaultCellMarker: string;
}

export interface ICellRange {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  cellType: "code" | "markdown";
}

export function isMarkdownCell(text: string, options: CellMarkerOptions): boolean {
  return options.markdownRegex.test(text.trim());
}

export function isCellLine(text: string, options: CellMarkerOptions): boolean {
  const trimmed = text.trim();
  return (
    options.codeRegex.test(trimmed) ||
    options.markdownRegex.test(trimmed) ||
    trimmed === options.defaultCellMarker
  );
}

export function getCellType(text: string, options: CellMarkerOptions): "code" | "markdown" {
  return isMarkdownCell(text, options) ? "markdown" : "code";
}

// Markdown cells are `/* ... */` block comments; the terminator is a lone `*/`.
export function isMarkdownTerminator(text: string): boolean {
  return /^\s*\*\/\s*$/.test(text);
}

export function getFirstMarker(code: string, options: CellMarkerOptions): string | undefined {
  const first = code.split("\n")[0];
  return first && isCellLine(first, options) ? first : undefined;
}

export function stripFirstMarker(code: string, options: CellMarkerOptions): string {
  const lines = code.split("\n");
  if (lines.length > 0 && isCellLine(lines[0], options)) {
    return lines.slice(1).join("\n");
  }
  return code;
}

// Drop the trailing `*/` that closes a markdown cell.
export function stripMarkdownTerminator(code: string): string {
  const lines = code.split("\n");
  if (lines.length > 0 && isMarkdownTerminator(lines[lines.length - 1])) {
    return lines.slice(0, -1).join("\n");
  }
  return code;
}

export function generateCellRangesFromDocument(
  lineCount: number,
  lineAt: (i: number) => string,
  options: CellMarkerOptions,
): ICellRange[] {
  const cells: ICellRange[] = [];
  let closed = false;
  for (let i = 0; i < lineCount; i++) {
    const text = lineAt(i);
    if (isCellLine(text, options)) {
      if (cells.length > 0 && !closed) {
        const prev = cells[cells.length - 1];
        prev.range.end = { line: i - 1, character: lineAt(i - 1).length };
      }
      cells.push({
        range: {
          start: { line: i, character: 0 },
          end: { line: i, character: text.length },
        },
        cellType: getCellType(text, options),
      });
      closed = false;
      continue;
    }
    if (cells.length > 0 && !closed) {
      const current = cells[cells.length - 1];
      if (current.cellType === "markdown" && isMarkdownTerminator(text)) {
        current.range.end = { line: i, character: text.length };
        closed = true;
      }
    }
  }
  if (cells.length > 0 && !closed) {
    const last = cells[cells.length - 1];
    last.range.end = { line: lineCount - 1, character: lineAt(lineCount - 1).length };
  }
  return cells;
}
