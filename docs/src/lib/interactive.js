// Utilities for the interactive code demo (cell detection, ANSI rendering).

const CELL_MARKER = /^\s*\/\/\s*%%/;

export function isCellMarker(text) {
  return CELL_MARKER.test(text);
}

// Splits highlighted lines into cells (matching the extension's `// %%` markers) and pairs each
// cell with its canned output. Each cell keeps the highlighted HTML of its first code line.
export function buildCells(lines, outputs = []) {
  const cells = [];
  let current = null;
  for (let i = 0; i < lines.length; i++) {
    if (isCellMarker(lines[i].text)) {
      current = { start: i, code: [], output: outputs[cells.length] ?? { blocks: [] } };
      cells.push(current);
      continue;
    }
    if (current) current.code.push(lines[i]);
  }
  for (const cell of cells) {
    const first = cell.code.find((line) => line.text.trim().length > 0);
    cell.header = first ? first.text.trim() : "";
    cell.headerHtml = first ? first.html : "";
  }
  return cells;
}

const ANSI_COLORS = {
  30: "#45475a", 31: "#f38ba8", 32: "#a6e3a1", 33: "#f9e2af",
  34: "#89b4fa", 35: "#cba6f7", 36: "#94e2d5", 37: "#bac2de",
  90: "#585b70", 91: "#f38ba8", 92: "#a6e3a1", 93: "#f9e2af",
  94: "#89b4fa", 95: "#cba6f7", 96: "#94e2d5", 97: "#cdd6f4",
};

function escapeHtml(value) {
  return value.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
}

// Minimal ANSI SGR support (colours) so streamed output looks like the interactive window.
export function ansiToHtml(text) {
  let html = "";
  let color = null;
  for (const part of text.split(/(\u001b\[\d+m)/)) {
    const match = part.match(/^\u001b\[(\d+)m$/);
    if (match) {
      color = ANSI_COLORS[match[1]] ?? null;
      continue;
    }
    if (!part) continue;
    const escaped = escapeHtml(part);
    html += color ? `<span style="color:${color}">${escaped}</span>` : escaped;
  }
  return html;
}

// Copy text to the clipboard, falling back to execCommand when the async API is unavailable.
export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) {
    /* fall through */
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch (e) {
    return false;
  }
}

// Tiny runtime shell highlighter (Catppuccin Mocha) so the dynamic install commands stay coloured.
const SHELL = {
  comment: "#6C7086",
  command: "#A6E3A1",
  flag: "#F9E2AF",
  url: "#89B4FA",
  string: "#A6E3A1",
};

function shellToken(token, isCommand) {
  const escaped = escapeHtml(token);
  const colour = isCommand
    ? SHELL.command
    : /^-{1,2}[\w-]+$/.test(token)
      ? SHELL.flag
      : /^https?:\/\//.test(token)
        ? SHELL.url
        : /^["'].*["']$/.test(token)
          ? SHELL.string
          : null;
  return colour ? `<span style="color:${colour}">${escaped}</span>` : escaped;
}

function shellLineHtml(line) {
  if (/^\s*#/.test(line)) {
    return `<span style="color:${SHELL.comment}">${escapeHtml(line)}</span>`;
  }
  const lead = line.match(/^\s*/)[0];
  let html = escapeHtml(lead);
  let isCommand = true;
  const tokenRe = /(\S+)(\s*)/g;
  let match;
  while ((match = tokenRe.exec(line.slice(lead.length)))) {
    html += shellToken(match[1], isCommand) + escapeHtml(match[2]);
    isCommand = false;
  }
  return html;
}

export function highlightShell(text) {
  return text.split("\n").map((line) => ({ html: shellLineHtml(line), text: line }));
}
