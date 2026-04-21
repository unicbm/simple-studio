<script lang="ts">
  import DOMPurify from "dompurify";
  import { marked } from "marked";

  export let content = "";

  marked.setOptions({
    breaks: true,
    gfm: true,
  });

  $: renderedHtml = DOMPurify.sanitize(marked.parse(content || "_Waiting for response..._") as string);
</script>

<div class="markdown-body">{@html renderedHtml}</div>
