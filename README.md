<p align="center">
  <img src="https://raw.githubusercontent.com/Rec1dite/denote/refs/heads/master/docs/denoteLogo.png" alt="Denote" width="160" />
</p>

# Denote

An **interactive window for JavaScript / TypeScript** in VSCode, powered directly by the
[Deno built-in Jupyter kernel](https://docs.deno.com/runtime/reference/cli/jupyter/)
(`deno jupyter`) — no `ms-toolsai.jupyter` dependency.

Denote is a derivative of [`vscode-jupyter`](https://github.com/microsoft/vscode-jupyter) that
swaps the Python kernel for Deno's, and drives the kernel itself.

## Features

- `// %%` code cells and `/* %% [markdown] … */` markdown cells, with in-editor cell borders.
- CodeLens: **Run Cell**, **Run Above**, **Run All Cells**, **Run Below**.
- `Ctrl+Enter` / `Shift+Enter` to run the current cell (and advance).
- One interactive window per source file, reused across runs; kernel state persists across cells.
- Run Selection/Line in the interactive window.
- Rich output: ANSI colours, in-place progress bars (`display_id`), images (PNG/JPEG/GIF/SVG),
  HTML and Markdown.
- Interactive-window toolbar: **Interrupt**, **Clear All**, **Restart**, **Save** (`.ipynb`),
  **Export** (`// %%` source), **Expand**, **Collapse**.
- Relative imports work — the kernel runs with the owning file's directory as its cwd.

## Requirements

- VSCode 1.72+
- [Deno](https://deno.com/) on your `PATH` (or the registered `deno` Jupyter kernelspec).
  Install the kernel once with `deno jupyter --install`.

## Install

Install from a `.vsix` release:

```sh
code --install-extension denote-<version>.vsix
```

## Usage

Add `// %%` markers to split a file into cells, then run them from the CodeLens or
`Ctrl+Enter`. See the [documentation site](docs/) for examples of every capability.

## Development

```sh
npm install
npm run compile
# F5 in VSCode to launch the Extension Development Host
```

## Packaging

```sh
npm run package   # produces denote-<version>.vsix
```


## Known limitations / TODO

- **jupyter variables** is not provided: the deno kernel does not expose its repl scope to
  clients over the jupyter protocol (no `variables`/`inspect` support), so there is nothing to
  populate a variables view with. the other jupyter interactive-window actions are covered.
- deno lsp `semantictokens/full` noise for iw virtual cell uris (upstream vs code behaviour).
- `mxsdev.typescript-explorer` crashes its ts plugin on notebook cell uris (third-party bug,
  unrelated to denote).
