<script lang="ts">
  import { repo } from "../stores/repo.svelte";
  import FileList from "./FileList.svelte";

  // Sections repliables (état local à la sidebar).
  let unstagedOpen = $state(true);
  let stagedOpen = $state(true);

  const unstagedCount = $derived(repo.unstagedEntries.length);
  const stagedCount = $derived(repo.stagedEntries.length);
</script>

<div class="panel">
  {#if !repo.repoInfo}
    <p class="empty">Aucun dépôt ouvert.</p>
  {:else}
    <!-- En-tête : nombre de changements + branche courante. -->
    <div class="sb-head">
      <span class="count">
        {repo.changeCount}
        {repo.changeCount > 1 ? "changements" : "changement"}
      </span>
      {#if repo.repoInfo.branch}
        <span class="branch" title={repo.repoInfo.branch}>⎇ {repo.repoInfo.branch}</span>
      {:else if repo.repoInfo.isDetached}
        <span class="branch detached">HEAD détaché</span>
      {/if}
    </div>

    <!-- Barre d'outils : tri + bascule Path / Tree. -->
    <div class="toolbar">
      <button
        class="sort"
        onclick={() => repo.toggleSort()}
        title={repo.sortAsc ? "Tri A→Z" : "Tri Z→A"}
        aria-label="Inverser le tri"
      >
        {repo.sortAsc ? "↑A" : "↓Z"}
      </button>
      <div class="seg">
        <button class:active={repo.viewMode === "path"} onclick={() => repo.setViewMode("path")}>
          ☰ Path
        </button>
        <button class:active={repo.viewMode === "tree"} onclick={() => repo.setViewMode("tree")}>
          ⊟ Tree
        </button>
      </div>
    </div>

    <!--
      Les deux sections se partagent la hauteur disponible et défilent
      indépendamment ; une bordure sépare nettement « non indexés » d'« indexés ».
    -->
    <div class="sections">
      <section class:collapsed={!unstagedOpen}>
        <header>
          <button class="sec-title" onclick={() => (unstagedOpen = !unstagedOpen)}>
            <span class="chev" class:open={unstagedOpen}>▶</span>
            Non indexés ({unstagedCount})
          </button>
          <button
            class="sec-action stage"
            onclick={() => repo.stageAll()}
            disabled={unstagedCount === 0 || repo.busy}
          >
            Tout indexer
          </button>
        </header>
        {#if unstagedOpen}
          <div class="sec-body">
            {#if repo.viewMode === "tree" && unstagedCount > 0}
              <button class="expand-all" onclick={() => repo.toggleExpandAll()}>
                {repo.allDirsExpanded ? "Tout replier" : "Tout déplier"}
              </button>
            {/if}
            <FileList entries={repo.unstagedEntries} staged={false} />
          </div>
        {/if}
      </section>

      <section class="staged" class:collapsed={!stagedOpen}>
        <header>
          <button class="sec-title" onclick={() => (stagedOpen = !stagedOpen)}>
            <span class="chev" class:open={stagedOpen}>▶</span>
            Indexés ({stagedCount})
          </button>
          <button
            class="sec-action unstage"
            onclick={() => repo.unstageAll()}
            disabled={stagedCount === 0 || repo.busy}
          >
            Tout retirer
          </button>
        </header>
        {#if stagedOpen}
          <div class="sec-body">
            <FileList entries={repo.stagedEntries} staged={true} />
          </div>
        {/if}
      </section>
    </div>
  {/if}
</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
  .sb-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.5rem 0.7rem;
    border-bottom: 1px solid var(--border);
  }
  .count {
    font-size: 0.82rem;
    font-weight: 600;
  }
  .branch {
    font-size: 0.75rem;
    color: var(--accent-soft);
    background: var(--bg-raised);
    padding: 0.1rem 0.45rem;
    border-radius: 4px;
    max-width: 55%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .branch.detached {
    color: #fbbf24;
  }

  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.4rem 0.7rem;
  }
  .sort {
    background: var(--bg-raised);
    border: 1px solid var(--border);
    color: var(--text-dim);
    border-radius: 4px;
    font-size: 0.72rem;
    padding: 0.2rem 0.4rem;
    cursor: pointer;
    min-width: 2rem;
  }
  .sort:hover {
    border-color: var(--accent);
    color: var(--text);
  }
  .seg {
    display: flex;
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
  }
  .seg button {
    background: var(--bg-raised);
    border: none;
    color: var(--text-dim);
    font-size: 0.75rem;
    padding: 0.25rem 0.6rem;
    cursor: pointer;
  }
  .seg button.active {
    background: var(--accent);
    color: #fff;
  }

  /* ── Les deux sections partagent la hauteur ── */
  .sections {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
  section {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
  /* Repliée : la section ne garde que la hauteur de son en-tête. */
  section.collapsed {
    flex: none;
  }
  /* Bordure de séparation entre « non indexés » et « indexés ». */
  section.staged {
    border-top: 1px solid var(--border);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    flex: none;
    padding: 0.4rem 0.6rem;
    border-bottom: 1px solid var(--border);
  }
  .sec-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0.3rem 0.4rem 0.5rem;
  }
  .sec-title {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    background: transparent;
    border: none;
    color: var(--text-dim);
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    cursor: pointer;
    padding: 0.1rem;
  }
  .chev {
    display: inline-block;
    font-size: 0.55rem;
    transition: transform 0.1s ease;
  }
  .chev.open {
    transform: rotate(90deg);
  }
  .sec-action {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-dim);
    font-size: 0.7rem;
    padding: 0.15rem 0.45rem;
    border-radius: 4px;
    cursor: pointer;
    white-space: nowrap;
  }
  /* Vert pour indexer, rouge pour retirer (comme la référence). */
  .sec-action.stage:not(:disabled) {
    color: #4ade80;
    border-color: rgba(74, 222, 128, 0.45);
  }
  .sec-action.unstage:not(:disabled) {
    color: #f87171;
    border-color: rgba(248, 113, 113, 0.45);
  }
  .sec-action.stage:hover:not(:disabled) {
    background: rgba(74, 222, 128, 0.12);
  }
  .sec-action.unstage:hover:not(:disabled) {
    background: rgba(248, 113, 113, 0.12);
  }
  .sec-action:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .expand-all {
    background: transparent;
    border: none;
    color: var(--accent-soft);
    font-size: 0.72rem;
    padding: 0.1rem 0.5rem 0.3rem;
    cursor: pointer;
  }
  .expand-all:hover {
    text-decoration: underline;
  }
  .empty {
    color: var(--text-dim);
    font-size: 0.8rem;
    padding: 1rem 0.7rem;
  }
</style>
