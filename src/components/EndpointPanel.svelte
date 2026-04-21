<script lang="ts">
  import type { ConnectivityReport, DiscoveredModel, EndpointProfile } from "../types";

  export let endpoints: EndpointProfile[] = [];
  export let reports: ConnectivityReport[] = [];
  export let models: DiscoveredModel[] = [];
  export let activeEndpointId = "";

  $: reportMap = new Map(reports.map((report) => [report.endpointId, report]));
</script>

<section class="panel health-panel">
  <div class="panel-head compact-head">
    <div>
      <div class="eyebrow">route health</div>
      <h2>Endpoint signal</h2>
    </div>
    <div class="legend">latency / first token</div>
  </div>

  <div class="endpoint-list">
    {#if endpoints.length === 0}
      <div class="panel-empty">No endpoints configured.</div>
    {:else}
      {#each endpoints as endpoint}
        {@const report = reportMap.get(endpoint.id)}
        <div class:active-endpoint={endpoint.id === activeEndpointId} class="endpoint-card">
          <div class="endpoint-top">
            <div>
              <div class="endpoint-name">{endpoint.name}</div>
              <div class="endpoint-kind">{endpoint.providerKind}</div>
            </div>
            <span class="status-pill {report?.status ?? 'degraded'}">{report?.status ?? "untested"}</span>
          </div>
          <div class="endpoint-metrics">
            <span class="metric-pill">latency {report?.latencyMs ?? "n/a"}ms</span>
            <span class="metric-pill">first token {report?.firstTokenMs ?? "n/a"}ms</span>
          </div>
          <div class="endpoint-message">{report?.message ?? "Run connectivity test from the composer."}</div>
        </div>
      {/each}
    {/if}
  </div>
</section>

<section class="panel discovery-panel">
  <div class="panel-head compact-head">
    <div>
      <div class="eyebrow">models cache</div>
      <h2>Discovered models</h2>
    </div>
    <span class="legend">{models.length} cached</span>
  </div>

  <div class="model-list">
    {#if models.length === 0}
      <div class="panel-empty">Sync models to populate the route picker and cache.</div>
    {:else}
      {#each models as model}
        <div class="model-row">
          <div>
            <div class="model-name">{model.modelName}</div>
            <div class="model-meta">{endpoints.find((endpoint) => endpoint.id === model.endpointId)?.name ?? model.endpointId}</div>
          </div>
          <div class="model-cap">{model.contextWindow ? `${Math.round(model.contextWindow / 1000)}k` : "open"}</div>
        </div>
      {/each}
    {/if}
  </div>
</section>
