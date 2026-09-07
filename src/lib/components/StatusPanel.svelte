<script lang="ts">
  import { t } from "../i18n.svelte";
  import { repo } from "../stores/repo.svelte";
  import FileList from "./FileList.svelte";
  import SectionHeader from "./SectionHeader.svelte";

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
    <p class="empty">{t("common.noRepo")}</p>
  {:else}
    <!-- En-tête : « N changements sur <branche> », le tout aligné à gauche. -->
    <div class="sb-head">
      <span class="count">{t("status.changes", { n: repo.changeCount })}</span>
      {#if repo.repoInfo.branch}
        <span class="on">{t("status.on")}</span>
        <span class="branch" title={repo.repoInfo.branch}>⎇ {repo.repoInfo.branch}</span>
      {:else if repo.repoInfo.isDetached}
        <span class="on">{t("status.on")}</span>
        <span class="branch detached">{t("status.detachedHead")}</span>
      {/if}

      <button
        class="discard"
        onclick={() => (confirming = !confirming)}
        disabled={repo.changeCount === 0 || repo.busy}
        title={t("status.discardAll.hint")}
        aria-expanded={confirming}
      >
        {t("status.discardAll")}
      </button>

      {#if confirming}
        <!-- Superposition qui referme au clic à côté, comme les menus de la
             colonne de gauche. -->
        <button
          class="scrim"
          aria-label={t("action.cancel")}
          onclick={() => (confirming = false)}
        ></button>
        <div class="confirm" role="dialog" aria-label={t("status.discard.title")}>
          <p class="c-title">{t("status.discard.title")}</p>
          <p class="c-text">
            {#if trackedCount > 0}{t("status.discard.tracked", { n: trackedCount })}{/if}
            {#if untrackedCount > 0}{t("status.discard.untracked", { n: untrackedCount })}{/if}
            {t("status.discard.warning")}
          </p>
          <div class="c-actions">
            <button class="c-cancel" onclick={() => (confirming = false)}>
              {t("action.cancel")}
            </button>
            <button class="c-ok" onclick={discard}>{t("status.discardAll")}</button>
          </div>
        </div>
      {/if}
    </div>

    <!-- Barre d'outils : tri + bascule Path / Tree. -->
    <div class="toolbar">
      <button
        class="sort"
        onclick={() => repo.toggleSort()}
        title={repo.sortAsc ? t("status.sort.asc") : t("status.sort.desc")}
        aria-label={t("status.sort.toggle")}
      >
        {repo.sortAsc ? "↑A" : "↓Z"}
      </button>
      <div class="seg">
        <button class:active={repo.viewMode === "path"} onclick={() => repo.setViewMode("path")}>
          {t("status.view.path")}
        </button>
        <button class:active={repo.viewMode === "tree"} onclick={() => repo.setViewMode("tree")}>
          {t("status.view.tree")}
        </button>
      </div>
    </div>

    <!--
      Les deux sections se partagent la hauteur disponible et défilent
      indépendamment ; le trait qui sépare « non indexés » d'« indexés » vient de
      leur en-tête commun, comme dans la colonne de gauche.
    -->
    <div class="sections">
      <section class:collapsed={!unstagedOpen}>
        <SectionHeader
          label={t("status.unstaged")}
          icon={pencilIcon}
          count={unstagedCount}
          open={unstagedOpen}
          onToggle={() => (unstagedOpen = !unstagedOpen)}
          actions={stageAction}
        />
        {#if unstagedOpen}
          <div class="sec-body">
            <FileList entries={repo.unstagedEntries} staged={false} />
          </div>
        {/if}
      </section>

      <section class:collapsed={!stagedOpen}>
        <SectionHeader
          label={t("status.staged")}
          icon={checkIcon}
          count={stagedCount}
          open={stagedOpen}
          onToggle={() => (stagedOpen = !stagedOpen)}
          actions={unstageAction}
        />
        {#if stagedOpen}
          <div class="sec-body">
            <FileList entries={repo.stagedEntries} staged={true} />
          </div>
        {/if}
      </section>
    </div>
  {/if}
</div>

<!-- Crayon : ce qui est encore en cours d'écriture, comme le ✎ de la ligne WIP. -->
{#snippet pencilIcon()}
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round">
    <path d="M11.2 2.6a1.6 1.6 0 0 1 2.2 2.2L6.1 12.2l-3 .8.8-3z" />
    <path d="M10.2 3.6l2.2 2.2" stroke-linecap="round" />
  </svg>
{/snippet}

<!-- Case cochée : ce qui est retenu pour le prochain commit. -->
{#snippet checkIcon()}
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round">
    <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
    <path d="M5.4 8.2 7.2 10l3.4-3.8" stroke-linecap="round" />
  </svg>
{/snippet}

{#snippet stageAction()}
  <button
    class="sec-action stage"
    onclick={() => repo.stageAll()}
    disabled={unstagedCount === 0 || repo.busy}
  >
    {t("status.stageAll")}
  </button>
{/snippet}

{#snippet unstageAction()}
  <button
    class="sec-action unstage"
    onclick={() => repo.unstageAll()}
    disabled={stagedCount === 0 || repo.busy}
  >
    {t("status.unstageAll")}
  </button>
{/snippet}

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
  /* Une section est une liste sur laquelle on agit, pas de la prose : y
     sélectionner du texte gênerait le clic sans rien apporter. Ce qui se copie —
     le titre et la description d'un commit — vit hors de toute section, et garde
     donc la sélection par défaut. */
  section {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    user-select: none;
    -webkit-user-select: none;
  }
  /* Repliée : la section ne garde que la hauteur de son en-tête. */
  section.collapsed {
    flex: none;
  }
  /* En-tête et trait de séparation : voir `SectionHeader`, commun aux deux
     colonnes latérales. */
  .sec-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0.3rem var(--sec-inset) 0.6rem;
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
  .empty {
    color: var(--text-dim);
    font-size: 0.8rem;
    padding: 1rem 0.7rem;
  }
</style>
