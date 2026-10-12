<script>
  import { onMount, onDestroy } from "svelte";

  export let width = 40;

  let progress = 0;
  let timer;

  // Mirrors the snippet: a random step every 100ms until the bar fills.
  onMount(() => {
    timer = setInterval(() => {
      progress = Math.min(100, progress + Math.random() * 8);
      if (progress >= 100) clearInterval(timer);
    }, 100);
  });

  onDestroy(() => clearInterval(timer));

  $: filled = Math.round((progress / 100) * width);
  $: bar = "█".repeat(filled) + "=".repeat(width - filled);
</script>

<pre class="out progress">{`[${bar}] ${Math.floor(progress)}%`}</pre>
