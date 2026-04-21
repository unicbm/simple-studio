<script lang="ts">
  export let title = "Threadlet Workspace";
  export let routeName = "unrouted";
  export let statusMessage = "Idle";
  export let firstTokenLabel = "n/a";
  export let estimateLabel = "rough";
</script>

<header class="topbar">
  <div>
    <div class="eyebrow">route / {routeName}</div>
    <h1>{title}</h1>
    <div class="topbar-meta">
      <span>single-window workspace</span>
      <span>•</span>
      <span>normalized streaming</span>
      <span>•</span>
      <span>{statusMessage}</span>
    </div>
  </div>

  <div class="topbar-stats">
    <div class="stat-card">
      <div class="stat-label">Status</div>
      <div class="stat-value">{statusMessage}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">First token</div>
      <div class="stat-value">{firstTokenLabel}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Estimate</div>
      <div class="stat-value">{estimateLabel}</div>
    </div>
  </div>
</header>
