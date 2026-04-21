<script lang="ts">
  import { onMount } from "svelte";
  import MarkdownContent from "./components/MarkdownContent.svelte";
  import {
    createConversation,
    deleteConversation,
    getBootstrap,
    renameConversation,
    saveSettings,
    streamChat,
  } from "./lib/api";
  import {
    createLocalMessage,
    DEFAULT_SETTINGS,
    makeConversationTitle,
    replaceConversation,
    updateConversation,
    validateSettings,
  } from "./lib/playground";
  import type { AppSettings, Conversation } from "./types";

  const starterCards = [
    {
      title: "Featured",
      description: "Tune prompts, system instructions, and model parameters in one focused workspace.",
    },
    {
      title: "Code and Chat",
      description: "Use a single conversation surface for coding help, debugging, and planning.",
    },
    {
      title: "Structured Responses",
      description: "Iterate on instructions and output shape without leaving the playground.",
    },
  ];

  let settings: AppSettings = { ...DEFAULT_SETTINGS };
  let conversations: Conversation[] = [];
  let activeConversationId = "";
  let draft = "";
  let loading = true;
  let savingSettings = false;
  let statusMessage = "Loading";
  let errorMessage = "";
  let lastSavedMessage = "";
  let currentAbortController: AbortController | null = null;

  $: activeConversation =
    conversations.find((conversation) => conversation.id === activeConversationId) ?? null;
  $: isConfigured = validateSettings(settings).length === 0;

  onMount(async () => {
    try {
      const bootstrap = await getBootstrap();
      settings = bootstrap.settings;
      conversations = bootstrap.conversations;
      activeConversationId = bootstrap.conversations[0]?.id ?? "";
      statusMessage = "Ready";
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "Failed to load playground.";
      statusMessage = "Offline";
    } finally {
      loading = false;
    }
  });

  function setConversation(nextConversation: Conversation) {
    conversations = replaceConversation(conversations, nextConversation);
    activeConversationId = nextConversation.id;
  }

  async function handleCreateConversation() {
    try {
      const conversation = await createConversation();
      setConversation(conversation);
      errorMessage = "";
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "Failed to create conversation.";
    }
  }

  async function handleRenameConversation(conversation: Conversation) {
    const title = window.prompt("Rename conversation", conversation.title);
    if (!title || title.trim() === conversation.title) {
      return;
    }

    try {
      const updated = await renameConversation(conversation.id, title.trim());
      conversations = replaceConversation(conversations, updated);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "Failed to rename conversation.";
    }
  }

  async function handleDeleteConversation(conversationId: string) {
    try {
      await deleteConversation(conversationId);
      conversations = conversations.filter((conversation) => conversation.id !== conversationId);
      if (activeConversationId === conversationId) {
        activeConversationId = conversations[0]?.id ?? "";
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "Failed to delete conversation.";
    }
  }

  async function handleSaveSettings() {
    const validationErrors = validateSettings(settings);
    if (validationErrors.length > 0) {
      errorMessage = validationErrors[0];
      return;
    }

    savingSettings = true;
    try {
      settings = await saveSettings(settings);
      lastSavedMessage = "Run settings saved";
      errorMessage = "";
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "Failed to save settings.";
    } finally {
      savingSettings = false;
    }
  }

  async function handleSend() {
    if (!draft.trim() || currentAbortController) {
      return;
    }

    if (!isConfigured) {
      errorMessage = "Set Base URL, API key, and model before sending.";
      return;
    }

    let conversation = activeConversation;
    if (!conversation) {
      conversation = await createConversation();
      setConversation(conversation);
    }

    const prompt = draft.trim();
    const userMessage = createLocalMessage("user", prompt, "done");
    const optimisticConversation: Conversation = {
      ...conversation,
      title: conversation.title === "New chat" ? makeConversationTitle(prompt) : conversation.title,
      updatedAt: new Date().toISOString(),
      messages: [...conversation.messages, userMessage],
    };

    setConversation(optimisticConversation);
    draft = "";
    statusMessage = "Running";
    errorMessage = "";
    lastSavedMessage = "";

    const abortController = new AbortController();
    currentAbortController = abortController;

    try {
      await streamChat({
        conversationId: optimisticConversation.id,
        input: prompt,
        signal: abortController.signal,
        onEvent: (event) => {
          if (event.event === "start") {
            conversations = updateConversation(conversations, event.data.conversationId, (current) => ({
              ...current,
              messages: [
                ...current.messages,
                {
                  id: event.data.assistantMessageId,
                  role: "assistant",
                  content: "",
                  createdAt: new Date().toISOString(),
                  status: "streaming",
                },
              ],
            }));
            return;
          }

          if (event.event === "delta") {
            conversations = updateConversation(conversations, event.data.conversationId, (current) => ({
              ...current,
              updatedAt: new Date().toISOString(),
              messages: current.messages.map((message) =>
                message.id === event.data.messageId
                  ? {
                      ...message,
                      content: `${message.content}${event.data.textChunk}`,
                      status: "streaming",
                    }
                  : message,
              ),
            }));
            return;
          }

          if (event.event === "error") {
            statusMessage = "Failed";
            errorMessage = event.data.message;
            conversations = updateConversation(conversations, event.data.conversationId, (current) => ({
              ...current,
              updatedAt: new Date().toISOString(),
              messages: current.messages.map((message) =>
                message.id === event.data.messageId
                  ? {
                      ...message,
                      status: "error",
                      content: event.data.message,
                    }
                  : message,
              ),
            }));
            return;
          }

          if (event.event === "done") {
            statusMessage = "Ready";
            conversations = updateConversation(conversations, event.data.conversationId, (current) => ({
              ...current,
              updatedAt: new Date().toISOString(),
              messages: current.messages.map((message) =>
                message.id === event.data.messageId
                  ? {
                      ...message,
                      status: "done",
                    }
                  : message,
              ),
            }));
          }
        },
      });
    } catch (error) {
      if (!abortController.signal.aborted) {
        errorMessage = error instanceof Error ? error.message : "Failed to stream response.";
        statusMessage = "Failed";
      }
    } finally {
      currentAbortController = null;
    }
  }

  function handleStop() {
    currentAbortController?.abort();
    currentAbortController = null;
    statusMessage = "Stopped";
  }
</script>

{#if loading}
  <main class="loading-shell">
    <div class="loading-card">
      <span class="eyebrow">Simple Studio</span>
      <h1>Loading local playground</h1>
      <p>Connecting the browser UI to the Rust backend running on localhost.</p>
    </div>
  </main>
{:else}
  <main class="playground-shell">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">S</div>
        <div>
          <div class="brand-title">Simple Studio</div>
          <div class="brand-subtitle">Local Playground</div>
        </div>
      </div>

      <button class="nav-pill active" type="button">Playground</button>
      <button class="new-chat-button" on:click={handleCreateConversation} type="button">
        + New prompt
      </button>

      <div class="history-section">
        <div class="section-title">History</div>
        {#if conversations.length === 0}
          <div class="muted-copy">No history yet. Start with the playground composer.</div>
        {:else}
          {#each conversations as conversation}
            <div class:active={conversation.id === activeConversationId} class="history-item">
              <button
                class="history-link"
                on:click={() => {
                  activeConversationId = conversation.id;
                  errorMessage = "";
                }}
                type="button"
              >
                <span>{conversation.title}</span>
                <small>{new Date(conversation.updatedAt).toLocaleDateString()}</small>
              </button>
              <div class="history-actions">
                <button aria-label={`Rename ${conversation.title}`} on:click={() => handleRenameConversation(conversation)} type="button">
                  Rename
                </button>
                <button aria-label={`Delete ${conversation.title}`} on:click={() => handleDeleteConversation(conversation.id)} type="button">
                  Delete
                </button>
              </div>
            </div>
          {/each}
        {/if}
      </div>
    </aside>

    <section class="main-pane">
      <header class="workspace-header">
        <div class="workspace-heading">
          <div class="toolbar-icon">≡</div>
          <div>
            <div class="eyebrow">Playground</div>
            <h1>{activeConversation?.title ?? "Explore local models"}</h1>
          </div>
        </div>
        <div class="header-status">
          <span class="status-chip">{statusMessage}</span>
          {#if lastSavedMessage}
            <span class="status-chip subtle">{lastSavedMessage}</span>
          {/if}
        </div>
      </header>

      <section class="chat-surface">
        {#if !activeConversation || activeConversation.messages.length === 0}
          <div class="welcome-panel">
            <h2>Explore local prompts</h2>
            <div class="starter-grid">
              {#each starterCards as card}
                <button class="starter-card" on:click={() => (draft = `Help me with ${card.title.toLowerCase()} in Simple Studio.`)} type="button">
                  <strong>{card.title}</strong>
                  <span>{card.description}</span>
                </button>
              {/each}
            </div>
          </div>
        {:else}
          <div class="messages">
            {#each activeConversation.messages as message}
              <article class="message-row {message.role}">
                <div class="message-badge">{message.role}</div>
                <div class="message-card">
                  <div class="message-meta">
                    <span>{new Date(message.createdAt).toLocaleTimeString()}</span>
                    <span>{message.status}</span>
                  </div>
                  <MarkdownContent content={message.content} />
                </div>
              </article>
            {/each}
          </div>
        {/if}
      </section>

      <div class="composer-shell">
        <textarea
          aria-label="Prompt"
          bind:value={draft}
          placeholder="Start typing a prompt to see what your local playground can do"
          rows="4"
        ></textarea>
        <div class="composer-footer">
          <div class="composer-hints">
            <span class="hint-chip">{settings.model || "No model configured"}</span>
            <span class="hint-chip">temp {settings.temperature.toFixed(1)}</span>
            <span class="hint-chip">{settings.stream ? "stream on" : "stream off"}</span>
          </div>
          <div class="composer-actions">
            {#if errorMessage}
              <div class="error-banner">{errorMessage}</div>
            {/if}
            {#if currentAbortController}
              <button class="ghost-button" on:click={handleStop} type="button">Stop</button>
            {/if}
            <button class="primary-button" disabled={!draft.trim()} on:click={handleSend} type="button">
              Run
            </button>
          </div>
        </div>
      </div>
    </section>

    <aside class="settings-pane">
      <div class="section-head">
        <div class="section-title">Run settings</div>
      </div>

      <div class="settings-card">
        <label>
          <span>Base URL</span>
          <input bind:value={settings.baseUrl} placeholder="https://api.openai.com" />
        </label>
        <label>
          <span>API key</span>
          <input bind:value={settings.apiKey} placeholder="sk-..." type="password" />
        </label>
        <label>
          <span>Model</span>
          <input bind:value={settings.model} placeholder="gpt-4.1-mini" />
        </label>
        <label>
          <span>System instructions</span>
          <textarea bind:value={settings.systemInstruction} rows="5" placeholder="Optional tone and style instructions for the model"></textarea>
        </label>
      </div>

      <div class="settings-card">
        <label>
          <span>Temperature</span>
          <div class="range-row">
            <input bind:value={settings.temperature} max="2" min="0" step="0.1" type="range" />
            <strong>{settings.temperature.toFixed(1)}</strong>
          </div>
        </label>
        <label>
          <span>Max output tokens</span>
          <input bind:value={settings.maxOutputTokens} min="1" type="number" />
        </label>
        <label class="toggle-row">
          <span>Streaming</span>
          <input bind:checked={settings.stream} type="checkbox" />
        </label>
      </div>

      <button class="primary-button full-width" disabled={savingSettings} on:click={handleSaveSettings} type="button">
        {savingSettings ? "Saving..." : "Save run settings"}
      </button>
    </aside>
  </main>
{/if}
