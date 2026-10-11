<script>
  import { onMount, onDestroy } from "svelte";

  export let width = 40;
  export let duration = 1400;

  let progress = 0;
  let timer;

  onMount(() => {
    const start = Date.now();
    timer = setInterval(() => {
      const t = Math.min(1, (Date.now() - start) / duration);
      progress = Math.round(t * 100);
      if (t >= 1) clearInterval(timer);
    }, 50);
  });

  onDestroy(() => clearInterval(timer));

  $: filled = Math.round((progress / 100) * width);
  $: bar = "█".repeat(filled) + "=".repeat(width - filled);
</script>

<pre class="out progress">{`[${bar}] ${progress}%`}</pre>
