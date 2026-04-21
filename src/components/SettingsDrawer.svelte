<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import { createBlankEndpoint, createBlankRoute } from "../lib/workspace";
  import type { DiscoveredModel, EndpointProfile, Route, RouteTarget } from "../types";

  export let open = false;
  export let endpoints: EndpointProfile[] = [];
  export let routes: Route[] = [];
  export let routeTargets: RouteTarget[] = [];
  export let discoveredModels: DiscoveredModel[] = [];

  const dispatch = createEventDispatcher<{
    close: void;
    deleteendpoint: { endpointId: string };
    export: void;
    import: void;
    saveendpoint: { endpoint: EndpointProfile };
    saveroute: { route: Route; targets: RouteTarget[] };
  }>();

  let endpointDrafts: EndpointProfile[] = [];
  let routeDrafts: Array<{ route: Route; target: RouteTarget }> = [];

  function syncDrafts() {
    endpointDrafts = endpoints.map((endpoint) => ({ ...endpoint }));
    routeDrafts = routes.map((route) => {
      const firstTarget = route.targetIds
        .map((targetId) => routeTargets.find((target) => target.id === targetId) ?? null)
        .find((target): target is RouteTarget => target !== null) ?? {
        id: crypto.randomUUID(),
        endpointId: endpoints[0]?.id ?? "",
        model: endpoints[0]?.defaultModel ?? "",
        priority: 0,
        enabled: true,
      };

      return {
        route: { ...route, targetIds: [firstTarget.id] },
        target: { ...firstTarget },
      };
    });
  }

  $: if (open) {
    syncDrafts();
  }

  function addEndpoint() {
    endpointDrafts = [...endpointDrafts, createBlankEndpoint()];
  }

  function addRoute() {
    const blank = createBlankRoute();
    routeDrafts = [
      ...routeDrafts,
      {
        route: blank.route,
        target: {
          id: crypto.randomUUID(),
          endpointId: endpointDrafts[0]?.id ?? "",
          model: endpointDrafts[0]?.defaultModel ?? "",
          priority: 0,
          enabled: true,
        },
      },
    ];
  }
</script>

{#if open}
  <button aria-label="Close settings" class="drawer-scrim" on:click={() => dispatch("close")} type="button"></button>
  <aside class="settings-drawer">
    <div class="drawer-head">
      <div>
        <div class="eyebrow">settings drawer</div>
        <h2>Endpoints, routes and data</h2>
      </div>
      <button class="tiny-btn" on:click={() => dispatch("close")} type="button">Close</button>
    </div>

    <section class="drawer-section">
      <div class="drawer-section-head">
        <h3>Endpoints</h3>
        <button class="tiny-btn" on:click={addEndpoint} type="button">Add endpoint</button>
      </div>
      {#each endpointDrafts as endpoint, index}
        <div class="form-card">
          <input bind:value={endpointDrafts[index].name} placeholder="Endpoint name" />
          <input bind:value={endpointDrafts[index].baseUrl} placeholder="https://api.example.com" />
          <input bind:value={endpointDrafts[index].apiKey} placeholder="API key" type="password" />
          <input bind:value={endpointDrafts[index].defaultModel} placeholder="Default model" />
          <label class="inline-toggle">
            <input bind:checked={endpointDrafts[index].enabled} type="checkbox" />
            <span>Enabled</span>
          </label>
          <div class="form-actions">
            <button class="tiny-btn" on:click={() => dispatch("saveendpoint", { endpoint })} type="button">Save</button>
            <button class="tiny-btn danger" on:click={() => dispatch("deleteendpoint", { endpointId: endpoint.id })} type="button">Delete</button>
          </div>
        </div>
      {/each}
    </section>

    <section class="drawer-section">
      <div class="drawer-section-head">
        <h3>Routes</h3>
        <button class="tiny-btn" on:click={addRoute} type="button">Add route</button>
      </div>
      {#each routeDrafts as draft, index}
        <div class="form-card">
          <input bind:value={routeDrafts[index].route.name} placeholder="Route name" />
          <select bind:value={routeDrafts[index].target.endpointId}>
            {#each endpointDrafts as endpoint}
              <option value={endpoint.id}>{endpoint.name}</option>
            {/each}
          </select>
          <input bind:value={routeDrafts[index].target.model} list={`models-${draft.route.id}`} placeholder="Model" />
          <datalist id={`models-${draft.route.id}`}>
            {#each discoveredModels.filter((model) => model.endpointId === draft.target.endpointId) as model}
              <option value={model.modelName}></option>
            {/each}
          </datalist>
          <div class="form-actions">
            <button
              class="tiny-btn"
              on:click={() =>
                dispatch("saveroute", {
                  route: { ...draft.route, targetIds: [draft.target.id] },
                  targets: [{ ...draft.target, priority: 0, enabled: true }],
                })}
              type="button"
            >
              Save route
            </button>
          </div>
        </div>
      {/each}
    </section>

    <section class="drawer-section">
      <div class="drawer-section-head">
        <h3>Data</h3>
      </div>
      <div class="form-actions">
        <button class="tiny-btn" on:click={() => dispatch("export")} type="button">Export JSON</button>
        <button class="tiny-btn" on:click={() => dispatch("import")} type="button">Import JSON</button>
      </div>
    </section>
  </aside>
{/if}
