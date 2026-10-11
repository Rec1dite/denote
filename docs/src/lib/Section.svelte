<script>
  export let id;
  export let num = "";
  export let title = "";
</script>

<section {id}>
  <div class="section-head">
    {#if num}<span class="num">{num}</span>{/if}
    <h2>{title}</h2>
  </div>
  <slot />
</section>
