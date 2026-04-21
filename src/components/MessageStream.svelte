<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import type { Conversation } from "../types";
  import MarkdownContent from "./MarkdownContent.svelte";

  export let conversation: Conversation | null = null;

  const dispatch = createEventDispatcher<{
    toggleinclude: { id: string; included: boolean };
    togglepin: { id: string; pinned: boolean };
  }>();
</script>

<section class="message-stream">
  {#if !conversation || conversation.messages.length === 0}
    <div class="empty-state">
      <strong>Single-workspace chat is ready.</strong>
      <p>Add an endpoint, create a route, then send the first prompt from the composer.</p>
    </div>
  {:else}
    {#each conversation.messages as message}
      <article class="message {message.role}">
        <div class="gutter">
          <span class="role-pill role-{message.role}">{message.role}</span>
        </div>
        <div class="message-body">
          <div class="message-meta">
            <span>{new Date(message.createdAt).toLocaleTimeString()}</span>
            <span>{message.status}</span>
            <span>{message.includedInContext || message.pinned ? "in context" : "excluded"}</span>
            {#if message.pinned}<span>pinned</span>{/if}
          </div>
          <div class="message-toolbar">
            <button
              class="tiny-btn"
              on:click={() =>
                dispatch("toggleinclude", { id: message.id, included: !message.includedInContext })}
              type="button"
            >
              {message.includedInContext ? "Exclude" : "Include"}
            </button>
            <button
              class="tiny-btn"
              on:click={() => dispatch("togglepin", { id: message.id, pinned: !message.pinned })}
              type="button"
            >
              {message.pinned ? "Unpin" : "Pin"}
            </button>
          </div>
          <div class="message-content">
            <MarkdownContent content={message.content} />
          </div>
        </div>
      </article>
    {/each}
  {/if}
</section>
