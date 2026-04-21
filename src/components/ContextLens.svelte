<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import type { Conversation, TokenEstimate } from "../types";

  export let conversation: Conversation | null = null;
  export let tokenEstimate: TokenEstimate;

  const dispatch = createEventDispatcher<{
    toggleinclude: { id: string; included: boolean };
    togglepin: { id: string; pinned: boolean };
  }>();
</script>

<section class="panel budget-panel">
  <div class="panel-head">
    <div>
      <div class="eyebrow">context lens</div>
      <h2>Planned payload</h2>
    </div>
  </div>

  <div class="budget-hero">
    <div>
      <div class="hero-number">{(tokenEstimate.input / 1000).toFixed(1)}k</div>
      <div class="hero-label">planned input tokens</div>
    </div>
    <div class="confidence-pill">{tokenEstimate.confidence} estimate</div>
  </div>

  <div class="context-list">
    {#if !conversation || conversation.messages.length === 0}
      <div class="panel-empty">No context yet. The first turn will appear here.</div>
    {:else}
      {#each conversation.messages as message}
        <label class="context-item">
          <input
            checked={message.includedInContext || message.pinned}
            disabled={message.pinned}
            on:change={(event) =>
              dispatch("toggleinclude", {
                id: message.id,
                included: (event.currentTarget as HTMLInputElement).checked,
              })}
            type="checkbox"
          />
          <div>
            <div class="context-title">{message.role}</div>
            <div class="context-desc">{message.content.slice(0, 82) || "Waiting for response..."}</div>
          </div>
          <button
            class="tiny-btn"
            on:click|preventDefault={() => dispatch("togglepin", { id: message.id, pinned: !message.pinned })}
            type="button"
          >
            {message.pinned ? "Pinned" : "Pin"}
          </button>
        </label>
      {/each}
    {/if}
  </div>
</section>
