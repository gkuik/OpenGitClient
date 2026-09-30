<script lang="ts">
  import { errorMessage, t } from "../i18n.svelte";
  import { repo, tabs } from "../stores/repo.svelte";
  import type { PullRequestEntry } from "../types";
  import SectionHeader from "./SectionHeader.svelte";
  import Chevron from "./Chevron.svelte";

  /*
    Section PULL REQUESTS de la colonne de gauche.

    C'est la seule section des deux barres latérales qui ne montre pas le
    contenu du dépôt : une PR ne vit ni dans `refs/**` ni dans l'index, mais
    dans l'API d'une forge. Deux conséquences visibles ici, et nulle part
    ailleurs dans l'application :

    - **elle peut échouer sans que rien ne soit cassé** (jeton absent, réseau
      coupé), donc elle affiche son propre message plutôt que de passer par le
      bandeau d'erreur global — qui ferait écran à tout le reste pour une
      colonne d'information ;
    - **elle ne se rafraîchit pas toute seule**. Le surveillant de fichiers ne
      sait rien des PR, et sonder l'API grillerait le quota du jeton. D'où le
      bouton ↻ dans l'en-tête, en plus des rechargements à l'ouverture de
      l'onglet et après un fetch ou un push.

    Le classement en trois groupes est fait ici et non par le backend, qui ne
    renvoie que des faits (`mine`, `assigned`, `reviewing`) : c'est la même
    répartition des rôles que pour le graph, dont les couloirs se déduisent
    d'une simple liste de commits.
  */
  let {
    open,
    onToggle,
    first = false,
    onMenu,
  }: {
    open: boolean;
    onToggle: () => void;
    first?: boolean;
    /** Ouvre le menu contextuel d'une PR (rendu par `BranchSidebar`, comme les
     * deux autres menus de la colonne). */
    onMenu: (pr: PullRequestEntry, x: number, y: number) => void;
  } = $props();

  /*
    Les trois groupes de GitKraken, plus un quatrième qui n'y est pas.

    Sans lui, une PR ouverte par quelqu'un d'autre et qui ne nous concerne pas
    serait chargée, comptée dans l'en-tête… et invisible : le compteur
    mentirait. Il n'apparaît que lorsqu'il a quelque chose à contenir, donc sur
    un dépôt personnel la section ressemble exactement à la capture.

    « Assignées » exclut les nôtres — une PR qu'on a ouverte et qu'on s'est
    assignée reste la nôtre, la lister deux fois n'apprendrait rien. « Ma
    revue » ne peut pas être des nôtres : GitHub ne demande pas à l'auteur de
    relire son propre travail.
  */
  const groups = $derived([
    {
      id: "mine",
      label: t("pr.group.mine"),
      items: repo.prFiltered.filter((pr) => pr.mine),
    },
    {
      id: "assigned",
      label: t("pr.group.assigned"),
      items: repo.prFiltered.filter((pr) => pr.assigned && !pr.mine),
    },
    {
      id: "review",
      label: t("pr.group.review"),
      items: repo.prFiltered.filter((pr) => pr.reviewing),
    },
    {
      id: "others",
      label: t("pr.group.others"),
      items: repo.prFiltered.filter(
        (pr) => !pr.mine && !pr.assigned && !pr.reviewing,
      ),
    },
  ].filter((g) => g.id !== "others" || g.items.length > 0));

  /** Compteur de l'en-tête : ce que la section montre, doublons compris une
   * seule fois — c'est le nombre de PR retenues par les filtres. */
  const total = $derived(repo.prFiltered.length);

  /** Menu des filtres (l'entonnoir), positionné en coordonnées fenêtre. */
  let filterMenu = $state<{ x: number; y: number } | null>(null);
  const FILTER_MENU_W = 236;

  function openFilterMenu(e: MouseEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    filterMenu = {
      x: Math.max(8, Math.min(r.right - FILTER_MENU_W, window.innerWidth - FILTER_MENU_W - 8)),
      y: r.bottom + 2,
    };
  }

  /** Ce qu'un survol doit dire d'une PR, que la ligne tronque forcément. */
  function hint(pr: PullRequestEntry): string {
    const state = pr.merged
      ? t("pr.state.merged")
      : pr.closed
        ? t("pr.state.closed")
        : pr.draft
          ? t("pr.state.draft")
          : t("pr.state.open");
    return `#${pr.number} · ${pr.title}\n${pr.author} · ${pr.sourceBranch} → ${pr.targetBranch}\n${state}`;
  }
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === "Escape") filterMenu = null;
  }}
/>

<section class:open>
  <SectionHeader
    label={t("pr.title")}
    icon={prIcon}
    count={total}
    {open}
    {onToggle}
    {first}
    actions={headerActions}
  />

  {#if open}
    <div class="sec-body">
      {#if repo.prLoading && !repo.prLoaded}
        <p class="note">{t("common.loading")}</p>
      {:else if repo.prError}
        <!-- Le message dit quoi faire, pas seulement ce qui a raté : ces deux
             échecs-là se règlent dans les Réglages, en deux clics. -->
        <p class="note">{errorMessage(repo.prError)}</p>
        {#if repo.prError.kind === "ForgeToken" || repo.prError.kind === "ForgeAuth"}
          <button class="link" onclick={() => tabs.openSettings()}>
            {t("pr.settings")}
          </button>
        {:else}
          <button class="link" onclick={() => repo.loadPullRequests()}>{t("action.retry")}</button>
        {/if}
      {:else if total === 0}
        <p class="note">{t("pr.empty")}</p>
      {:else}
        {#each groups as group (group.id)}
          {@const groupOpen = repo.isPrGroupOpen(group.id)}
          <button
            class="group"
            onclick={() => repo.togglePrGroup(group.id)}
            aria-expanded={groupOpen}
          >
            <Chevron open={groupOpen} />
            <span class="gname">{group.label}</span>
            <span class="gcount">{group.items.length}</span>
          </button>
          {#if groupOpen}
            {#each group.items as pr (pr.number)}
              <div
                class="pr"
                role="button"
                tabindex="0"
                title={hint(pr)}
                onclick={() => repo.selectPullRequest(pr)}
                oncontextmenu={(e) => {
                  e.preventDefault();
                  onMenu(pr, e.clientX, e.clientY);
                }}
                onkeydown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    repo.selectPullRequest(pr);
                  } else if (e.key === "ContextMenu") {
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    onMenu(pr, r.left, r.bottom);
                  }
                }}
              >
                <span class="line">
                  <span class="num">#{pr.number}</span>
                  <span class="ptitle">{pr.title}</span>
                  {#if pr.draft}<span class="tag draft">{t("pr.state.draft")}</span>{/if}
                  {#if pr.merged}<span class="tag merged">{t("pr.state.merged")}</span>
                  {:else if pr.closed}<span class="tag closed">{t("pr.state.closed")}</span>{/if}
                </span>
                <span class="line sub">
                  <span class="pbranch">{pr.sourceBranch}</span>
                  <span class="arrow">→</span>
                  <span class="pbranch">{pr.targetBranch}</span>
                  {#if pr.author}<span class="author">{pr.author}</span>{/if}
                </span>
                <button
                  class="kebab"
                  title={t("pr.actions")}
                  aria-label={t("pr.actions")}
                  onclick={(e) => {
                    e.stopPropagation();
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    onMenu(pr, r.right - 200, r.bottom + 2);
                  }}
                >
                  ⋮
                </button>
              </div>
            {/each}
          {/if}
        {/each}
      {/if}
    </div>
  {/if}
</section>

<!-- Menu des filtres. Deux cases, et une seule des deux repasse par le réseau —
     l'infobulle le dit, pour qu'un clic qui recharge ne soit pas une surprise. -->
{#if filterMenu}
  <button
    class="ctx-overlay"
    aria-label={t("common.closeMenu")}
    onclick={() => (filterMenu = null)}
    oncontextmenu={(e) => {
      e.preventDefault();
      filterMenu = null;
    }}
  ></button>
  <div
    class="ctx-menu filter-menu"
    style="left: {filterMenu.x}px; top: {filterMenu.y}px"
    role="menu"
  >
    <p class="ctx-head">{t("pr.filter.head")}</p>
    <button
      class="ctx-item"
      role="menuitemcheckbox"
      aria-checked={repo.prIncludeDrafts}
      title={t("pr.filter.drafts.hint")}
      onclick={() => repo.togglePrDrafts()}
    >
      <span class="check">{repo.prIncludeDrafts ? "☑" : "☐"}</span>
      <span>{t("pr.filter.drafts")}</span>
    </button>
    <button
      class="ctx-item"
      role="menuitemcheckbox"
      aria-checked={repo.prIncludeClosed}
      title={t("pr.filter.closed.hint")}
      onclick={() => {
        filterMenu = null;
        void repo.togglePrClosed();
      }}
    >
      <span class="check">{repo.prIncludeClosed ? "☑" : "☐"}</span>
      <span>{t("pr.filter.closed")}</span>
    </button>
  </div>
{/if}

<!-- Bouton de rechargement, dans l'en-tête : rien ne rapatrie les PR tout seul. -->
<!-- L'entonnoir et le rechargement, contre le bord droit de l'en-tête. Les
     deux touchent la liste, mais pas au même prix : l'entonnoir cache les
     brouillons sur place et ne redemande la liste à la forge que pour les
     fermées ; le ↻ la redemande toujours. -->
{#snippet headerActions()}
  <button
    class="hdr funnel"
    class:on={filterMenu !== null}
    title={t("pr.filter")}
    aria-label={t("pr.filter")}
    onclick={(e) => {
      e.stopPropagation();
      openFilterMenu(e);
    }}
  >
    {@render funnelIcon()}
  </button>
  <button
    class="hdr reload"
    title={repo.prReport
      ? t("pr.reload.repo", { repo: repo.prReport.repo })
      : t("pr.reload")}
    aria-label={t("pr.reload")}
    disabled={repo.prLoading}
    onclick={(e) => {
      e.stopPropagation();
      void repo.loadPullRequests();
    }}
  >
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
      <path d="M13.4 9.2A5.5 5.5 0 1 1 12 4.2" />
      <path d="M9.4 4.6 12 4.2l-.4-2.6" />
    </svg>
  </button>
{/snippet}

<!-- Deux traits qui divergent puis se rejoignent par une flèche : une branche
     proposée à une autre — la fusion demandée, pas encore faite. -->
{#snippet prIcon()}
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="4" cy="3.5" r="1.6" />
    <circle cx="4" cy="12.5" r="1.6" />
    <circle cx="12" cy="12.5" r="1.6" />
    <path d="M4 5.1v5.8" />
    <path d="M12 10.9V6.5a2 2 0 0 0-2-2H7.5" />
    <path d="M9 2.9 7.2 4.5 9 6.1" />
  </svg>
{/snippet}

{#snippet funnelIcon()}
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
    <path d="M2.5 3.5h11l-4.2 5v4l-2.6 1.3V8.5z" />
  </svg>
{/snippet}

<style>
  /* Même gabarit que les sections voisines : la grille est ce qui permet au
     corps de défiler chez lui sans que WKWebView ne gèle la section sur la
     hauteur de son en-tête (voir la note dans `BranchSidebar`). */
  section {
    user-select: none;
    -webkit-user-select: none;
    overflow: hidden;
  }
  section.open {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    flex: 1 1 0;
    min-height: 0;
    max-height: max-content;
  }
  section:not(.open) {
    flex: none;
  }
  .sec-body {
    min-height: 0;
    overflow-y: auto;
    padding: 0.3rem var(--sec-inset) 0.6rem;
  }
  .hdr {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.4rem;
    height: 1.4rem;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: var(--text-dim);
    cursor: pointer;
  }
  .hdr svg {
    display: block;
    width: 13px;
    height: 13px;
  }
  .hdr:hover:not(:disabled) {
    background: var(--bg-raised);
    color: var(--text);
  }
  .hdr:disabled {
    color: var(--text-faint);
    cursor: default;
  }
  .funnel.on {
    background: var(--bg-raised);
    color: var(--text);
  }
  /* Ligne de groupe, calquée sur le nœud de distant de la section REMOTE. */
  .group {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    width: 100%;
    background: transparent;
    border: none;
    padding: 0.25rem 0.5rem 0.25rem var(--row-inset);
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.82rem;
    text-align: left;
    color: var(--text-dim);
  }
  .group:hover {
    background: var(--bg-raised);
  }
  .gname {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .gcount {
    flex: none;
    font-size: 0.72rem;
    color: var(--text-faint);
  }
  /* Une PR tient sur deux lignes : ce qui l'identifie, puis d'où elle vient.
     Le retrait la range sous son groupe, comme une branche sous son dossier. */
  .pr {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    padding: 0.25rem 1.6rem 0.25rem calc(var(--row-inset) + 12px);
    border-radius: 4px;
    cursor: pointer;
  }
  .pr:hover {
    background: var(--bg-raised);
  }
  .line {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    min-width: 0;
    font-size: 0.82rem;
  }
  .line.sub {
    font-size: 0.72rem;
    color: var(--text-faint);
  }
  .num {
    flex: none;
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
  }
  .ptitle {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text);
  }
  .pbranch {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .arrow {
    flex: none;
  }
  .author {
    flex: none;
    margin-left: auto;
    padding-left: 0.3rem;
    color: var(--text-dim);
  }
  /* Étiquettes d'état. Le brouillon est neutre (ce n'est pas un problème), la
     fusion réussie est verte, l'abandon rouge — les mêmes jetons que partout. */
  .tag {
    flex: none;
    padding: 0 0.3rem;
    border-radius: 999px;
    font-size: 0.62rem;
    line-height: 1.5;
  }
  .tag.draft {
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text-dim);
  }
  .tag.merged {
    background: var(--ok-bg);
    color: var(--ok-soft);
  }
  .tag.closed {
    background: var(--danger-bg);
    color: var(--danger-soft);
  }
  .kebab {
    position: absolute;
    top: 0.25rem;
    right: 0.2rem;
    width: 1.3rem;
    height: 1.3rem;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: var(--text-dim);
    font-size: 1rem;
    line-height: 1;
    cursor: pointer;
    opacity: 0;
  }
  .pr:hover .kebab,
  .pr:focus-within .kebab {
    opacity: 1;
  }
  .kebab:hover {
    background: var(--bg);
    color: var(--text);
  }
  /* Messages de la section : chargement, jeton manquant, réseau. Ils restent
     ici plutôt que dans le bandeau global — rien n'est cassé ailleurs. */
  .note {
    margin: 0;
    padding: 0.3rem var(--row-inset);
    color: var(--text-dim);
    font-size: 0.75rem;
    line-height: 1.35;
  }
  .link {
    display: block;
    margin: 0 var(--row-inset) 0.3rem;
    padding: 0;
    background: transparent;
    border: none;
    color: var(--accent-soft);
    font-size: 0.75rem;
    text-align: left;
    cursor: pointer;
  }
  .link:hover {
    text-decoration: underline;
  }

  /* ── Menu des filtres ──
     Même gabarit que les menus de `BranchSidebar` ; il vit ici parce qu'il
     n'appartient qu'à cette section, contrairement à celui des PR, qui se
     déclenche depuis une ligne et se range avec les autres menus de la colonne. */
  /* Superposition, boîte, en-tête et entrées sont dans `app.css`, partagés avec
     les menus de la colonne des branches et celui du bouton Pull. Ne reste ici
     que la largeur de celui-ci et sa case à cocher. */
  .filter-menu {
    min-width: 236px;
  }
  .check {
    flex: none;
    width: 0.9rem;
    color: var(--text-faint);
  }
</style>
