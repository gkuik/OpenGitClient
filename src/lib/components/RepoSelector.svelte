<script lang="ts">
  import { repo } from "../stores/repo.svelte";
</script>

<div class="selector">
  <button class="open-btn" onclick={() => repo.openFromDialog()} disabled={repo.busy}>
    Ouvrir un dépôt…
  </button>

  {#if repo.repoInfo}
    <div class="current" title={repo.repoInfo.path}>
      <span class="name">{repo.repoInfo.name}</span>
    </div>
  {:else if repo.recent.length > 0}
    <div class="recent">
      <span class="recent-label">Récents :</span>
      {#each repo.recent as r (r.path)}
        <button class="recent-item" title={r.path} onclick={() => repo.openRepo(r.path)}>
          {r.name}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .selector {
    display: flex;
    align-items: center;
    gap: 1rem;
    flex: 1;
    min-width: 0;
  }
  .open-btn {
    background: var(--accent);
    color: #fff;
    border: none;
    padding: 0.4rem 0.9rem;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.85rem;
    white-space: nowrap;
  }
  .open-btn:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .current {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    min-width: 0;
  }
  .name {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .recent {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    overflow: hidden;
  }
  .recent-label {
    font-size: 0.78rem;
    color: var(--text-dim);
    white-space: nowrap;
  }
  .recent-item {
    background: var(--bg-raised);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 0.2rem 0.5rem;
    border-radius: 4px;
    font-size: 0.78rem;
    cursor: pointer;
    white-space: nowrap;
  }
  .recent-item:hover {
    border-color: var(--accent);
  }
</style>
