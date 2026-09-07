<script lang="ts">
  import { t } from "../i18n.svelte";
  import { repo, tabs } from "../stores/repo.svelte";
  import { branchMerge } from "../branchMerge.svelte";
  import { buildBranchTree, buildRemoteTree } from "../tree";
  import type { Snippet } from "svelte";
  import type { MergeMode, PullMode, PullRequestEntry } from "../types";
  import BranchRow from "./BranchRow.svelte";
  import RichText from "./RichText.svelte";
  import PullRequestSection from "./PullRequestSection.svelte";
  import SectionHeader from "./SectionHeader.svelte";
  import Chevron from "./Chevron.svelte";

  // ── Menu du bouton Pull ─────────────────────────────────────────────────────
  // L'entrée « rebase » est là pour dire ce qui existera, mais désactivée : il
  // n'y a pas de mode correspondant côté backend, donc rien à envoyer.
  const PULL_ENTRIES: { mode: PullMode | null; label: string; hint: string }[] = $derived([
    {
      mode: "fetchAll",
      label: t("toolbar.pull.fetchAll"),
      hint: t("toolbar.pull.fetchAll.hint"),
    },
    {
      mode: "fastForwardOrMerge",
      label: t("toolbar.pull.fastForwardOrMerge"),
      hint: t("toolbar.pull.fastForwardOrMerge.hint"),
    },
    {
      mode: "fastForwardOnly",
      label: t("toolbar.pull.fastForwardOnly"),
      hint: t("toolbar.pull.fastForwardOnly.hint"),
    },
    {
      mode: null,
      label: t("toolbar.pull.rebase"),
      hint: t("toolbar.pull.rebase.hint"),
    },
  ]);

  const currentPull = $derived(
    PULL_ENTRIES.find((e) => e.mode === tabs.pullMode) ?? PULL_ENTRIES[1],
  );

  /** Position du menu du bouton Pull, en coordonnées fenêtre. */
  let pullMenu = $state<{ x: number; y: number } | null>(null);
  const PULL_MENU_W = 268;

  function openPullMenu(e: MouseEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    // Aligné sous le bouton, ramené dans la fenêtre s'il déborde à droite.
    pullMenu = {
      x: Math.max(8, Math.min(r.left, window.innerWidth - PULL_MENU_W - 8)),
      y: r.bottom + 2,
    };
  }

  function choosePull(mode: PullMode) {
    pullMenu = null;
    // Choisir ne déclenche rien : le menu fixe ce que **le bouton** fera.
    void tabs.setPullMode(mode);
  }

  // D'autres catégories (TAGS…) viendront s'ajouter ici : chacune est une
  // <section> autonome sur ce même modèle.
  let localOpen = $state(true);
  let remotesOpen = $state(true);
  let prOpen = $state(true);
  let stashesOpen = $state(true);

  // REMOTE disparaît quand il n'y a rien à y mettre : un dépôt sans distant n'a
  // pas à porter une section vide, et elle réapparaît d'elle-même au premier
  // fetch qui ramène une référence.
  const hasRemotes = $derived(repo.remoteBranches.length > 0);

  // PULL REQUESTS disparaît pour les deux seuls échecs qui n'attendent rien de
  // personne : aucun distant, ou un hôte dont on ne sait pas lire les PR. Un
  // jeton manquant, lui, laisse la section en place — elle a un message et un
  // chemin à proposer (voir `RepoStore.prSupported`).
  const hasPullRequests = $derived(repo.prSupported);

  // Les sections **rendues**, dans l'ordre du DOM. Les deux repères ci-dessous
  // se lisent dessus plutôt que sur des indices figés : avec un indice, une
  // section masquée continuerait de compter et les deux tomberaient à côté.
  const shown = $derived([
    { id: "local", open: localOpen },
    ...(hasRemotes ? [{ id: "remotes", open: remotesOpen }] : []),
    ...(hasPullRequests ? [{ id: "pulls", open: prOpen }] : []),
    { id: "stashes", open: stashesOpen },
  ]);

  // Les sections repliées descendent en bas de la colonne (`order` en CSS) ;
  // la **première** d'entre elles porte la marge automatique qui les y colle —
  // une marge par section repliée se partagerait l'espace libre et les
  // éparpillerait.
  const firstClosed = $derived(shown.find((s) => !s.open)?.id ?? null);
  // Le trait de séparation se calcule ici et pas en CSS : `order` dissocie
  // l'ordre du DOM de l'ordre affiché, donc un `section + section` désignerait
  // la mauvaise. La section en tête de colonne est la première ouverte — ou, si
  // tout est replié, la première tout court.
  const firstVisual = $derived((shown.find((s) => s.open) ?? shown[0]).id);

  const nodes = $derived(buildBranchTree(repo.branches));
  // Un niveau de plus que LOCAL : le distant, puis son arborescence.
  const remotes = $derived(buildRemoteTree(repo.remoteBranches));

  // ── Menu contextuel des stashes ─────────────────────────────────────────────
  // Une seule instance ouverte à la fois, positionnée en coordonnées fenêtre.
  let menu = $state<{ x: number; y: number; index: number } | null>(null);
  // La suppression est irréversible : elle demande une confirmation en deux temps
  // dans le menu, sans dialogue natif (aucune capacité de confirmation déclarée).
  let confirmDrop = $state(false);

  const MENU_W = 184;
  const MENU_H = 148;

  function openAt(x: number, y: number, index: number) {
    // Garde le menu entièrement visible dans la fenêtre.
    menu = {
      x: Math.max(8, Math.min(x, window.innerWidth - MENU_W - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - MENU_H - 8)),
      index,
    };
    confirmDrop = false;
  }

  function openFromMouse(e: MouseEvent, index: number) {
    e.preventDefault();
    openAt(e.clientX, e.clientY, index);
  }

  function openFromKey(e: KeyboardEvent, index: number) {
    if (e.key === "Enter" || e.key === " " || e.key === "ContextMenu") {
      e.preventDefault();
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      openAt(r.left, r.bottom, index);
    }
  }

  function openFromKebab(e: MouseEvent, index: number) {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    // Aligné sur le bord droit du bouton, juste en dessous.
    openAt(r.right - MENU_W, r.bottom + 2, index);
  }

  function close() {
    menu = null;
    confirmDrop = false;
  }

  async function apply(pop: boolean) {
    const index = menu?.index;
    close();
    if (index !== undefined) await repo.applyStash(index, pop);
  }

  async function drop() {
    const index = menu?.index;
    close();
    if (index !== undefined) await repo.dropStash(index);
  }

  // ── Menu de la fusion de branches ───────────────────────────────────────────
  // La demande vient du module : d'un dépôt d'une branche sur une autre, ou d'un
  // clic droit sur une ligne (voir `branchMerge.svelte.ts`). Le menu est rendu
  // ici, une fois pour la colonne, comme celui des stashes.
  const MERGE_MENU_W = 300;
  const MERGE_MENU_H = 156;

  /** Position du menu, ramenée dans la fenêtre. */
  const mergeMenuPos = $derived(
    branchMerge.request === null
      ? null
      : {
          x: Math.max(8, Math.min(branchMerge.request.x, window.innerWidth - MERGE_MENU_W - 8)),
          y: Math.max(8, Math.min(branchMerge.request.y, window.innerHeight - MERGE_MENU_H - 8)),
        },
  );

  // Une fusion écrit l'index et le working directory : elle attend que ce qui
  // tourne déjà soit fini, et une fusion en cours doit d'abord être close.
  const canMerge = $derived(
    !repo.mergingBranches && !repo.checkingOut && !repo.busy && !repo.merging,
  );
  const busyHint = $derived(t("branches.merge.busy"));

  // ── Menu contextuel d'une pull request ──────────────────────────────────────
  // Rendu ici comme les deux autres menus de la colonne : le geste part d'une
  // ligne de la section, mais le menu appartient à la colonne — une seule
  // instance ouverte à la fois, positionnée en coordonnées fenêtre.
  let prMenu = $state<{ x: number; y: number; pr: PullRequestEntry } | null>(null);
  const PR_MENU_W = 236;
  const PR_MENU_H = 96;

  function openPrMenu(pr: PullRequestEntry, x: number, y: number) {
    prMenu = {
      x: Math.max(8, Math.min(x, window.innerWidth - PR_MENU_W - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - PR_MENU_H - 8)),
      pr,
    };
  }

  function openPrInBrowser() {
    const pr = prMenu?.pr;
    prMenu = null;
    if (pr) void repo.openPullRequest(pr);
  }

  async function runMerge(mode: MergeMode) {
    const request = branchMerge.request;
    branchMerge.close();
    if (request) await repo.mergeBranches(request.source, request.target, mode);
  }
</script>

<!-- Échap ferme les trois menus : stashes, bouton Pull et fusion. (Pendant un
     glissement, la même touche l'abandonne — c'est le module qui l'écoute.) -->
<svelte:window
  onkeydown={(e) => {
    if (e.key !== "Escape") return;
    close();
    pullMenu = null;
    prMenu = null;
    branchMerge.close();
  }}
/>

<nav class="branches">
  {#if !repo.repoInfo}
    <p class="empty">{t("common.noRepo")}</p>
  {:else}
    <!--
      Barre d'actions du dépôt. Elle vit hors de la zone défilante : elle reste
      visible quand on parcourt une longue liste de branches, et elle n'entre pas
      en conflit avec les en-têtes de section, qui sont `sticky` en haut de
      celle-ci. D'autres commandes viendront s'ajouter à la suite.
    -->
    <div class="toolbar">
      <div class="actions">
        {@render action({
          label: "Pull",
          icon: pullIcon,
          hint: currentPull.hint,
          run: currentPull.mode ? () => repo.pull(currentPull.mode!) : undefined,
          busy: repo.busyRemote,
          count: repo.currentGap?.behind,
          menu: openPullMenu,
        })}
        {@render action({
          label: t("toolbar.push"),
          icon: pushIcon,
          hint: t("toolbar.push.hint"),
          run: () => repo.push(),
          busy: repo.busyRemote,
          count: repo.currentGap?.ahead,
        })}
        {@render action({
          label: t("toolbar.fetch"),
          icon: fetchIcon,
          hint: t("toolbar.fetch.hint"),
          run: () => repo.fetch(),
          busy: repo.busyRemote,
        })}
      </div>
      <!-- Compte rendu partagé : le backend ne laisse pas un fetch et un push se
           croiser sur un même dépôt. Sans lui, un fetch qui ne ramène rien
           n'aurait aucun effet visible, la section REMOTE restant identique. -->
      {#if repo.fetching}
        <p class="status">{t("toolbar.status.fetching")}</p>
      {:else if repo.pushing}
        <p class="status">{t("toolbar.status.pushing")}</p>
      {:else if repo.pulling}
        <p class="status">{t("toolbar.status.pulling")}</p>
      {:else if repo.mergingBranches}
        <p class="status">{t("toolbar.status.merging")}</p>
      {:else if repo.opStatus}
        <p class="status">{repo.opStatus}</p>
      {/if}
    </div>

    <div class="sections">
      <section class:open={localOpen} class:pinned={firstClosed === "local"}>
        <SectionHeader
          label={t("branches.local")}
          icon={branchIcon}
          count={repo.branches.length}
          open={localOpen}
          onToggle={() => (localOpen = !localOpen)}
          first={firstVisual === "local"}
        />

        {#if localOpen}
          <div class="sec-body">
            {#each nodes as node (node.type === "dir" ? "d:" + node.path : "b:" + node.branch.name)}
              <BranchRow {node} />
            {:else}
              <p class="empty small">{t("branches.empty")}</p>
            {/each}
          </div>
        {/if}
      </section>

      {#if hasRemotes}
        <section class:open={remotesOpen} class:pinned={firstClosed === "remotes"}>
          <SectionHeader
            label={t("branches.remote")}
            icon={remoteIcon}
            count={repo.remoteBranches.length}
            open={remotesOpen}
            onToggle={() => (remotesOpen = !remotesOpen)}
            first={firstVisual === "remotes"}
          />

          {#if remotesOpen}
            <div class="sec-body">
              <!--
                Un nœud par distant, replié avec les mêmes clés que les dossiers de
                branches : les chemins gardent le préfixe du distant, donc plier
                « origin/feature » ne plie pas le « feature » de la section LOCAL.
              -->
              {#each remotes as group (group.remote)}
                {@const open = repo.isBranchDirOpen(group.remote)}
                <button
                  class="remote-node"
                  onclick={() => repo.toggleBranchDir(group.remote)}
                  aria-expanded={open}
                  title={group.remote}
                >
                  <Chevron {open} />
                  {@render remoteIcon()}
                  <span class="rname">{group.remote}</span>
                  <span class="rcount">{group.branches.length}</span>
                </button>
                {#if open}
                  {#each group.nodes as node (node.type === "dir" ? "d:" + node.path : "b:" + node.branch.name)}
                    <BranchRow {node} depth={1} />
                  {/each}
                {/if}
              {/each}
            </div>
          {/if}
        </section>
      {/if}

      <!-- La `<section>` est portée par le composant : elle est donc fille
           directe de `.sections`, au même titre que les trois autres, et c'est
           lui qui reprend à son compte les règles de répartition (part de
           hauteur, renvoi en bas quand elle est repliée) — les règles d'ici
           sont scopées et ne l'atteindraient pas. -->
      {#if hasPullRequests}
        <PullRequestSection
          open={prOpen}
          onToggle={() => (prOpen = !prOpen)}
          first={firstVisual === "pulls"}
          pinned={firstClosed === "pulls"}
          onMenu={openPrMenu}
        />
      {/if}

      <section class:open={stashesOpen} class:pinned={firstClosed === "stashes"}>
        <SectionHeader
          label={t("stashes.title")}
          icon={stashIcon}
          count={repo.stashes.length}
          open={stashesOpen}
          onToggle={() => (stashesOpen = !stashesOpen)}
          first={firstVisual === "stashes"}
        />

        {#if stashesOpen}
          <div class="sec-body">
            {#each repo.stashes as stash (stash.oid)}
              <!--
                Clic droit (ou touche menu / Entrée) ouvre les actions ; le bouton
                « ⋮ » offre le même menu à la souris et au clavier.
              -->
              <div
                class="stash"
                class:active={menu?.index === stash.index}
                role="button"
                tabindex="0"
                title={stash.message}
                oncontextmenu={(e) => openFromMouse(e, stash.index)}
                onkeydown={(e) => openFromKey(e, stash.index)}
              >
                {@render stashIcon()}
                <span class="on">on:</span>
                <span class="sbranch">{stash.branch ?? stash.message}</span>
                <button
                  class="kebab"
                  title={t("stashes.actions")}
                  aria-label={t("stashes.actions")}
                  onclick={(e) => openFromKebab(e, stash.index)}
                >
                  ⋮
                </button>
              </div>
            {:else}
              <p class="empty small">{t("stashes.empty")}</p>
            {/each}
          </div>
        {/if}
      </section>
    </div>
  {/if}
</nav>

<!-- Menu contextuel des stashes : superposition qui ferme + menu positionné. -->
{#if menu}
  <button
    class="ctx-overlay"
    aria-label={t("common.closeMenu")}
    onclick={close}
    oncontextmenu={(e) => {
      e.preventDefault();
      close();
    }}
  ></button>
  <div class="ctx-menu" style="left: {menu.x}px; top: {menu.y}px" role="menu">
    <button class="ctx-item" role="menuitem" onclick={() => apply(false)}>
      {@render applyIcon()}
      <span>{t("stashes.apply")}</span>
    </button>
    <button class="ctx-item" role="menuitem" onclick={() => apply(true)}>
      {@render popIcon()}
      <span>{t("stashes.pop")}</span>
    </button>
    <div class="ctx-sep"></div>
    {#if confirmDrop}
      <button class="ctx-item danger" role="menuitem" onclick={drop}>
        {@render dropIcon()}
        <span>{t("stashes.drop.confirm")}</span>
      </button>
    {:else}
      <button
        class="ctx-item danger"
        role="menuitem"
        onclick={() => (confirmDrop = true)}
      >
        {@render dropIcon()}
        <span>{t("stashes.drop")}</span>
      </button>
    {/if}
  </div>
{/if}

<!--
  Menu de la fusion, même mécanique que les deux autres. Deux entrées, toutes deux
  vivantes : rien n'est grisé ici pour annoncer une suite, le menu ne dit que ce
  qu'il fait.

  La seconde n'est pas un réglage fin : elle décide si la fusion laisse une trace
  dans l'historique. Elle nomme donc son effet, et pas seulement son option.

  L'en-tête n'est pas une redite des libellés : le geste peut faire bouger HEAD,
  ce qu'aucune des lignes ne laisse deviner.
-->
{#if branchMerge.request && mergeMenuPos}
  {@const request = branchMerge.request}
  <button
    class="ctx-overlay"
    aria-label={t("common.closeMenu")}
    onclick={() => branchMerge.close()}
    oncontextmenu={(e) => {
      e.preventDefault();
      branchMerge.close();
    }}
  ></button>
  <div
    class="ctx-menu merge-menu"
    style="left: {mergeMenuPos.x}px; top: {mergeMenuPos.y}px"
    role="menu"
  >
    <p class="ctx-head">{t("branches.merge.head", { target: request.target })}</p>
    <button
      class="ctx-item wrap"
      role="menuitem"
      disabled={!canMerge}
      title={canMerge ? t("branches.merge.item.hint") : busyHint}
      onclick={() => runMerge("fastForwardOrMerge")}
    >
      {@render mergeIcon()}
      <!-- Une seule entrée de catalogue, les deux noms de branches restant en
           gras au milieu de la phrase : `RichText` les met en forme sans la
           découper, donc sans figer l'ordre des mots. -->
      <span>
        <RichText
          key="branches.merge.item"
          params={{
            source: { text: request.source, tag: "strong" },
            target: { text: request.target, tag: "strong" },
          }}
        />
      </span>
    </button>
    <button
      class="ctx-item wrap"
      role="menuitem"
      disabled={!canMerge}
      title={canMerge ? t("branches.merge.noFastForward.hint") : busyHint}
      onclick={() => runMerge("noFastForward")}
    >
      {@render mergeCommitIcon()}
      <span>{t("branches.merge.noFastForward")}</span>
    </button>
  </div>
{/if}

<!-- Étiquette qui suit le curseur pendant le glissement. `pointer-events: none`
     est indispensable : sinon c'est elle que le test du point trouverait sous le
     curseur, jamais la ligne visée. -->
{#if branchMerge.dragging}
  <div class="drag-chip" style="left: {branchMerge.x}px; top: {branchMerge.y}px">
    {@render mergeIcon()}
    <span>{branchMerge.dragging}</span>
  </div>
{/if}

<!-- Menu du bouton Pull : même mécanique que celui des stashes (superposition
     qui ferme, position en coordonnées fenêtre, Échap). -->
{#if pullMenu}
  <button
    class="ctx-overlay"
    aria-label={t("common.closeMenu")}
    onclick={() => (pullMenu = null)}
    oncontextmenu={(e) => {
      e.preventDefault();
      pullMenu = null;
    }}
  ></button>
  <div
    class="ctx-menu pull-menu"
    style="left: {pullMenu.x}px; top: {pullMenu.y}px"
    role="menu"
  >
    <p class="ctx-head">{t("toolbar.pull.menu")}</p>
    {#each PULL_ENTRIES as entry (entry.label)}
      {@const selected = entry.mode !== null && entry.mode === tabs.pullMode}
      <button
        class="ctx-item"
        class:selected
        role="menuitemradio"
        aria-checked={selected}
        disabled={entry.mode === null}
        title={entry.hint}
        onclick={() => entry.mode && choosePull(entry.mode)}
      >
        <span class="radio">{selected ? "◉" : "○"}</span>
        <span>{entry.label}</span>
      </button>
    {/each}
  </div>
{/if}

<!-- Menu d'une pull request. Une seule entrée : la PR s'ouvre sur la forge.
     Rien ne se fusionne ni ne se ferme d'ici — l'application lit les PR, elle
     ne les pilote pas. -->
{#if prMenu}
  <button
    class="ctx-overlay"
    aria-label={t("common.closeMenu")}
    onclick={() => (prMenu = null)}
    oncontextmenu={(e) => {
      e.preventDefault();
      prMenu = null;
    }}
  ></button>
  <div
    class="ctx-menu pr-menu"
    style="left: {prMenu.x}px; top: {prMenu.y}px"
    role="menu"
  >
    <p class="ctx-head">#{prMenu.pr.number} · {prMenu.pr.title}</p>
    <button class="ctx-item" role="menuitem" onclick={openPrInBrowser}>
      {@render externalIcon()}
      <span>{t("pr.open")}</span>
    </button>
  </div>
{/if}

<!--
  Un bouton de la barre d'actions : icône au-dessus, libellé en dessous.
  Ajouter une commande se réduit à un `{@render action(...)}` de plus.

  Un bouton sans `run` est désactivé : c'est le cas de Pull et Push, qui n'ont pas
  encore de backend. Le libellé reste visible pour que la place de la commande
  soit acquise.

  `count` est l'écart de la branche courante avec son amont — ce que le bouton
  traiterait. Zéro et « pas d'amont » ne mettent pas de pastille : elle signale
  du travail en attente, pas une synchronisation vérifiée.
-->
{#snippet action(a: {
  label: string;
  icon: Snippet;
  hint: string;
  run?: () => void;
  busy?: boolean;
  count?: number;
  menu?: (e: MouseEvent) => void;
})}
  <!--
    La flèche vit **dans** la boîte du bouton, pas à côté : c'est le cadre
    `.split` qui porte le fond, la bordure et le survol, les deux boutons
    n'étant que des zones de clic à l'intérieur. Deux `<button>` restent
    nécessaires (on n'imbrique pas un bouton dans un bouton) mais ils se lisent
    comme un seul contrôle, séparés par un filet qui apparaît au survol.
  -->
  <div class="split" class:disabled={!a.run || a.busy}>
    <button
      class="action"
      disabled={!a.run || a.busy}
      title={a.run ? a.hint : `${a.hint} (${t("common.notAvailable")})`}
      onclick={a.run}
    >
      {@render a.icon()}
      <span>{a.label}</span>
      {#if a.count}
        <span class="badge">{a.count}</span>
      {/if}
    </button>
    <!-- Ouvre le menu même quand l'action est indisponible (opération distante
         en cours) : c'est par là qu'on change ce que le bouton fera. -->
    {#if a.menu}
      <button
        class="caret"
        title={t("toolbar.pull.menu.open")}
        aria-label={t("toolbar.pull.menu.open")}
        onclick={a.menu}
      >
        <!-- Chevron dessiné, pas « ▾ » : ce caractère est le triangle *small*
             d'Unicode, qui se rend minuscule quelle que soit la taille de
             police — `font-size` ne peut rien pour lui. En SVG il suit la même
             langue graphique que les autres icônes de la barre, et sa taille
             est enfin réglable. -->
        <svg class="caret-ic" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M2.5 4.5 6 8l3.5-3.5" />
        </svg>
      </button>
    {/if}
  </div>
{/snippet}

{#snippet pullIcon()}
  <!-- Flèche descendante vers une base : le distant vient jusqu'au local. -->
  <svg class="action-ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
    <path d="M8 1.75v7.5" />
    <path d="M4.75 6 8 9.25 11.25 6" />
    <path d="M3 13.25h10" />
  </svg>
{/snippet}

{#snippet fetchIcon()}
  <!-- Flèche circulaire : rapatrie les références sans toucher au working dir. -->
  <svg class="action-ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
    <path d="M13.4 9.2A5.5 5.5 0 1 1 12 4.2" />
    <path d="M9.4 4.6 12 4.2l-.4-2.6" />
  </svg>
{/snippet}

{#snippet pushIcon()}
  <!-- Flèche montante depuis une base : le local part vers le distant. -->
  <svg class="action-ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
    <path d="M8 14.25v-7.5" />
    <path d="M4.75 10 8 6.75 11.25 10" />
    <path d="M3 2.75h10" />
  </svg>
{/snippet}

<!-- Icônes des actions de stash. Trait `currentColor` : suivent la couleur du
     bouton (rouge sur « Supprimer »). -->
{#snippet applyIcon()}
  <!-- Flèche vers le bas dans un bac : ramène le stash dans le working directory. -->
  <svg class="ctx-ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
    <path d="M8 2v6.5" />
    <path d="M5.5 6 8 8.5 10.5 6" />
    <path d="M2.5 10.5v2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2" />
  </svg>
{/snippet}
{#snippet popIcon()}
  <!-- Flèche vers le haut hors du bac : applique puis dépile le stash. -->
  <svg class="ctx-ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
    <path d="M8 13.5V7" />
    <path d="M5.5 9.5 8 7l2.5 2.5" />
    <path d="M2.5 5.5v-1a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v1" />
  </svg>
{/snippet}
{#snippet dropIcon()}
  <!-- Corbeille : retire le stash sans l'appliquer. -->
  <svg class="ctx-ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
    <path d="M3 4.5h10" />
    <path d="M5.5 4.5v-1a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1" />
    <path d="M4.6 4.5l.55 8a1 1 0 0 0 1 .93h3.7a1 1 0 0 0 1-.93l.55-8" />
    <path d="M6.75 7v4M9.25 7v4" />
  </svg>
{/snippet}

<!-- Deux traits qui se rejoignent : une branche versée dans une autre. -->
{#snippet mergeIcon()}
  <svg class="ctx-ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="4" cy="3.25" r="1.75" />
    <circle cx="4" cy="12.75" r="1.75" />
    <circle cx="12" cy="8" r="1.75" />
    <path d="M4 5v6" />
    <path d="M5.6 4.4A6 6 0 0 0 10.3 7.6" />
    <path d="M5.6 11.6A6 6 0 0 1 10.3 8.4" />
  </svg>
{/snippet}

<!-- La même jonction, mais le point de rencontre est plein : un commit y naît. -->
{#snippet mergeCommitIcon()}
  <svg class="ctx-ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="4" cy="3.25" r="1.75" />
    <circle cx="4" cy="12.75" r="1.75" />
    <circle cx="12" cy="8" r="1.75" fill="currentColor" />
    <path d="M4 5v6" />
    <path d="M5.6 4.4A6 6 0 0 0 10.3 7.6" />
    <path d="M5.6 11.6A6 6 0 0 1 10.3 8.4" />
  </svg>
{/snippet}

<!-- Flèche sortant d'un cadre : la page part hors de l'application. -->
{#snippet externalIcon()}
  <svg class="ctx-ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
    <path d="M7 3.5H3.5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V9" />
    <path d="M9.5 2.5h4v4" />
    <path d="M13.5 2.5 7.5 8.5" />
  </svg>
{/snippet}

<!-- Écran : la machine, par opposition au nuage du distant. -->
{#snippet branchIcon()}
  <svg class="ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round">
    <rect x="2.5" y="3" width="11" height="7.5" rx="1" />
    <path d="M1 12.5h14" stroke-linecap="round" />
  </svg>
{/snippet}

<!-- Nuage : le dépôt distant, par opposition aux branches locales. -->
{#snippet remoteIcon()}
  <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
  </svg>
{/snippet}

<!-- Icône « bac de rangement », partagée par l'en-tête et les entrées. -->
{#snippet stashIcon()}
  <svg class="ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round">
    <path d="M2.5 3.5h11a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z" />
    <path d="M1.5 8.75h3.2l1 1.6h4.6l1-1.6h3.2" stroke-linecap="round" />
  </svg>
{/snippet}

<style>
  .branches {
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
    border-right: 1px solid var(--border);
    background: var(--bg);
  }
  /* La colonne ne défile pas : cette zone occupe exactement la hauteur laissée
     par la barre d'actions, et c'est **chaque section** qui défile chez elle.
     `overflow: hidden` n'est qu'un garde-fou pour une fenêtre trop courte même
     pour les seuls en-têtes — voir la note sur `min-height` plus bas. */
  .sections {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .toolbar {
    flex: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.35rem;
    padding: 0.5rem;
    border-bottom: 1px solid var(--border);
  }
  .actions {
    display: flex;
    justify-content: center;
    gap: 0.4rem;
  }
  /* Compte rendu du dernier fetch ; s'efface tout seul. */
  .status {
    margin: 0;
    font-size: 0.72rem;
    color: var(--text-dim);
    text-align: center;
  }
  /* Le cadre du bouton : c'est lui qui porte fond, bordure et survol, pour que
     l'action et sa flèche se lisent comme un seul contrôle. */
  .split {
    position: relative;
    flex: none;
    display: flex;
    align-items: stretch;
    border: 1px solid transparent;
    border-radius: 6px;
  }
  /* Le survol vaut pour toute la boîte, flèche comprise — sans quoi passer sur
     la flèche éteindrait le bouton, qui n'est pas son ancêtre. */
  .split:hover:not(.disabled) {
    background: var(--bg-raised);
    border-color: var(--border);
  }
  /* Boutons carrés, icône au-dessus du libellé. `relative` pour ancrer la
     pastille de compteur dans le coin. */
  .action {
    position: relative;
    flex: none;
    width: 56px;
    height: 56px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.3rem;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: 6px;
    color: var(--text);
    font-size: 0.7rem;
    cursor: pointer;
  }
  /* Le chevron se pose **dans** la cellule, contre son bord droit, plutôt que de
     l'élargir : les trois boutons gardent la même empreinte, le libellé reste
     centré, et la flèche se lit comme une partie du bouton et non comme un
     bouton voisin. Cible de 20×30, bien plus grande que le chevron. */
  .caret {
    position: absolute;
    top: 50%;
    right: 0;
    transform: translateY(-50%);
    width: 20px;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: var(--text-dim);
    cursor: pointer;
  }
  /* Plus petit que l'icône de l'action (20px) — il reste secondaire — mais
     assez grand pour se voir et se viser. Seul point à régler si besoin. */
  .caret-ic {
    width: 14px;
    height: 14px;
  }
  .split:hover .caret {
    color: var(--text);
  }
  /* Le filet de séparation n'apparaît qu'au survol : au repos, une seule boîte. */
  .split:hover .caret {
    border-left-color: var(--border);
  }
  /* Survolée seule, la flèche s'éclaire sans se détacher du bouton. */
  .caret:hover {
    background: var(--bg);
    color: var(--text);
  }
  .action:disabled {
    color: var(--text-faint);
    cursor: default;
  }
  .action-ic {
    width: 20px;
    height: 20px;
  }
  /* Compteur d'écart. Sa couleur est fixée ici, sinon il hériterait du gris de
     `.action:disabled` — Pull et Push étant justement désactivés. */
  .badge {
    position: absolute;
    top: 4px;
    right: 4px;
    min-width: 1rem;
    padding: 0 0.2rem;
    border-radius: 999px;
    background: var(--accent-bg);
    color: var(--accent-soft);
    font-size: 0.62rem;
    font-variant-numeric: tabular-nums;
    line-height: 1.4;
  }
  /* Une section est une liste sur laquelle on agit, pas de la prose : y
     sélectionner du texte gênerait le clic sans rien apporter. Ce qui se copie —
     le titre et la description d'un commit — vit hors de toute section, et garde
     donc la sélection par défaut. */
  section {
    user-select: none;
    -webkit-user-select: none;
    /* Le corps déborde de quelques pixels de padding quand la fenêtre est trop
       courte pour les en-têtes eux-mêmes ; il est coupé ici plutôt que peint
       par-dessus l'en-tête suivant. */
    overflow: hidden;
  }
  /*
    Répartition « chacun sa taille, le reste au plus long », obtenue par
    l'algorithme flexbox lui-même : base 0 + `flex-grow` donne à chaque section
    ouverte une part égale, `max-height: max-content` gèle celles qui n'en ont
    pas besoin, et flexbox redistribue leur reliquat aux autres. Une section de
    trois branches ne réserve donc jamais un tiers de la colonne, et c'est la
    plus longue qui absorbe ce qui reste — en défilant chez elle.

    **La section est une grille, et ce n'est pas un choix de style.** En colonne
    flex — en-tête `flex: none` puis corps `flex: 1 1 auto; min-height: 0` — la
    hauteur max-content de la section vaut celle de son en-tête **dans
    WKWebView** : le corps défilant n'y compte pour rien. Toutes les sections se
    gelaient donc sur 22px, l'espace libre filant dans la marge du bloc replié.
    Chromium, lui, calculait bien la même feuille : le bug ne se voyait que dans
    l'app. En `grid-template-rows: auto minmax(0, 1fr)`, les deux moteurs
    rendent le même résultat au pixel près.

    `min-height: 0` reste indispensable : sans lui, le minimum automatique d'un
    item flex vaut sa taille min-content, ici la liste entière ; la section
    refuserait de rétrécir et la colonne déborderait. Le plancher réel devient
    l'en-tête, et `minmax(0, 1fr)` autorise le corps à passer sous sa taille
    intrinsèque — c'est-à-dire à défiler.
  */
  section.open {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    flex: 1 1 0;
    min-height: 0;
    max-height: max-content;
  }
  /* Repliée : rien que son en-tête, et rejetée en fin de colonne. */
  section:not(.open) {
    flex: none;
    order: 1;
  }
  /* Colle le bloc des sections repliées en bas : la marge automatique absorbe
     l'espace libre, lequel n'existe justement que lorsque toutes les sections
     ouvertes sont gelées sur leur contenu. Le trait qui les sépare du dessus
     vient de `SectionHeader`, comme celui de toutes les autres sections. */
  section.pinned {
    margin-top: auto;
  }
  /* L'en-tête vit dans `SectionHeader` — y compris son trait de séparation : il
     est le premier enfant de la section, donc la bordure tombe au bon endroit.
     Il n'est plus `sticky` non plus, la zone défilante étant le corps de sa
     propre section. */
  .ic {
    width: 14px;
    height: 14px;
    color: var(--text-dim);
  }
  .sec-body {
    min-height: 0;
    overflow-y: auto;
    padding: 0.3rem var(--sec-inset) 0.6rem;
  }
  /* Nœud d'un distant. Calqué sur le `.dir` de BranchRow (scopé là-bas), au
     nuage et au compteur près. */
  .remote-node {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    width: 100%;
    background: transparent;
    border: none;
    /* Retrait gauche pris à la variable, et non à un `0.5rem` voisin : ses
       enfants sont des `BranchRow` de profondeur 1, donc calés dessus. */
    padding: 0.25rem 0.5rem 0.25rem var(--row-inset);
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.82rem;
    text-align: left;
    color: var(--text-dim);
  }
  .remote-node:hover {
    background: var(--bg-raised);
  }
  .remote-node .ic {
    flex: none;
  }
  .rname {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rcount {
    flex: none;
    font-size: 0.72rem;
    color: var(--text-faint);
  }
  .stash {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    font-size: 0.82rem;
    cursor: default;
  }
  .stash:hover,
  .stash.active {
    background: var(--bg-raised);
  }
  .stash .ic {
    color: var(--text-faint);
  }
  /* Bouton d'actions : discret, révélé au survol / focus / menu ouvert. */
  .kebab {
    flex: none;
    margin-left: 0.1rem;
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
  .stash:hover .kebab,
  .stash:focus-within .kebab,
  .stash.active .kebab {
    opacity: 1;
  }
  .kebab:hover {
    background: var(--bg);
    color: var(--text);
  }

  /* ── Menu contextuel ── */
  .ctx-overlay {
    position: fixed;
    inset: 0;
    z-index: 50;
    background: transparent;
    border: none;
    padding: 0;
    cursor: default;
  }
  .ctx-menu {
    position: fixed;
    z-index: 51;
    min-width: 176px;
    padding: 0.25rem;
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 8px 24px var(--shadow-color);
  }
  .ctx-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    text-align: left;
    background: transparent;
    border: none;
    color: var(--text);
    font-size: 0.8rem;
    padding: 0.35rem 0.6rem;
    border-radius: 4px;
    cursor: pointer;
    white-space: nowrap;
  }
  /* Suit la couleur du texte du bouton (rouge pour l'action de suppression). */
  .ctx-ic {
    flex: none;
    width: 14px;
    height: 14px;
  }
  .ctx-item:hover:not(:disabled) {
    background: var(--accent-bg);
  }
  .ctx-item:disabled {
    color: var(--text-faint);
    cursor: default;
  }
  /* Menu de la fusion : les noms de branches peuvent être longs, l'entrée passe
     donc à la ligne au lieu de pousser le menu hors de l'écran. */
  .merge-menu {
    min-width: 220px;
    max-width: 300px;
  }
  .ctx-item.wrap {
    white-space: normal;
    align-items: flex-start;
    line-height: 1.35;
  }
  /* L'icône garde l'axe de la première ligne de texte quand celui-ci se replie. */
  .ctx-item.wrap .ctx-ic {
    margin-top: 0.1rem;
  }
  /* Étiquette de glissement : décalée sous le curseur pour ne pas masquer la
     ligne visée, et transparente aux pointeurs (voir le balisage). */
  .drag-chip {
    position: fixed;
    z-index: 60;
    transform: translate(0.75rem, 0.5rem);
    display: flex;
    align-items: center;
    gap: 0.4rem;
    max-width: 16rem;
    padding: 0.2rem 0.5rem;
    background: var(--bg-raised);
    border: 1px solid var(--accent);
    border-radius: 4px;
    color: var(--text);
    font-size: 0.82rem;
    white-space: nowrap;
    overflow: hidden;
    box-shadow: 0 4px 12px var(--shadow-color);
    pointer-events: none;
  }
  /* Menu d'une PR : le titre en en-tête peut être long, il se replie. */
  .pr-menu {
    min-width: 236px;
    max-width: 300px;
  }
  .pr-menu .ctx-head {
    max-width: 260px;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  /* Menu du bouton Pull : en-tête explicatif + entrées radio. */
  .pull-menu {
    min-width: 268px;
  }
  .ctx-head {
    margin: 0.15rem 0.6rem 0.35rem;
    max-width: 240px;
    color: var(--text-dim);
    font-size: 0.72rem;
    line-height: 1.3;
  }
  .radio {
    flex: none;
    width: 0.9rem;
    font-size: 0.7rem;
    color: var(--text-faint);
  }
  .ctx-item.selected {
    background: var(--accent-bg);
  }
  .ctx-item.selected .radio {
    color: var(--accent-soft);
  }
  .ctx-item.danger {
    color: var(--danger);
  }
  .ctx-item.danger:hover {
    background: var(--danger-bg);
  }
  .ctx-sep {
    height: 1px;
    margin: 0.25rem 0.3rem;
    background: var(--border);
  }
  .on {
    flex: none;
    color: var(--text);
  }
  .sbranch {
    flex: 1;
    color: var(--text-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .empty {
    color: var(--text-dim);
    font-size: 0.8rem;
    padding: 1rem 0.7rem;
  }
  .empty.small {
    padding: 0.3rem 0.6rem;
    opacity: 0.7;
  }
</style>
