<script>
  import icons from "../icons.js";

  export let name = "";
  export let size = 14;
</script>

<span class="icon" style="--icon-size:{size}px" aria-hidden="true">{@html icons[name] ?? ""}</span>
