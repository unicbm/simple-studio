<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import type { Route, TokenEstimate } from "../types";

  export let routes: Route[] = [];
  export let selectedRouteId = "";
  export let draft = "";
  export let errorMessage = "";
  export let currentRequestId: string | null = null;
  export let tokenEstimate: TokenEstimate = {
    input: 0,
    reserveOutput: 4000,
    totalPlanned: 4000,
    confidence: "rough",
    source: "heuristic",
    maxContext: 128000,
  };
  export let discovering = false;
  export let testingConnectivity = false;

  const dispatch = createEventDispatcher<{
    changedraft: { value: string };
    changeroute: { routeId: string };
    discover: void;
    send: void;
    stop: void;
    test: void;
  }>();

  $: fillRatio = Math.min(tokenEstimate.totalPlanned / tokenEstimate.maxContext, 1);
</script>

<div class="composer-shell">
  <div class="composer-toolbar">
    <div class="toolbar-group">
      <label class="route-select-wrap">
        <span class="toolbar-label">Route</span>
        <select
          aria-label="Route"
          class="route-select"
          on:change={(event) =>
            dispatch("changeroute", { routeId: (event.currentTarget as HTMLSelectElement).value })}
          value={selectedRouteId}
        >
          {#each routes as route}
            <option value={route.id}>{route.name}</option>
          {/each}
        </select>
      </label>
      <button class="soft-button" disabled={discovering || !selectedRouteId} on:click={() => dispatch("discover")} type="button">
        {discovering ? "Syncing..." : "Sync models"}
      </button>
      <button class="soft-button" disabled={testingConnectivity || !selectedRouteId} on:click={() => dispatch("test")} type="button">
        {testingConnectivity ? "Testing..." : "Test connectivity"}
      </button>
    </div>
    <div class="toolbar-group compact">
      <span class="micro-chip">{tokenEstimate.confidence}</span>
      <span class="micro-chip">reserve {Math.round(tokenEstimate.reserveOutput / 1000)}k</span>
    </div>
  </div>

  <label class="composer-field">
    <textarea
      aria-label="Prompt"
      on:input={(event) =>
        dispatch("changedraft", { value: (event.currentTarget as HTMLTextAreaElement).value })}
      placeholder="Send a prompt, or continue validating routes, context and streaming behavior..."
      rows="4"
      value={draft}
    ></textarea>
  </label>

  <div class="composer-footer">
    <div class="budget-wrap">
      <div class="budget-line">
        <span>Context {(tokenEstimate.input / 1000).toFixed(1)}k / {(tokenEstimate.maxContext / 1000).toFixed(0)}k</span>
        <span class="divider">•</span>
        <span>estimate: {tokenEstimate.confidence}</span>
        <span class="divider">•</span>
        <span>source: {tokenEstimate.source}</span>
      </div>
      <div class="budget-bar">
        <div class="budget-fill" style={`width:${Math.max(8, Math.round(fillRatio * 100))}%`}></div>
      </div>
    </div>

    <div class="send-group">
      {#if errorMessage}
        <div class="inline-error">{errorMessage}</div>
      {/if}
      {#if currentRequestId}
        <button class="ghost-danger" on:click={() => dispatch("stop")} type="button">Stop</button>
      {/if}
      <button class="send-btn" disabled={!draft.trim() || !selectedRouteId || !!currentRequestId} on:click={() => dispatch("send")} type="button">
        Send
      </button>
    </div>
  </div>
</div>
