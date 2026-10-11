<script>
  import { copyText } from "./interactive.js";

  export let lang = "ts";
  export let code = "";
  export let lines = null;

  let copied = false;
  let timer;

  async function copy() {
    if (await copyText(code)) {
      copied = true;
      clearTimeout(timer);
      timer = setTimeout(() => (copied = false), 1200);
    }
  }
</script>

<div class="code">
  <div class="code-bar">
    <span class="lang">{lang}</span>
    <button class="copy" on:click={copy} aria-label="Copy code">{copied ? "copied" : "copy"}</button>
  </div>
  <pre><code>{#if lines}{#each lines as line}<span class="line">{@html line.html}</span>{/each}{:else}{#each code.split("\n") as line}<span class="line">{line}</span>{/each}{/if}</code></pre>
</div>
