<script>
  import Section from "./lib/Section.svelte";
  import Code from "./lib/Code.svelte";
  import InteractiveCode from "./lib/InteractiveCode.svelte";
  import Icon from "./lib/Icon.svelte";
  import Callout from "./lib/Callout.svelte";
  import { onMount } from "svelte";
  import { latestRelease, refreshLatestRelease, installCommands } from "./lib/releaseStore.js";
  import { highlightShell } from "./lib/interactive.js";
  import * as s from "./snippets.js";
  import h from "./highlighted.js";
  import { outputs as o } from "./outputs.js";

  onMount(refreshLatestRelease);

  $: installLines = highlightShell(installCommands($latestRelease));

  const nav = [
    { id: "demo", label: "Demo" },
    { id: "install", label: "Install" },
    { id: "markers", label: "Cell markers" },
    { id: "running", label: "Running cells" },
    { id: "commands", label: "Commands & keys" },
    { id: "interactive", label: "The interactive window" },
    { id: "output", label: "Rich output" },
    { id: "errors", label: "Errors & recovery" },
    { id: "toolbar", label: "Toolbar actions" },
    { id: "imports", label: "Imports" },
    { id: "settings", label: "Settings" },
    { id: "limits", label: "Limitations" },
  ];

  const toolbar = [
    ["Interrupt", "Stops the running cell. Falls back to a kernel restart when the cell can't be terminated in-process."],
    ["Clear All", "Empties the interactive window."],
    ["Restart", "Recycles the Deno kernel."],
    ["Save", "Saves the interactive window as a Jupyter `.ipynb` notebook."],
    ["Export", "Writes the cells back out as a `// %%` source file."],
    ["Expand / Collapse", "Expands or collapses all cell inputs."],
  ];

  const keys = [
    ["Ctrl+Enter", "Run the cell at the cursor"],
    ["Shift+Enter", "Run the cell and move to the next one"],
    ["Ctrl+Shift+P", "Run Selection/Line in the interactive window (command palette)"],
  ];

  const settingsRows = [
    ["denote.denoPath", '""', "Path to the <code>deno</code> executable. Empty uses the kernelspec or <code>~/.deno/bin/deno</code>."],
    ["denote.defaultCellMarker", "// %%", "Marker inserted by the Insert Cell commands."],
    ["denote.cellMarker.codeRegex", "^//\\s*%%", "Regex that identifies a code cell marker."],
    ["denote.cellMarker.markdownRegex", "^/\\*\\s*%%\\s*\\[markdown\\]", "Regex that identifies a markdown cell opener (a <code>/* … */</code> block)."],
    ["denote.cellMarker.decorateCells", "currentCell", "<code>currentCell</code>, <code>allCells</code> or <code>none</code> cell borders."],
    ["denote.codeLens.enable", "true", "Show CodeLens actions above cells."],
    ["denote.codeLens.commands", "denote.cell.run, …", "Comma-separated CodeLens commands to show."],
    ["denote.interactiveWindow.creationMode", "perFile", "<code>perFile</code>, <code>single</code> or <code>multiple</code> windows."],
    ["denote.interactiveWindow.viewColumn", "beside", "<code>beside</code>, <code>active</code> or <code>secondGroup</code>."],
    ["denote.trace", "false", "Mirror verbose Denote logs to the developer console."],
  ];

  const cellCommands = [
    ["denote.cell.next", "Move the cursor to the next cell"],
    ["denote.cell.previous", "Move to the previous cell"],
    ["denote.cell.first", "Move to the first cell"],
    ["denote.cell.last", "Move to the last cell"],
    ["denote.cell.insertAbove", "Insert a new cell above"],
    ["denote.cell.insertBelow", "Insert a new cell below"],
    ["denote.cell.delete", "Delete the current cell"],
    ["denote.cell.run", "Run the current cell"],
    ["denote.cell.runAndAdvance", "Run the current cell and move to the next"],
    ["denote.cell.runSelection", "Run the selection/line in the interactive window"],
    ["denote.cell.runAll", "Run every cell"],
    ["denote.cell.runAbove", "Run all cells above"],
    ["denote.cell.runBelow", "Run all cells below"],
  ];

  const contextKeys = [
    ["denote.hasCells", "The active file has at least one cell"],
    ["denote.inCell", "The cursor is inside a cell"],
    ["denote.cellType", "<code>code</code> or <code>markdown</code>"],
    ["denote.cellIndex", "0-based index of the cell at the cursor (<code>-1</code> when none)"],
    ["denote.cellCount", "Number of cells in the file"],
    ["denote.isFirstCell", "The cursor is in the first cell"],
    ["denote.isLastCell", "The cursor is in the last cell"],
  ];
</script>

<div class="layout">
  <aside class="sidebar">
    <div class="brand">
      <img src="denoteLogo_horizontal.svg" alt="Denote" />
    </div>
    <p class="brand-sub">Interactive JS/TS for VSCode, powered by the Deno Jupyter kernel.</p>
    <nav class="nav">
      {#each nav as item}
        <a href="#{item.id}">{item.label}</a>
      {/each}
    </nav>
  </aside>

  <main class="main">
    <header class="hero">
      <span class="tag">VSCode Extension</span>
      <h1>Run JavaScript &amp; TypeScript like a notebook.</h1>
        <ul class="lede">
          <li>
            Denote adds an <strong>interactive window</strong> to VSCode for JS/TS, backed directly by the <strong>Deno built-in Jupyter kernel</strong>.
          </li>
          <li>
            Split a file into cells with <code>// %%</code>, run them with a click or a keystroke, and keep state between cells.
          </li>
          <li>
            Heavily inspired by Microsoft's <a href="https://github.com/microsoft/vscode-jupyter"><code>vscode-jupyter</code></a> extension which implements similar features for Python.
          </li>
        </ul>
      <div class="cta">
        <a class="btn primary" href="#install">Get started</a>
        <a class="btn" href="#demo">Watch the demo</a>
        <a class="btn" href="https://github.com/rec1dite/denote" target="_blank" rel="noopener">
          <Icon name="github" size={16} /> View source
        </a>
      </div>
    </header>

    <Section id="demo" num="01" title="Demo">
      <p>
        Writing cells, importing a function from another module, and running the file in the
        interactive window.
      </p>
      <div class="video">
        <iframe
          class="demo-video"
          width="560"
          height="315"
          src="https://www.youtube.com/embed/A_vYEXaOWhM?si=m-iU8tEzbrA2IEAL"
          title="YouTube video player"
          frameborder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerpolicy="strict-origin-when-cross-origin"
          allowfullscreen
        ></iframe>
      </div>
    </Section>

    <Section id="install" num="02" title="Install">
      <p>
        <a class="release-link" href={$latestRelease.releaseUrl} target="_blank" rel="noopener">
          <Icon name="cloud-download" size={15} />
          Download the latest release{$latestRelease.version ? ` (v${$latestRelease.version})` : ""}
        </a>
      </p>
      <Code lang="sh" code={installCommands($latestRelease)} lines={installLines} />
      <Callout kind="cr1m">
        <p>Requirements: VSCode 1.72+ and Deno on your <code>PATH</code>.</p>
      </Callout>
    </Section>

    <Section id="markers" num="03" title="Cell markers">
      <p>
        Mark cells with a comment that starts with <code>// %%</code>. Wrap prose in a
        <code>/* %% [markdown] … */</code> block to make a cell render as markdown — since it is a
        block comment, TypeScript stays quiet. Cell boundaries get an in-editor border, and each cell
        gets a CodeLens. Try the buttons above each marker.
      </p>
      <InteractiveCode lang="ts" code={s.markers} lines={h.markers.lines} outputs={o.markers} />
      <Callout>
        <p>
          A file with no markers is treated as a single cell. Markdown cells are inserted into the
          interactive window as markdown, not executed.
        </p>
      </Callout>
    </Section>

    <Section id="running" num="04" title="Running cells">
      <p>
        Every cell has <strong>Run Cell</strong>, <strong>Run Above</strong>,
        <strong>Run All Cells</strong> and <strong>Run Below</strong> CodeLenses. Keybindings work
        from the source editor too.
      </p>
      <InteractiveCode lang="ts" code={s.runCell} lines={h.runCell.lines} outputs={o.runCell} />
      <table>
        <thead><tr><th>Shortcut</th><th>Action</th></tr></thead>
        <tbody>
          {#each keys as [k, v]}
            <tr><td><kbd>{k}</kbd></td><td>{v}</td></tr>
          {/each}
        </tbody>
      </table>
    </Section>

    <Section id="commands" num="05" title="Commands &amp; context keys">
      <p>
        Cell commands use a consistent <code>denote.cell.*</code> scheme (window actions use
        <code>denote.interactive.*</code>), so they are easy to bind to shortcuts.
      </p>
      <table>
        <thead><tr><th>Command</th><th>Description</th></tr></thead>
        <tbody>
          {#each cellCommands as [name, desc]}
            <tr><td><code>{name}</code></td><td>{desc}</td></tr>
          {/each}
        </tbody>
      </table>
      <p>Editor and cell state is published as <code>when</code>-clause context keys:</p>
      <table>
        <thead><tr><th>Context key</th><th>Meaning</th></tr></thead>
        <tbody>
          {#each contextKeys as [name, desc]}
            <tr><td><code>{name}</code></td><td>{@html desc}</td></tr>
          {/each}
        </tbody>
      </table>
      <Callout>
        <p>
          For example, bind <code>alt+j</code> to <code>denote.cell.next</code> with
          <code>when: denote.hasCells</code>, or gate <code>denote.cell.delete</code> with
          <code>denote.isLastCell</code>.
        </p>
      </Callout>
    </Section>

    <Section id="interactive" num="06" title="The interactive window">
      <p>
        One interactive window is reused per source file, so repeated runs accumulate in the same
        session. The Deno kernel starts automatically on the first run and keeps its state between
        cells — later cells see earlier declarations.
      </p>
      <InteractiveCode lang="ts" code={s.state} lines={h.state.lines} outputs={o.state} />
      <div class="grid">
        <div class="card">
          <h3>Auto-starting kernel</h3>
          <p>Denote registers its own notebook controller, so the Deno kernel is selected without a kernel picker.</p>
        </div>
        <div class="card">
          <h3>Reused windows</h3>
          <p>Running a file again reuses its interactive window instead of opening a new one.</p>
        </div>
        <div class="card">
          <h3>Shared state</h3>
          <p>Declarations persist across cells, just like a notebook or REPL.</p>
        </div>
      </div>
    </Section>

    <Section id="output" num="07" title="Rich output">
      <p>
        Anything the kernel sends as a display message is rendered: ANSI colours, images, HTML and
        Markdown. Because VSCode renders <code>\r</code> as a newline, progress bars update in
        place using a Jupyter <code>display_id</code> instead.
      </p>

      <h3>ANSI colours</h3>
      <InteractiveCode lang="ts" code={s.ansi} lines={h.ansi.lines} outputs={o.ansi} />

      <h3>Progress bars (updated in place)</h3>
      <InteractiveCode lang="ts" code={s.progress} lines={h.progress.lines} outputs={o.progress} />

      <h3>Images</h3>
      <InteractiveCode lang="ts" code={s.image} lines={h.image.lines} outputs={o.image} />
      <InteractiveCode lang="ts" code={s.imageB64} lines={h.imageB64.lines} outputs={o.imageB64} />

      <h3>HTML &amp; SVG</h3>
      <InteractiveCode lang="ts" code={s.html} lines={h.html.lines} outputs={o.html} />

      <h3>Markdown</h3>
      <InteractiveCode lang="ts" code={s.markdown} lines={h.markdown.lines} outputs={o.markdown} />
    </Section>

    <Section id="errors" num="08" title="Errors &amp; recovery">
      <p>
        Errors surface as notebook error outputs and following cells still run. A cell stuck on a
        pending <code>await</code> can be stopped with <strong>Interrupt</strong>, which restarts
        the kernel if it can't be terminated in-process.
      </p>
      <InteractiveCode lang="ts" code={s.errors} lines={h.errors.lines} outputs={o.errors} />
    </Section>

    <Section id="toolbar" num="09" title="Toolbar actions">
      <p>The interactive-window toolbar is wired up for the Denote kernel:</p>
      <table>
        <thead><tr><th>Action</th><th>Description</th></tr></thead>
        <tbody>
          {#each toolbar as [k, v]}
            <tr><td>{k}</td><td>{v}</td></tr>
          {/each}
        </tbody>
      </table>
    </Section>

    <Section id="imports" num="10" title="Imports &amp; modules">
      <p>
        The kernel runs with the owning file's directory as its working directory, so relative
        imports resolve exactly as they do with <code>deno run</code>.
      </p>
      <Code lang="ts" code={s.mathModule} lines={h.mathModule.lines} />
      <InteractiveCode lang="ts" code={s.imports} lines={h.imports.lines} outputs={o.imports} />
    </Section>

    <Section id="settings" num="11" title="Settings">
      <p>Denote ships a full set of settings:</p>
      <table>
        <thead><tr><th>Setting</th><th>Default</th><th>Description</th></tr></thead>
        <tbody>
          {#each settingsRows as [name, def, desc]}
            <tr>
              <td><code>{name}</code></td>
              <td><code>{def}</code></td>
              <td>{@html desc}</td>
            </tr>
          {/each}
        </tbody>
      </table>
      <Code lang="json" code={s.settings} lines={h.settings.lines} />
    </Section>

    <Section id="limits" num="12" title="Limitations">
      <Callout kind="warn">
        <p>
          Only <code>console.log</code> / <code>console.error</code> are captured as streams.
          <code>process.stdout.write</code>, <code>Deno.stdout.writeSync</code> and
          <code>Deno.stdout.write</code> are not forwarded by the Deno kernel
          (<a href="https://github.com/denoland/deno/issues/20555">deno#20555</a>).
        </p>
      </Callout>
      <Callout kind="warn">
        <p>
          A <strong>Jupyter Variables</strong> view isn't provided: the Deno kernel doesn't expose
          its REPL scope to clients, so there's nothing to populate it with.
        </p>
      </Callout>
    </Section>

    <footer>
      <span>Denote — interactive JS/TS for VSCode.</span>
      <span>MIT licensed.</span>
    </footer>
  </main>
</div>
