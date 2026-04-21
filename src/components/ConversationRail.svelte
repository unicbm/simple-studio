<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import type { Conversation, Route } from "../types";

  export let conversations: Conversation[] = [];
  export let routes: Route[] = [];
  export let activeConversationId = "";
  export let activeRouteId = "";
  export let healthyEndpoints = 0;
  export let discoveredModelCount = 0;

  const dispatch = createEventDispatcher<{
    newconversation: void;
    opendrawer: void;
    selectconversation: { id: string };
    selectroute: { id: string };
  }>();
</script>

<aside class="rail">
  <div class="brand-block">
    <div class="brand-mark">T</div>
    <div>
      <div class="eyebrow">quiet console</div>
      <div class="brand-name">Simple Studio</div>
    </div>
  </div>

  <button class="primary-action" on:click={() => dispatch("newconversation")} type="button">
    + New conversation
  </button>

  <div class="rail-section">
    <div class="section-label">Routes</div>
    {#if routes.length === 0}
      <div class="empty-rail-copy">Create a route in settings to activate the workspace.</div>
    {:else}
      {#each routes as route}
        <button
          class:active={route.id === activeRouteId}
          class="route-pill"
          on:click={() => dispatch("selectroute", { id: route.id })}
          type="button"
        >
          <span>{route.name}</span>
        </button>
      {/each}
    {/if}
  </div>

  <div class="rail-section conversations">
    <div class="section-label">Conversations</div>
    {#if conversations.length === 0}
      <div class="empty-rail-copy">No conversation yet. Start from the main composer.</div>
    {:else}
      {#each conversations as conversation}
        <button
          class:active={conversation.id === activeConversationId}
          class="conv-item"
          on:click={() => dispatch("selectconversation", { id: conversation.id })}
          type="button"
        >
          <span class="conv-title">{conversation.title}</span>
          <span class="conv-meta">{new Date(conversation.updatedAt).toLocaleString()}</span>
        </button>
      {/each}
    {/if}
  </div>

  <button class="drawer-link" on:click={() => dispatch("opendrawer")} type="button">
    Settings and routes
  </button>

  <div class="rail-footer">
    <div class="footer-chip">{healthyEndpoints} endpoints healthy</div>
    <div class="footer-chip muted">{discoveredModelCount} models cached</div>
  </div>
</aside>
