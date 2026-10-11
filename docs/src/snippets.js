// All code samples shown on the site. Kept as line arrays so backticks and ${} stay literal.
const join = (lines) => lines.join("\n");

export const markers = join([
  "type X = number | string;",
  "",
  "// %%",
  "let y: X = 0;",
  "for (let i = 0; i < 10; i++) y += i;",
  'console.log("y = " + y);',
  "",
  "// %% [markdown]",
  "# Notes",
  "Cells can be **markdown** too.",
]);

export const runCell = join([
  "// %%",
  "const greeting = \"hello from a cell\";",
  "console.log(greeting);",
]);

export const state = join([
  "// %%",
  "const shared = 41;",
  "",
  "// %%",
  "console.log(\"shared + 1 =\", shared + 1); // 42",
]);

export const errors = join([
  "// %%",
  "throw new Error(\"something went wrong\");",
  "",
  "// %%",
  'console.log("later cells still run");',
]);

export const ansi = join([
  "// %%",
  'console.log("\\x1b[31mred\\x1b[0m \\x1b[32mgreen\\x1b[0m \\x1b[34mblue\\x1b[0m");',
]);

export const progress = join([
  "// %%",
  "const width = 40;",
  "let progress = 0;",
  'const id = "progress";',
  "",
  'await Deno.jupyter.broadcast("display_data", {',
  '  data: { "text/plain": "[" + "=".repeat(width) + "] 0%" },',
  "  metadata: {},",
  "  transient: { display_id: id },",
  "});",
  "",
  "const timer = setInterval(async () => {",
  "  progress = Math.min(100, progress + Math.random() * 8);",
  "  const filled = Math.round((progress / 100) * width);",
  '  const bar = "█".repeat(filled) + "=".repeat(width - filled);',
  '  await Deno.jupyter.broadcast("update_display_data", {',
  '    data: { "text/plain": "[" + bar + "] " + Math.floor(progress) + "%" },',
  "    metadata: {},",
  "    transient: { display_id: id },",
  "  });",
  "  if (progress >= 100) clearInterval(timer);",
  "}, 100);",
]);

export const image = join([
  "// %%",
  'Deno.jupyter.image("./chart.png");',
]);

export const imageB64 = join([
  "// %%",
  "const bytes = await Deno.readFile(\"./chart.png\");",
  "let bin = \"\";",
  "for (const b of bytes) bin += String.fromCharCode(b);",
  "",
  'await Deno.jupyter.display({ "image/png": btoa(bin) }, { raw: true });',
]);

export const html = join([
  "// %%",
  "Deno.jupyter.html`<svg width=\"240\" height=\"80\">",
  '  <rect width="240" height="80" fill="#1f6feb"/>',
  '  <text x="12" y="48" fill="white" font-size="24">Hello IW</text>',
  "</svg>`;",
]);

export const markdown = join([
  "// %%",
  "Deno.jupyter.md`## Hello from **Deno**",
  "- renders markdown",
  "- in the output`;",
]);

export const imports = join([
  "// %%",
  'import { add } from "./math.ts";',
  'console.log("2 + 3 =", add(2, 3));',
]);

export const mathModule = join([
  "export function add(a: number, b: number): number {",
  "  return a + b;",
  "}",
]);

export const settings = join([
  "{",
  '  "denote.denoPath": "/home/me/.deno/bin/deno",',
  '  "denote.interactiveWindow.creationMode": "perFile",',
  '  "denote.cellMarker.decorateCells": "currentCell",',
  '  "denote.codeLens.enable": true',
  "}",
]);

export const install = join([
  "# install the Deno Jupyter kernel once",
  "deno jupyter --install",
  "",
  "# install the extension from a .vsix release",
  "code --install-extension denote-<version>.vsix",
]);
