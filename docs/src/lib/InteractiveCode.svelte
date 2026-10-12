<script>
  import { buildCells, ansiToHtml, markdownToHtml, copyText } from "./interactive.js";
  import Icon from "./Icon.svelte";
  import ProgressBar from "./ProgressBar.svelte";

  export let lang = "ts";
  export let code = "";
  export let lines = [];
  export let outputs = [];

  $: cells = buildCells(lines, outputs);
  $: cellByMarkerLine = new Map(cells.map((cell, index) => [cell.start, index]));

  let executed = [];
  let nextId = 0;
  let copied = false;
  let copyTimer;

  // A cell output may be a function; call it at run time so stateful demos accumulate.
  function run(indices) {
    executed = [
      ...executed,
      ...indices.map((index) => {
        const cell = cells[index];
        const output = typeof cell.output === "function" ? cell.output() : cell.output;
        return { id: nextId++, cell: { ...cell, output } };
      }),
    ];
  }
  const runCell = (i) => run([i]);
  const runAll = () => run(cells.map((_, i) => i));
  const runAbove = (i) => run(cells.map((_, k) => k).filter((k) => k < i));
  const runBelow = (i) => run(cells.map((_, k) => k).filter((k) => k >= i));
  const clearAll = () => (executed = []);
  const clearOne = (id) => (executed = executed.filter((e) => e.id !== id));

  async function copy() {
    if (await copyText(code)) {
      copied = true;
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => (copied = false), 1200);
    }
  }
</script>

<div class="iw">
  <div class="code">
    <div class="code-bar">
      <span class="lang">{lang}</span>
      <button class="copy" on:click={copy} aria-label="Copy code">{copied ? "copied" : "copy"}</button>
    </div>
    <div class="iw-code">
      {#each lines as line, i}
        {#if cellByMarkerLine.has(i)}
          <div class="lens-row">
            <button class="lens" on:click={() => runCell(cellByMarkerLine.get(i))}><Icon name="play" size={13} />Run Cell</button>
            {#if cellByMarkerLine.get(i) === 0}
              <button class="lens" on:click={runAll}><Icon name="run-all" size={13} />Run All Cells</button>
            {:else}
              <button class="lens" on:click={() => runAbove(cellByMarkerLine.get(i))}><Icon name="run-above" size={13} />Run Above</button>
            {/if}
            <button class="lens" on:click={() => runBelow(cellByMarkerLine.get(i))}><Icon name="run-below" size={13} />Run Below</button>
          </div>
        {/if}
        <div class="line">{@html line.html}</div>
      {/each}
    </div>
  </div>

  {#if executed.length > 0}
    <div class="terminal">
      <div class="terminal-bar">
        <button class="toolbar-btn" on:click={clearAll} title="Clear All">
          <Icon name="clear-all" size={13} /> Clear All
        </button>
        <span class="kernel">
          <Icon name="chip" size={13} /> Deno
        </span>
      </div>
      <div class="terminal-body">
        {#each executed as entry (entry.id)}
          <div class="exec">
            {#if entry.cell.kind === "markdown"}
              <div class="exec-md">
                <div class="out markdown">{@html entry.cell.markdownHtml}</div>
                <button class="exec-clear" on:click={() => clearOne(entry.id)} title="Clear output">
                  <Icon name="trash" size={13} />
                </button>
              </div>
            {:else}
              <div class="exec-head">
                <span class="ok"><Icon name="check" size={13} /></span>
                <code class="exec-code">{@html entry.cell.headerHtml}</code>
                <span class="ellipsis">…</span>
                <button class="exec-clear" on:click={() => clearOne(entry.id)} title="Clear output">
                  <Icon name="trash" size={13} />
                </button>
              </div>
              <div class="exec-out">
                {#each entry.cell.output.blocks as block}
                  {#if block.type === "image"}
                    <img class="out-img" src={block.src} alt={block.alt ?? ""} />
                  {:else if block.type === "html"}
                    <div class="out-html">{@html block.html}</div>
                  {:else if block.type === "markdown"}
                    <div class="out markdown">{@html markdownToHtml(block.text)}</div>
                  {:else if block.type === "progress"}
                    <ProgressBar width={block.width} />
                  {:else}
                    <pre class="out {block.type === "error" ? "error" : block.type}">{@html ansiToHtml(block.text)}</pre>
                  {/if}
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>
