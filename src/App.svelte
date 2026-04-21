<script lang="ts">
  import { open, save } from "@tauri-apps/plugin-dialog";
  import { onMount } from "svelte";
  import Composer from "./components/Composer.svelte";
  import ContextLens from "./components/ContextLens.svelte";
  import ConversationRail from "./components/ConversationRail.svelte";
  import EndpointPanel from "./components/EndpointPanel.svelte";
  import MessageStream from "./components/MessageStream.svelte";
  import SettingsDrawer from "./components/SettingsDrawer.svelte";
  import WorkspaceHeader from "./components/WorkspaceHeader.svelte";
  import {
    abortStream,
    deleteEndpoint,
    discoverEndpointModels,
    exportData,
    importData,
    listAppState,
    saveConversation,
    saveEndpoint,
    saveRoute,
    streamChatViaRoute,
    testEndpointConnectivity,
  } from "./lib/tauri";
  import {
    appendAssistantChunk,
    buildRequestMessages,
    createConversation,
    createEmptySnapshot,
    createMessage,
    createTokenEstimate,
    findRouteTarget,
    makeConversationTitle,
    markMessageStatus,
    replaceConversation,
    updateMessageFlags,
  } from "./lib/workspace";
  import type {
    AppStateSnapshot,
    ConnectivityReport,
    Conversation,
    DiscoveredModel,
    EndpointProfile,
    Route,
    RouteTarget,
  } from "./types";

  let snapshot: AppStateSnapshot = createEmptySnapshot();
  let loading = true;
  let currentRequestId: string | null = null;
  let activeConversationId = "";
  let activeRouteId = "";
  let draft = "";
  let errorMessage = "";
  let statusMessage = "Loading workspace";
  let firstTokenMs: number | null = null;
  let settingsOpen = false;
  let discovering = false;
  let testingConnectivity = false;
  let requestStartedAt = 0;

  $: conversations = snapshot.conversations;
  $: routes = snapshot.routes;
  $: activeConversation =
    conversations.find((conversation) => conversation.id === activeConversationId) ?? null;
  $: activeRoute = routes.find((route) => route.id === activeRouteId) ?? null;
  $: activeTarget = activeRoute ? findRouteTarget(snapshot, activeRoute.id) : null;
  $: activeEndpointId = activeTarget?.endpointId ?? "";
  $: tokenEstimate = createTokenEstimate(activeConversation, draft);
  $: healthyEndpoints = snapshot.healthReports.filter((report) => report.status === "healthy").length;

  onMount(async () => {
    await reloadState();
  });

  async function reloadState() {
    loading = true;
    try {
      snapshot = await listAppState();
      activeRouteId = snapshot.routes.find((route) => route.id === activeRouteId)?.id ?? snapshot.routes[0]?.id ?? "";
      activeConversationId =
        snapshot.conversations.find((conversation) => conversation.id === activeConversationId)?.id ??
        snapshot.conversations[0]?.id ??
        "";
      if (!activeConversationId && snapshot.routes[0]) {
        activeRouteId = snapshot.routes[0].id;
      }
      errorMessage = "";
      statusMessage = snapshot.routes.length > 0 ? "Ready" : "Add an endpoint and a route.";
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "Failed to load app state.";
      statusMessage = "Workspace failed to load";
    } finally {
      loading = false;
    }
  }

  function setConversation(nextConversation: Conversation) {
    snapshot = {
      ...snapshot,
      conversations: replaceConversation(snapshot.conversations, nextConversation),
    };
    activeConversationId = nextConversation.id;
  }

  async function persistConversation(nextConversation: Conversation) {
    setConversation(nextConversation);
    await saveConversation(nextConversation);
  }

  async function ensureConversation() {
    if (activeConversation) {
      return activeConversation;
    }

    const conversation = createConversation(activeRouteId);
    await persistConversation(conversation);
    return conversation;
  }

  async function handleNewConversation() {
    if (!activeRouteId && snapshot.routes[0]) {
      activeRouteId = snapshot.routes[0].id;
    }

    const conversation = createConversation(activeRouteId);
    await persistConversation(conversation);
  }

  async function handleSend() {
    if (!draft.trim() || currentRequestId) {
      return;
    }

    if (!activeRouteId) {
      settingsOpen = true;
      errorMessage = "Create a route before chatting.";
      return;
    }

    const target = findRouteTarget(snapshot, activeRouteId);
    if (!target) {
      settingsOpen = true;
      errorMessage = "Select an endpoint and model for the active route.";
      return;
    }

    const conversation = await ensureConversation();
    const userMessage = {
      ...createMessage("user", draft.trim()),
      status: "done" as const,
    };
    const assistantMessage = createMessage("assistant", "");
    const updatedConversation: Conversation = {
      ...conversation,
      routeId: activeRouteId,
      title:
        conversation.title === "Untitled conversation"
          ? makeConversationTitle(userMessage.content)
          : conversation.title,
      updatedAt: new Date().toISOString(),
      messages: [...conversation.messages, userMessage, assistantMessage],
    };

    await persistConversation(updatedConversation);
    const requestId = crypto.randomUUID();
    currentRequestId = requestId;
    draft = "";
    errorMessage = "";
    statusMessage = "Generating...";
    requestStartedAt = performance.now();
    firstTokenMs = null;

    try {
      await streamChatViaRoute({
        requestId,
        conversationId: updatedConversation.id,
        routeId: activeRouteId,
        messageId: assistantMessage.id,
        messages: buildRequestMessages({
          ...updatedConversation,
          messages: [...conversation.messages, userMessage],
        }),
        onEvent: async (event) => {
          if (event.event === "start") {
            statusMessage = "Streaming";
            return;
          }

          if (event.event === "meta") {
            statusMessage = `Streaming via ${event.data.model}`;
            return;
          }

          if (event.event === "delta") {
            if (firstTokenMs === null) {
              firstTokenMs = Math.max(1, Math.round(performance.now() - requestStartedAt));
            }
            const currentConversation =
              snapshot.conversations.find((candidate) => candidate.id === updatedConversation.id) ??
              updatedConversation;
            setConversation(appendAssistantChunk(currentConversation, event.data.messageId, event.data.textChunk));
            return;
          }

          if (event.event === "error") {
            const currentConversation =
              snapshot.conversations.find((candidate) => candidate.id === updatedConversation.id) ??
              updatedConversation;
            const nextConversation = markMessageStatus(
              currentConversation,
              event.data.messageId,
              "error",
              event.data.message,
            );
            currentRequestId = null;
            statusMessage = "Generation failed";
            errorMessage = event.data.message;
            await persistConversation(nextConversation);
            return;
          }

          if (event.event === "stop") {
            const currentConversation =
              snapshot.conversations.find((candidate) => candidate.id === updatedConversation.id) ??
              updatedConversation;
            const nextConversation = markMessageStatus(currentConversation, event.data.messageId, "done");
            currentRequestId = null;
            statusMessage = "Ready";
            await persistConversation(nextConversation);
          }
        },
      });
    } catch (error) {
      currentRequestId = null;
      errorMessage = error instanceof Error ? error.message : "Failed to start stream.";
      statusMessage = "Stream failed to start";
    }
  }

  async function handleStop() {
    if (!currentRequestId) {
      return;
    }

    await abortStream(currentRequestId);
    currentRequestId = null;
    statusMessage = "Generation stopped";
  }

  async function handleToggleInclude(messageId: string, included: boolean) {
    if (!activeConversation) {
      return;
    }

    const nextConversation = updateMessageFlags(activeConversation, messageId, {
      includedInContext: included,
    });
    await persistConversation(nextConversation);
  }

  async function handleTogglePin(messageId: string, pinned: boolean) {
    if (!activeConversation) {
      return;
    }

    const nextConversation = updateMessageFlags(activeConversation, messageId, {
      pinned,
      includedInContext: pinned ? true : activeConversation.messages.find((message) => message.id === messageId)?.includedInContext,
    });
    await persistConversation(nextConversation);
  }

  async function handleSaveEndpoint(event: CustomEvent<{ endpoint: EndpointProfile }>) {
    await saveEndpoint(event.detail.endpoint);
    await reloadState();
  }

  async function handleDeleteEndpoint(event: CustomEvent<{ endpointId: string }>) {
    await deleteEndpoint(event.detail.endpointId);
    await reloadState();
  }

  async function handleSaveRoute(event: CustomEvent<{ route: Route; targets: RouteTarget[] }>) {
    await saveRoute(event.detail.route, event.detail.targets);
    await reloadState();
  }

  function upsertHealthReport(report: ConnectivityReport) {
    snapshot = {
      ...snapshot,
      healthReports: [
        ...snapshot.healthReports.filter((candidate) => candidate.endpointId !== report.endpointId),
        report,
      ],
    };
  }

  function upsertDiscoveredModels(endpointId: string, models: DiscoveredModel[]) {
    snapshot = {
      ...snapshot,
      discoveredModels: [
        ...snapshot.discoveredModels.filter((model) => model.endpointId !== endpointId),
        ...models,
      ],
    };
  }

  async function handleTestConnectivity() {
    if (!activeEndpointId) {
      errorMessage = "Select a route with a valid endpoint target.";
      return;
    }

    testingConnectivity = true;
    try {
      const report = await testEndpointConnectivity(activeEndpointId);
      upsertHealthReport(report);
      statusMessage = `Connectivity ${report.status}`;
      errorMessage = "";
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "Connectivity test failed.";
    } finally {
      testingConnectivity = false;
    }
  }

  async function handleDiscoverModels() {
    if (!activeEndpointId) {
      errorMessage = "Select a route with a valid endpoint target.";
      return;
    }

    discovering = true;
    try {
      const models = await discoverEndpointModels(activeEndpointId);
      upsertDiscoveredModels(activeEndpointId, models);
      statusMessage = `Discovered ${models.length} models`;
      errorMessage = "";
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "Model discovery failed.";
    } finally {
      discovering = false;
    }
  }

  async function handleExport() {
    const path = await save({
      defaultPath: "tauri-studio-export.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });

    if (!path) {
      return;
    }

    await exportData(path);
    statusMessage = "Data exported";
  }

  async function handleImport() {
    const path = await open({
      multiple: false,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });

    if (!path || Array.isArray(path)) {
      return;
    }

    snapshot = await importData(path);
    activeRouteId = snapshot.routes[0]?.id ?? "";
    activeConversationId = snapshot.conversations[0]?.id ?? "";
    settingsOpen = false;
    statusMessage = "Data imported";
    errorMessage = "";
  }
</script>

{#if loading}
  <main class="loading-shell">
    <div class="loading-card">
      <span class="section-label">Tauri Studio</span>
      <h1>Loading workspace</h1>
      <p>Reading local routes, endpoints, conversations and cache.</p>
    </div>
  </main>
{:else}
  <main class="app-shell">
    <ConversationRail
      {activeConversationId}
      {activeRouteId}
      conversations={snapshot.conversations}
      discoveredModelCount={snapshot.discoveredModels.length}
      healthyEndpoints={healthyEndpoints}
      routes={snapshot.routes}
      on:newconversation={handleNewConversation}
      on:opendrawer={() => (settingsOpen = true)}
      on:selectconversation={(event) => {
        activeConversationId = event.detail.id;
        const selectedConversation = snapshot.conversations.find(
          (conversation) => conversation.id === event.detail.id,
        );
        if (selectedConversation) {
          activeRouteId = selectedConversation.routeId;
        }
      }}
      on:selectroute={(event) => {
        activeRouteId = event.detail.id;
      }}
    />

    <section class="workspace">
      <section class="chat-column">
        <WorkspaceHeader
          estimateLabel={tokenEstimate.confidence}
          firstTokenLabel={firstTokenMs ? `${firstTokenMs}ms` : "n/a"}
          routeName={activeRoute?.name ?? "unrouted"}
          statusMessage={statusMessage}
          title={activeConversation?.title ?? "Threadlet Workspace"}
        />

        <MessageStream
          conversation={activeConversation}
          on:toggleinclude={(event: CustomEvent<{ id: string; included: boolean }>) =>
            handleToggleInclude(event.detail.id, event.detail.included)}
          on:togglepin={(event: CustomEvent<{ id: string; pinned: boolean }>) =>
            handleTogglePin(event.detail.id, event.detail.pinned)}
        />

        <Composer
          {currentRequestId}
          {discovering}
          {draft}
          {errorMessage}
          routes={snapshot.routes}
          selectedRouteId={activeRouteId}
          testingConnectivity={testingConnectivity}
          {tokenEstimate}
          on:changedraft={(event) => {
            draft = event.detail.value;
          }}
          on:changeroute={(event) => {
            activeRouteId = event.detail.routeId;
          }}
          on:discover={handleDiscoverModels}
          on:send={handleSend}
          on:stop={handleStop}
          on:test={handleTestConnectivity}
        />
      </section>

      <aside class="context-lens">
        <ContextLens
          conversation={activeConversation}
          {tokenEstimate}
          on:toggleinclude={(event: CustomEvent<{ id: string; included: boolean }>) =>
            handleToggleInclude(event.detail.id, event.detail.included)}
          on:togglepin={(event: CustomEvent<{ id: string; pinned: boolean }>) =>
            handleTogglePin(event.detail.id, event.detail.pinned)}
        />
        <EndpointPanel
          activeEndpointId={activeEndpointId}
          endpoints={snapshot.endpoints}
          models={snapshot.discoveredModels}
          reports={snapshot.healthReports}
        />
      </aside>
    </section>

    <SettingsDrawer
      discoveredModels={snapshot.discoveredModels}
      endpoints={snapshot.endpoints}
      open={settingsOpen}
      routes={snapshot.routes}
      routeTargets={snapshot.routeTargets}
      on:close={() => (settingsOpen = false)}
      on:deleteendpoint={handleDeleteEndpoint}
      on:export={handleExport}
      on:import={handleImport}
      on:saveendpoint={handleSaveEndpoint}
      on:saveroute={handleSaveRoute}
    />
  </main>
{/if}
