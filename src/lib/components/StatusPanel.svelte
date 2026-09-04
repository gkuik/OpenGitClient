<script lang="ts">
  import { repo } from "../stores/repo.svelte";
  import FileList from "./FileList.svelte";

  // Sections repliables (état local à la sidebar).
  let unstagedOpen = $state(true);
  let stagedOpen = $state(true);

  const unstagedCount = $derived(repo.unstagedEntries.length);
  const stagedCount = $derived(repo.stagedEntries.length);

  // ── Abandon de tous les changements ─────────────────────────────────────────
  // Irréversible, et sans dialogue natif (aucune capacité de confirmation
  // déclarée) : la demande est un panneau ancré sous le bouton, qui dit ce qui
  // va disparaître avant de le faire.
  let confirming = $state(false);

  // Les non suivis seront *supprimés* du disque, les suivis seulement ramenés à
  // HEAD : les deux nombres sont annoncés séparément parce qu'ils ne coûtent pas
  // la même chose. Aucun chemin n'est dans les deux — un fichier indexé n'est
  // plus non suivi — donc la soustraction est exacte.
  const untrackedCount = $derived(repo.status?.untracked.length ?? 0);
  const trackedCount = $derived(repo.changeCount - untrackedCount);

  async function discard() {
    confirming = false;
    await repo.discardAll();
  }
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === "Escape") confirming = false;
  }}
/>

<div class="panel">
  {#if !repo.repoInfo}
    <p class="empty">Aucun dépôt ouvert.</p>
  {:else}
    <!-- En-tête : « N changements sur <branche> », le tout aligné à gauche. -->
    <div class="sb-head">
      <span class="count">
        {repo.changeCount}
        {repo.changeCount > 1 ? "changements" : "changement"}
      </span>
      {#if repo.repoInfo.branch}
        <span class="on">sur</span>
        <span class="branch" title={repo.repoInfo.branch}>⎇ {repo.repoInfo.branch}</span>
      {:else if repo.repoInfo.isDetached}
        <span class="on">sur</span>
        <span class="branch detached">HEAD détaché</span>
      {/if}

      <button
        class="discard"
        onclick={() => (confirming = !confirming)}
        disabled={repo.changeCount === 0 || repo.busy}
        title="Abandonner tous les changements en cours"
        aria-expanded={confirming}
      >
        ↺ Tout abandonner
      </button>

      {#if confirming}
        <!-- Superposition qui referme au clic à côté, comme les menus de la
             colonne de gauche. -->
        <button class="scrim" aria-label="Annuler" onclick={() => (confirming = false)}
        ></button>
        <div class="confirm" role="dialog" aria-label="Abandonner tous les changements">
          <p class="c-title">Abandonner tous les changements ?</p>
          <p class="c-text">
            {#if trackedCount > 0}
              {trackedCount}
              {trackedCount > 1 ? "fichiers suivis reviendront" : "fichier suivi reviendra"} à
              l'état du dernier commit{untrackedCount > 0 ? "," : "."}
            {/if}
            {#if untrackedCount > 0}
              {untrackedCount}
              {untrackedCount > 1
                ? "fichiers non suivis seront supprimés"
                : "fichier non suivi sera supprimé"} du disque.
            {/if}
            Rien n'est récupérable ensuite.
          </p>
          <div class="c-actions">
            <button class="c-cancel" onclick={() => (confirming = false)}>Annuler</button>
            <button class="c-ok" onclick={discard}>Tout abandonner</button>
          </div>
        </div>
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
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.5rem 0.7rem;
    border-bottom: 1px solid var(--border);
  }
  .count {
    font-size: 0.82rem;
    font-weight: 600;
    flex: none;
    white-space: nowrap;
  }
  .on {
    font-size: 0.75rem;
    color: var(--text-dim);
    flex: none;
  }
  /* La branche est la seule à céder : elle s'ellipse au lieu de déborder. */
  .branch {
    font-size: 0.75rem;
    color: var(--accent-soft);
    background: var(--bg-raised);
    padding: 0.1rem 0.45rem;
    border-radius: 4px;
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .branch.detached {
    color: var(--warn);
  }

  /* Action destructrice : collée à droite, dans le rouge des « Tout retirer ». */
  .discard {
    flex: none;
    margin-left: auto;
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-dim);
    font-size: 0.7rem;
    padding: 0.15rem 0.45rem;
    border-radius: 4px;
    cursor: pointer;
    white-space: nowrap;
  }
  .discard:not(:disabled) {
    color: var(--danger);
    border-color: var(--danger-border);
  }
  .discard:hover:not(:disabled) {
    background: var(--danger-bg);
  }
  .discard:disabled {
    opacity: 0.4;
    cursor: default;
  }

  /* ── Confirmation ── */
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 50;
    background: transparent;
    border: none;
    padding: 0;
    cursor: default;
  }
  /* Ancrée sous l'en-tête et large comme la colonne : la sidebar est trop
     étroite pour un panneau qui choisirait sa propre largeur. */
  .confirm {
    position: absolute;
    z-index: 51;
    top: 100%;
    left: 0.5rem;
    right: 0.5rem;
    margin-top: 0.25rem;
    padding: 0.6rem;
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 8px 24px var(--shadow-color);
  }
  .c-title {
    margin: 0 0 0.35rem;
    font-size: 0.8rem;
    font-weight: 600;
  }
  .c-text {
    margin: 0 0 0.6rem;
    color: var(--text-dim);
    font-size: 0.75rem;
    line-height: 1.35;
  }
  .c-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.4rem;
  }
  .c-actions button {
    font-size: 0.75rem;
    padding: 0.2rem 0.6rem;
    border-radius: 4px;
    cursor: pointer;
  }
  .c-cancel {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text);
  }
  .c-cancel:hover {
    border-color: var(--accent);
  }
  .c-ok {
    background: var(--danger);
    border: 1px solid var(--danger);
    color: var(--accent-text);
  }
  .c-ok:hover {
    filter: brightness(1.1);
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
    color: var(--accent-text);
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
    color: var(--ok);
    border-color: var(--ok-border);
  }
  .sec-action.unstage:not(:disabled) {
    color: var(--danger);
    border-color: var(--danger-border);
  }
  .sec-action.stage:hover:not(:disabled) {
    background: var(--ok-bg);
  }
  .sec-action.unstage:hover:not(:disabled) {
    background: var(--danger-bg);
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
