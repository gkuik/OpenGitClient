<script lang="ts">
  import { tabs } from "../stores/repo.svelte";

  // Affiché quand aucun onglet n'est ouvert. Reprend l'accès aux dépôts récents,
  // que l'ancienne topbar portait avant de devenir une simple barre d'onglets.
</script>

<div class="welcome">
  <div class="card">
    <h1>GitLite</h1>
    <p class="sub">Aucun dépôt ouvert.</p>

    <button class="open" disabled={tabs.opening} onclick={() => tabs.openFromDialog()}>
      Ouvrir un dépôt…
    </button>

    {#if tabs.recent.length > 0}
      <div class="recent">
        <span class="label">Récents</span>
        {#each tabs.recent as r (r.path)}
          <button class="item" title={r.path} onclick={() => tabs.open(r.path)}>
            <span class="rname">{r.name}</span>
            <span class="rpath">{r.path}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .welcome {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    min-height: 0;
    overflow-y: auto;
    padding: 1.5rem;
  }
  .card {
    display: flex;
    flex-direction: column;
    width: min(30rem, 100%);
  }
  h1 {
    margin: 0;
    font-size: 1.4rem;
    letter-spacing: 0.02em;
    color: var(--accent-soft);
  }
  .sub {
    margin: 0.25rem 0 1.1rem;
    color: var(--text-dim);
    font-size: 0.9rem;
  }
  .open {
    align-self: flex-start;
    background: var(--accent);
    color: var(--accent-text);
    border: none;
    padding: 0.5rem 1rem;
    border-radius: 6px;
    font-size: 0.88rem;
    cursor: pointer;
  }
  .open:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .recent {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    margin-top: 1.6rem;
  }
  .label {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-dim);
    margin-bottom: 0.2rem;
  }
  .item {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.1rem;
    text-align: left;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 6px;
    padding: 0.4rem 0.6rem;
    cursor: pointer;
    min-width: 0;
    width: 100%;
  }
  .item:hover {
    background: var(--bg-raised);
    border-color: var(--border);
  }
  .rname {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text);
  }
  .rpath {
    font-size: 0.72rem;
    color: var(--text-faint);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }
</style>
