# Denote documentation site

Static site (Svelte + Rollup) documenting the Denote VS Code extension. It is served with
GitHub Pages via the [`Docs` workflow](../.github/workflows/pages.yml), which builds this folder
and deploys it as the Pages artifact.

## Develop

```sh
cd docs
npm install
npm run dev     # dev server on http://localhost:8086 with live reload
# or
npm run build   # production bundle into build/
```

`npm run dev` (Rollup watch) serves `docs/`, regenerates the derived sources on change
(`scripts/{icons,release,highlight}.mjs`), and reloads the browser over SSE after each rebuild.
Set `DOCS_PORT` to change the port (default 8086).

Generated and git-ignored: `build/`, `node_modules/`, `src/highlighted.js`, `src/icons.js`,
`src/release.js`.

## Publishing

Set **Settings → Pages → Build and deployment → Source: GitHub Actions**. Pushing to `main`
that touches `docs/**` (or running the workflow manually) rebuilds and deploys the site.

## Structure

- `src/App.svelte` — page layout and content sections.
- `src/lib/Code.svelte` — read-only code block with a copy button.
- `src/lib/InteractiveCode.svelte` — code with CodeLens buttons and a mock interactive-window
  terminal (Clear All + Deno kernel) that shows each cell's canned output.
- `src/lib/ProgressBar.svelte` — animated progress-bar output.
- `src/lib/Icon.svelte` — renders the real VS Code codicons (`icons/*.svg`).
- `src/lib/interactive.js` — cell detection, ANSI rendering and clipboard helpers.
- `src/lib/releaseStore.js` — latest GitHub release (seeded at build, refreshed at runtime).
- `src/snippets.js` — every code sample; `src/outputs.js` — per-cell demo outputs.
- `scripts/highlight.mjs` — Shiki (Catppuccin Mocha) highlighter → `src/highlighted.js`.
- `scripts/icons.mjs` — inlines `icons/*.svg` → `src/icons.js`.
- `scripts/release.mjs` — resolves the latest GitHub release → `src/release.js`.
- `icons/*.svg` — codicons from [microsoft/vscode-codicons](https://github.com/microsoft/vscode-codicons).
- `app.css` — Catppuccin Mocha theme with the `--cr1m` accent, square borders.
