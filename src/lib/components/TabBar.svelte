<script lang="ts">
  import { tick } from "svelte";
  import { t } from "../i18n.svelte";
  import { tabs, type RepoStore } from "../stores/repo.svelte";
  import {
    dropGroup,
    dropTab,
    GROUP_COLORS,
    GROUP_NAME_MAX,
    groupUnits,
    stripItems,
    type StripItem,
  } from "../tabGroups";
  import type { TabGroup } from "../types";
  import Cross from "./Cross.svelte";

  // Cette barre remplace l'ancienne topbar (logo + bouton « Ouvrir un dépôt ») :
  // elle ne contient que les onglets et le « + » qui en ouvre un nouveau.
  //
  // Un onglet est un dépôt ouvert, une page « Nouvel onglet » qui n'en a pas
  // encore (voir `NewTab`) ou les paramètres (voir `SettingsTab`) : la barre
  // les traite exactement pareil, seuls le libellé et l'icône les distinguent.
  //
  // Sur macOS la fenêtre est en `titleBarStyle: Overlay` : le contenu passe sous
  // la barre de titre, donc il faut réserver la place des boutons rouge/jaune/vert
  // à gauche. On ne le fait que dans l'app native — dans un navigateur (preview),
  // ces boutons n'existent pas et le décalage ne serait qu'un trou.
  const macOverlay =
    typeof navigator !== "undefined" &&
    navigator.userAgent.includes("Macintosh") &&
    typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in window;

  function onClose(e: MouseEvent, id: string) {
    // La croix ne doit pas remonter jusqu'à l'onglet.
    e.stopPropagation();
    tabs.close(id);
  }

  /** Clic milieu : ferme l'onglet, comme dans un navigateur. */
  function onMiddle(e: MouseEvent, id: string) {
    if (e.button === 1) {
      e.preventDefault();
      tabs.close(id);
    }
  }

  // ── Groupes d'onglets ──────────────────────────────────────────────────
  //
  // La barre est une suite d'éléments — pastilles de groupe et onglets —
  // calculée par `stripItems` : la pastille se pose devant le premier membre
  // ouvert, et un groupe replié ne garde que l'onglet affiché.
  const items = $derived(
    stripItems(
      tabs.tabs.map((t) => t.id),
      tabs.groups,
      tabs.activeId,
    ),
  );
  const byId = $derived(new Map(tabs.tabs.map((t) => [t.id, t])));

  /** Membres d'un groupe replié qui ne sont pas à l'écran. */
  function hiddenRepos(item: Extract<StripItem, { kind: "group" }>): RepoStore[] {
    return item.tabs
      .filter((id) => id !== tabs.activeId)
      .map((id) => byId.get(id))
      .filter((t): t is RepoStore => t?.kind === "repo");
  }

  /** L'issue la plus grave parmi les onglets cachés, pour la pastille. */
  const SEVERITY = { neutral: 0, ok: 1, warn: 2, danger: 3 } as const;
  function worstUnseen(repos: RepoStore[]): keyof typeof SEVERITY | null {
    let worst: keyof typeof SEVERITY | null = null;
    for (const r of repos) {
      const o = r.unseenOutcome;
      if (o && (worst === null || SEVERITY[o] > SEVERITY[worst])) worst = o;
    }
    return worst;
  }

  // ── Menu contextuel d'un onglet de dépôt ────────────────────────────────
  //
  // Le rangement en groupe, puis les paramètres du dépôt — le geste naturel
  // quand on pense « ce dépôt-là », y compris pour un onglet qui n'est pas
  // celui affiché, d'où l'activation qui va avec (`openRepoSettings`).
  let tabMenu = $state<{ id: string; x: number; y: number } | null>(null);
  const TAB_MENU_W = 220;
  /** Hauteur d'une entrée du menu, pour le garder dans la fenêtre. */
  const MENU_ROW_H = 30;

  function openTabMenu(e: MouseEvent, id: string) {
    e.preventDefault();
    // Nouveau groupe, en-tête + un par autre groupe, retrait, séparateur,
    // paramètres.
    const others = tabs.groups.filter((g) => !g.members.includes(id)).length;
    const rows = 2 + (others ? others + 1 : 0) + (tabs.groupOf(id) ? 1 : 0);
    const h = rows * MENU_ROW_H + 24;
    tabMenu = {
      id,
      x: Math.max(8, Math.min(e.clientX, window.innerWidth - TAB_MENU_W - 8)),
      y: Math.max(8, Math.min(e.clientY, window.innerHeight - h - 8)),
    };
  }

  // ── Éditeur d'un groupe : nom, couleur, dégrouper, fermer ──────────────
  //
  // Ouvert par un clic droit sur la pastille, et tout de suite après la
  // création d'un groupe : un groupe neuf n'a pas encore de nom.
  let editor = $state<{ id: string; x: number; y: number } | null>(null);
  const EDITOR_W = 232;

  function openEditorAt(id: string, el: Element | null) {
    if (!el) return;
    const r = el.getBoundingClientRect();
    editor = {
      id,
      x: Math.max(8, Math.min(r.left, window.innerWidth - EDITOR_W - 8)),
      y: r.bottom + 4,
    };
  }

  /**
   * Ferme un menu puis agit sur ce qu'il visait. La cible est lue **avant** la
   * fermeture : un `{@const}` du bloc du menu se recalcule à la lecture, et
   * relu après la remise à `null`, il lèverait au lieu de rendre sa valeur.
   */
  function fromTabMenu(action: (id: string) => void) {
    const id = tabMenu?.id;
    tabMenu = null;
    if (id) action(id);
  }

  function fromEditor(action: (groupId: string) => void) {
    const id = editor?.id;
    editor = null;
    if (id) action(id);
  }

  async function newGroup(tabId: string) {
    tabMenu = null;
    const id = tabs.createGroup(tabId);
    if (!id) return;
    await tick();
    openEditorAt(id, strip.querySelector(`[data-group="${CSS.escape(id)}"]`));
  }

  function groupLabel(g: TabGroup): string {
    return g.name || t("tabgroups.unnamed");
  }

  // ── Réordonnancement par glisser-déposer ────────────────────────────────
  //
  // Pointer events plutôt que le drag & drop HTML5 : pas d'image fantôme
  // imposée par le navigateur, pas de `DataTransfer` à alimenter pour un
  // déplacement purement interne, et la capture du pointeur garantit qu'on
  // reçoit le relâchement même hors de la fenêtre.
  //
  // Ce qu'on saisit est une **unité** : un onglet, ou une pastille de groupe
  // qui emmène tout son groupe. L'unité saisie suit le curseur, bornée à la
  // bande d'onglets, et celles qu'elle enjambe s'écartent pour ouvrir la place
  // où elle atterrira. Glissant un onglet, chaque élément est une unité — les
  // pastilles comprises, c'est ce qui permet d'entrer dans un groupe ou d'en
  // sortir ; glissant une pastille, un groupe entier en est une
  // (`groupUnits`), pour qu'il ne se pose jamais au milieu d'un autre.
  //
  // Rien n'est réordonné dans le DOM avant le relâchement : tout passe par des
  // `transform`, qui ne touchent pas à la disposition. La géométrie relevée au
  // départ du glissement reste donc valable jusqu'au bout — sinon il faudrait
  // re-mesurer après chaque échange, et l'unité saisie sauterait d'une largeur
  // le temps d'une image.

  /** Pixels à parcourir avant qu'un appui devienne un glissement. */
  const DRAG_THRESHOLD = 4;

  type Unit = { start: number; end: number };

  /** L'appui, avant que la géométrie ne soit relevée. */
  type Press = { kind: "tab" | "group"; id: string; startX: number };

  /** Disposition figée au moment où le glissement démarre. */
  type Geometry = {
    /** Éléments et unités tels qu'affichés à ce moment-là. */
    items: StripItem[];
    units: Unit[];
    /** Unité saisie. */
    index: number;
    /** Distance entre le curseur et le bord gauche de l'unité saisie. */
    grab: number;
    left: number;
    width: number;
    /** Milieux des unités, dans leur disposition d'origine. */
    mids: number[];
    /** Place que libère l'unité saisie : sa largeur + l'écart. */
    shift: number;
    /** Bornes de déplacement — l'unité ne sort pas de la bande. */
    min: number;
    max: number;
  };

  type Drag = {
    from: number;
    /** Index d'insertion visé, en unités (l'unité saisie comprise). */
    to: number;
    /** Translation de l'unité saisie. */
    dx: number;
    shift: number;
    units: Unit[];
  };

  let strip: HTMLDivElement;
  let press: Press | null = null;
  let geometry: Geometry | null = null;
  let drag = $state<Drag | null>(null);
  /**
   * Le `click` qui suit un glissement de pastille ne doit pas replier le
   * groupe. Remis à zéro à chaque appui, pour qu'un clic jamais arrivé ne
   * mange pas le suivant.
   */
  let swallowClick = false;

  function onTabPointerDown(e: PointerEvent & { currentTarget: HTMLElement }, id: string) {
    if (e.button !== 0) return;
    // La croix garde son clic.
    if ((e.target as HTMLElement).closest(".close")) return;

    // Coupe la sélection de texte et le glisser natif de WebKit. En contrepartie
    // l'appui ne donne plus le focus tout seul : on le fait à la main pour ne pas
    // perdre la navigation au clavier. Sans anneau : un focus posé par script
    // passe pour du clavier quand on vient de taper quelque chose, alors que
    // c'est un clic — `focusVisible: false` le dit à WebKit (ignoré là où
    // l'option n'existe pas).
    e.preventDefault();
    e.currentTarget.focus({ focusVisible: false } as FocusOptions);

    // Activation à l'appui, comme dans un navigateur — et non au clic : celui-ci
    // arrive après le réordonnancement, sur l'onglet qui se trouve alors sous le
    // curseur, donc pas forcément celui qu'on a saisi.
    //
    // C'est aussi pourquoi la géométrie n'est relevée qu'au premier mouvement :
    // activer un onglet peut cacher le précédent, s'il était l'onglet affiché
    // d'un groupe replié, et la barre n'a pas encore été redessinée ici.
    tabs.activate(id);
    startPress(e, { kind: "tab", id, startX: e.clientX });
  }

  function onGroupPointerDown(e: PointerEvent & { currentTarget: HTMLElement }, id: string) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.focus({ focusVisible: false } as FocusOptions);
    startPress(e, { kind: "group", id, startX: e.clientX });
  }

  function startPress(e: PointerEvent & { currentTarget: HTMLElement }, p: Press) {
    swallowClick = false;
    press = p;
    geometry = null;
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    if (!press) return;
    // Tant que le seuil n'est pas franchi, c'est un clic : ne rien bouger.
    if (!drag && Math.abs(e.clientX - press.startX) < DRAG_THRESHOLD) return;
    geometry ??= measure(press);
    if (!geometry) return;
    const g = geometry;

    const left = Math.min(Math.max(e.clientX - g.grab, g.min), g.max);
    drag = {
      from: g.index,
      to: dropIndex(g, left),
      dx: left - g.left,
      shift: g.shift,
      units: g.units,
    };
  }

  /**
   * Index d'insertion visé, en unités — l'unité saisie y compte encore, d'où
   * le `i + 1` en repartant vers la droite.
   *
   * C'est le **bord avant** de l'unité saisie qui est comparé au milieu des
   * voisines : son bord gauche quand elle part à gauche, son bord droit quand
   * elle part à droite. Comparer son centre, comme au premier jet, rend des
   * places carrément inatteignables dès que les unités n'ont pas la même
   * largeur : poussé à fond à gauche, le centre d'un onglet large reste à
   * droite du milieu d'un onglet étroit, donc impossible de passer devant lui.
   *
   * Les milieux comparés sont ceux de la disposition d'origine, jamais des
   * positions décalées : la décision reste monotone, donc sans oscillation.
   */
  function dropIndex(g: Geometry, left: number): number {
    for (let i = 0; i < g.index; i++) {
      if (left < g.mids[i]) return i;
    }
    for (let i = g.mids.length - 1; i > g.index; i--) {
      if (left + g.width > g.mids[i]) return i + 1;
    }
    return g.index;
  }

  function onPointerUp() {
    // Réordonnancement et remise à zéro des translations tombent dans la même
    // mise à jour : les unités écartées sont déjà exactement à leur place finale
    // et ne bougent pas d'un pixel au lâcher. Seule l'unité saisie se replace,
    // du curseur vers le trou qui l'attend.
    if (drag && press && geometry) {
      const ids = tabs.tabs.map((t) => t.id);
      if (press.kind === "tab") {
        const groupable = byId.get(press.id)?.kind === "repo";
        const { order, group } = dropTab(
          ids,
          tabs.groups,
          geometry.items,
          drag.to,
          press.id,
          groupable,
        );
        tabs.dropTab(press.id, order, group);
      } else {
        tabs.dropGroup(dropGroup(ids, geometry.items, drag.to, press.id));
        swallowClick = true;
      }
    }
    press = null;
    geometry = null;
    drag = null;
  }

  /** Relève la disposition des éléments une fois pour toutes. */
  function measure(p: Press): Geometry | null {
    const rects = [...strip.querySelectorAll<HTMLElement>(".strip-item")].map((el) =>
      el.getBoundingClientRect(),
    );
    if (rects.length !== items.length) return null;
    const units: Unit[] =
      p.kind === "tab" ? items.map((_, i) => ({ start: i, end: i + 1 })) : groupUnits(items);
    const index = units.findIndex((u) => {
      const it = items[u.start];
      return p.kind === "tab"
        ? it.kind === "tab" && it.id === p.id
        : it.kind === "group" && it.group.id === p.id;
    });
    if (index === -1) return null;

    const spans = units.map((u) => ({ left: rects[u.start].left, right: rects[u.end - 1].right }));
    const span = spans[index];
    // Écart mesuré entre deux unités, plutôt que la valeur du `gap` recopiée ici.
    const gap =
      spans.length < 2
        ? 0
        : index > 0
          ? span.left - spans[index - 1].right
          : spans[1].left - span.right;
    const width = span.right - span.left;
    const bounds = strip.getBoundingClientRect();

    return {
      items,
      units,
      index,
      grab: Math.min(Math.max(p.startX - span.left, 0), width),
      left: span.left,
      width,
      mids: spans.map((s) => (s.left + s.right) / 2),
      shift: width + gap,
      min: bounds.left,
      max: bounds.right - width,
    };
  }

  /**
   * Translation d'un élément pendant le glissement : l'unité saisie suit le
   * curseur, celles qu'elle enjambe reculent de la place qu'elle libère.
   */
  function offsetOf(i: number): string {
    if (!drag) return "";
    const u = drag.units.findIndex((x) => i >= x.start && i < x.end);
    if (u === drag.from) return `translateX(${drag.dx}px)`;
    if (drag.to > drag.from && u > drag.from && u < drag.to)
      return `translateX(${-drag.shift}px)`;
    if (drag.to < drag.from && u >= drag.to && u < drag.from)
      return `translateX(${drag.shift}px)`;
    return "";
  }

  function isDragged(i: number): boolean {
    return drag !== null && drag.units[drag.from] !== undefined &&
      i >= drag.units[drag.from].start && i < drag.units[drag.from].end;
  }
</script>

<!--
  `data-tauri-drag-region="deep"` : on peut déplacer la fenêtre en attrapant
  n'importe quel fond de la barre, y compris la zone vide à droite du « + » —
  celle-ci appartient à `.tabs` (flex: 1), pas à `.tabbar`.

  La valeur `deep` est indispensable ici : sans elle (attribut nu), Tauri ne
  démarre le glissement que si la cible du clic *est* l'élément porteur, donc un
  clic sur le fond de `.tabs` ne faisait rien — c'était le bug.

  Les onglets et les boutons gardent leurs clics sans qu'on ait à les exclure :
  en remontant la chaîne, Tauri s'arrête sur le premier élément « cliquable »
  (`<button>`, ou `tabindex` / `role="tab"` — ce que porte chaque onglet) et
  annule le glissement.

  Bonus gratuit : le double-clic sur ce fond agrandit/restaure la fenêtre, comme
  sur une barre de titre standard (`core:window:allow-internal-toggle-maximize`
  fait déjà partie de `core:default`).
-->
<div class="tabbar" class:mac={macOverlay} data-tauri-drag-region="deep">
  <div class="tabs" class:reordering={drag !== null} bind:this={strip}>
    {#each items as item, i (item.kind === "group" ? `g:${item.group.id}` : item.id)}
      {#if item.kind === "group"}
        {@render chip(item, i)}
      {:else}
        {@const tab = byId.get(item.id)}
        {#if tab}{@render tabEl(tab, i, item.group)}{/if}
      {/if}
    {/each}

    <!-- Dans le même flux que les onglets : il suit le dernier, sans être collé
         au bord droit de la fenêtre. -->
    <button
      class="add"
      title={t("tabbar.newTab")}
      aria-label={t("tabbar.newTab")}
      onclick={() => tabs.newTab()}
    >
      +
    </button>
  </div>

  <!--
    Hors de `.tabs` (qui prend `flex: 1` et défile) : le bouton reste collé au
    bord droit quel que soit le nombre d'onglets, au lieu de partir hors champ
    avec eux. Un `<button>` garde son clic malgré la zone de drag de la barre.

    Il ouvre l'onglet des paramètres, ou l'active s'il existe déjà ; ce n'est
    plus une bascule — on quitte les paramètres comme n'importe quel onglet.
  -->
  <button
    class="settings"
    class:on={tabs.activeIsSettings}
    title={t("tabbar.settings")}
    aria-label={t("tabbar.settings")}
    onclick={() => tabs.openSettings()}
  >
    {@render gear()}
  </button>
</div>

<svelte:window
  onkeydown={(e) => {
    if (e.key === "Escape") {
      tabMenu = null;
      editor = null;
    }
  }}
/>

<!-- Pastille d'un groupe : un clic le replie ou le déploie, un clic droit
     ouvre son éditeur, un glissement emmène le groupe entier. -->
{#snippet chip(item: Extract<StripItem, { kind: "group" }>, i: number)}
  {@const g = item.group}
  {@const hidden = g.collapsed ? hiddenRepos(item) : []}
  {@const busy = hidden.some((r) => r.busyRemote || r.autoFetchShown)}
  {@const unseen = worstUnseen(hidden)}
  <button
    class="group-chip strip-item"
    class:collapsed={g.collapsed}
    class:unnamed={!g.name}
    class:dragging={isDragged(i)}
    style:--gc="var(--group-{g.color})"
    style:transform={offsetOf(i)}
    data-group={g.id}
    aria-expanded={!g.collapsed}
    aria-label={groupLabel(g)}
    title={`${groupLabel(g)} — ${
      g.collapsed ? t("tabgroups.expand", { n: item.tabs.length }) : t("tabgroups.collapse")
    }\n${t("tabgroups.edit")}`}
    onpointerdown={(e) => onGroupPointerDown(e, g.id)}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
    onclick={() => {
      if (swallowClick) {
        swallowClick = false;
        return;
      }
      tabs.toggleGroup(g.id);
    }}
    oncontextmenu={(e) => {
      e.preventDefault();
      openEditorAt(g.id, e.currentTarget);
    }}
    onkeydown={(e) => {
      if (e.key === "ContextMenu") {
        e.preventDefault();
        openEditorAt(g.id, e.currentTarget);
      }
    }}
  >
    {#if g.name}<span class="gname">{g.name}</span>{/if}
    {#if g.collapsed}
      <!-- Replié, la pastille résume ce qu'elle cache : combien d'onglets, et
           ce qui s'y passe. -->
      <span class="gcount">{item.tabs.length}</span>
      {#if busy}
        <span class="spinner" role="status" aria-label={t("tabbar.busy")}></span>
      {:else if unseen}
        <span
          class="unseen"
          class:ok={unseen === "ok" || unseen === "neutral"}
          class:warn={unseen === "warn"}
          class:danger={unseen === "danger"}
          role="status"
          aria-label={t(`tabbar.unseen.${unseen}`)}
        ></span>
      {/if}
    {/if}
  </button>
{/snippet}

{#snippet tabEl(tab: (typeof tabs.tabs)[number], i: number, group: TabGroup | null)}
  {@const active = tab.id === tabs.activeId}
  {@const label =
    tab.kind === "new"
      ? t("tabbar.newTab")
      : tab.kind === "settings"
        ? t("tabbar.settings")
        : (tab.displayName ?? "…")}
  <div
    class="tab strip-item"
    class:active
    class:grouped={group !== null}
    class:dragging={isDragged(i)}
    style:--gc={group ? `var(--group-${group.color})` : undefined}
    style:transform={offsetOf(i)}
    role="tab"
    tabindex="0"
    aria-selected={active}
    title={tab.kind === "repo" ? tab.repoId : label}
    onpointerdown={(e) => onTabPointerDown(e, tab.id)}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
    onauxclick={(e) => onMiddle(e, tab.id)}
    oncontextmenu={tab.kind === "repo" ? (e) => openTabMenu(e, tab.id) : undefined}
    onkeydown={(e) => {
      if (e.key === "Enter") tabs.activate(tab.id);
      else if (e.key === "ContextMenu" && tab.kind === "repo") {
        // Équivalent clavier du clic droit, sous l'onglet.
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        tabMenu = { id: tab.id, x: r.left, y: r.bottom + 2 };
      }
    }}
  >
    {#if tab.kind === "settings"}
      {@render gear("tab-ic")}
    {:else if tab.kind === "repo" && (tab.busyRemote || tab.autoFetchShown)}
      <!-- Une opération distante tourne dans ce dépôt — utile surtout quand
           on l'a quitté pour un autre onglet entre-temps. L'auto-fetch a le
           même spinner que le fetch cliqué. -->
      <span class="spinner" role="status" aria-label={t("tabbar.busy")} title={t("tabbar.busy")}></span>
    {:else if tab.kind === "repo" && tab.unseenOutcome && !active}
      <!-- Elle s'est terminée pendant qu'on était ailleurs : la couleur en
           dit l'issue, jusqu'à ce qu'on revienne sur l'onglet. -->
      {@const outcome = tab.unseenOutcome}
      <span
        class="unseen"
        class:ok={outcome === "ok" || outcome === "neutral"}
        class:warn={outcome === "warn"}
        class:danger={outcome === "danger"}
        role="status"
        aria-label={t(`tabbar.unseen.${outcome}`)}
        title={t(`tabbar.unseen.${outcome}`)}
      ></span>
    {/if}
    <span class="name" class:blank={tab.kind === "new"}>{label}</span>
    <button
      class="close"
      title={t("tabbar.closeTab")}
      aria-label={t("tabbar.closeTab")}
      onclick={(e) => onClose(e, tab.id)}
    >
      <Cross />
    </button>
  </div>
{/snippet}

{#if tabMenu}
  {@const id = tabMenu.id}
  {@const own = tabs.groupOf(id)}
  {@const others = tabs.groups.filter((g) => g.id !== own?.id)}
  <button
    class="ctx-overlay"
    aria-label={t("common.closeMenu")}
    onclick={() => (tabMenu = null)}
    oncontextmenu={(e) => {
      e.preventDefault();
      tabMenu = null;
    }}
  ></button>
  <div class="ctx-menu tab-menu" style="left: {tabMenu.x}px; top: {tabMenu.y}px" role="menu">
    <button class="ctx-item" role="menuitem" onclick={() => fromTabMenu(newGroup)}>
      <svg class="menu-ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
        <rect x="1.5" y="4" width="13" height="8" rx="2" />
        <path d="M8 6.2v3.6M6.2 8h3.6" />
      </svg>
      <span>{t("tabgroups.new")}</span>
    </button>
    {#if others.length}
      <p class="ctx-head">{t("tabgroups.addTo")}</p>
      {#each others as g (g.id)}
        <button
          class="ctx-item"
          role="menuitem"
          onclick={() => fromTabMenu((id) => tabs.addToGroup(id, g.id))}
        >
          <span class="swatch-dot" style:--gc="var(--group-{g.color})"></span>
          <span class="item-name" class:unnamed={!g.name}>{groupLabel(g)}</span>
        </button>
      {/each}
    {/if}
    {#if own}
      <button
        class="ctx-item"
        role="menuitem"
        onclick={() => fromTabMenu((id) => tabs.removeFromGroup(id))}
      >
        <svg class="menu-ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
          <rect x="1.5" y="4" width="13" height="8" rx="2" />
          <path d="M6.2 8h3.6" />
        </svg>
        <span>{t("tabgroups.remove")}</span>
      </button>
    {/if}
    <div class="ctx-sep"></div>
    <button
      class="ctx-item"
      role="menuitem"
      onclick={() => fromTabMenu((id) => void tabs.openRepoSettings(id))}
    >
      {@render gear("menu-ic")}
      <span>{t("repoSettings.open.menu")}</span>
    </button>
  </div>
{/if}

{#if editor}
  {@const g = tabs.groups.find((x) => x.id === editor?.id)}
  <button
    class="ctx-overlay"
    aria-label={t("common.closeMenu")}
    onclick={() => (editor = null)}
    oncontextmenu={(e) => {
      e.preventDefault();
      editor = null;
    }}
  ></button>
  {#if g}
    <div
      class="ctx-menu group-editor"
      style="left: {editor.x}px; top: {editor.y}px; width: {EDITOR_W}px"
      role="dialog"
      aria-label={groupLabel(g)}
    >
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="gname-input"
        value={g.name}
        maxlength={GROUP_NAME_MAX}
        placeholder={t("tabgroups.name")}
        aria-label={t("tabgroups.name")}
        autofocus
        oninput={(e) => tabs.renameGroup(g.id, e.currentTarget.value)}
        onkeydown={(e) => {
          if (e.key === "Enter") editor = null;
        }}
      />
      <div class="swatches" role="radiogroup" aria-label={t("tabgroups.colors")}>
        {#each GROUP_COLORS as c (c)}
          <button
            class="swatch"
            class:on={g.color === c}
            style:--gc="var(--group-{c})"
            role="radio"
            aria-checked={g.color === c}
            aria-label={t(`tabgroups.color.${c}`)}
            title={t(`tabgroups.color.${c}`)}
            onclick={() => tabs.setGroupColor(g.id, c)}
          ></button>
        {/each}
      </div>
      <div class="ctx-sep"></div>
      <button
        class="ctx-item"
        title={t("tabgroups.ungroup.hint")}
        onclick={() => fromEditor((id) => tabs.ungroup(id))}
      >
        <svg class="menu-ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-dasharray="2 2">
          <rect x="1.5" y="4" width="13" height="8" rx="2" />
        </svg>
        <span>{t("tabgroups.ungroup")}</span>
      </button>
      <button
        class="ctx-item"
        title={t("tabgroups.close.hint")}
        onclick={() => fromEditor((id) => void tabs.closeGroup(id))}
      >
        <span class="cross-ic"><Cross /></span>
        <span>{t("tabgroups.close")}</span>
      </button>
    </div>
  {/if}
{/if}

<!-- La roue dentée, partagée par le bouton et par l'onglet qu'il ouvre. -->
{#snippet gear(cls?: string)}
  <svg class={cls} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="8" cy="8" r="2.1" />
      <path d="M12.9 9.8a1.1 1.1 0 0 0 .22 1.21l.04.04a1.33 1.33 0 1 1-1.88 1.88l-.04-.04a1.1 1.1 0 0 0-1.21-.22 1.1 1.1 0 0 0-.67 1v.11a1.33 1.33 0 1 1-2.67 0v-.06a1.1 1.1 0 0 0-.72-1 1.1 1.1 0 0 0-1.21.22l-.04.04a1.33 1.33 0 1 1-1.88-1.88l.04-.04a1.1 1.1 0 0 0 .22-1.21 1.1 1.1 0 0 0-1-.67h-.11a1.33 1.33 0 1 1 0-2.67h.06a1.1 1.1 0 0 0 1-.72 1.1 1.1 0 0 0-.22-1.21l-.04-.04a1.33 1.33 0 1 1 1.88-1.88l.04.04a1.1 1.1 0 0 0 1.21.22h.05a1.1 1.1 0 0 0 .67-1v-.11a1.33 1.33 0 1 1 2.67 0v.06a1.1 1.1 0 0 0 .67 1 1.1 1.1 0 0 0 1.21-.22l.04-.04a1.33 1.33 0 1 1 1.88 1.88l-.04.04a1.1 1.1 0 0 0-.22 1.21v.05a1.1 1.1 0 0 0 1 .67h.11a1.33 1.33 0 1 1 0 2.67h-.06a1.1 1.1 0 0 0-1 .67z" />
    </svg>
{/snippet}

<style>
  .tabbar {
    display: flex;
    align-items: center;
    padding: 0.35rem 0.5rem;
    min-height: 42px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-raised);
    min-width: 0;
    /*
      Rien n'est sélectionnable dans la barre : le nom d'un onglet n'est pas du
      texte à copier, et une sélection en surbrillance apparaîtrait au moindre
      glissement. Hérité par les onglets et le « + ». Le préfixe reste
      nécessaire pour les WebKit d'avant Safari 17.
    */
    -webkit-user-select: none;
    user-select: none;
  }
  /*
    macOS en `titleBarStyle: Overlay` : les boutons de fenêtre flottent au-dessus
    du contenu, en haut à gauche.

    Cette hauteur est liée au `trafficLightPosition` de `tauri.conf.json`, et le
    calcul n'est pas celui qu'on croit (mesuré sur macOS 26) :

    - un bouton fait 14×14, pas 12 ;
    - tao ne positionne pas le bouton en y : il donne au conteneur de la barre de
      titre la hauteur `14 + y` et laisse le bouton à 9px de son *bas*. Le centre
      du bouton tombe donc à `y − 2` sous le haut de la fenêtre, pas à `y + 6`.

    Ici : y = 26 → centre des boutons à 24px.

    En face, `box-sizing: border-box` fait entrer le liseré du bas dans la
    hauteur, donc le centre visuel d'une barre de H px est à (H − 1) / 2 : 49px
    → 24px. Les deux centres coïncident. Changer l'une des deux valeurs sans
    l'autre décentre les boutons — c'était le défaut des versions précédentes.

    Le retrait à gauche dégage les 3 boutons (de x=20 à x=80), plus un peu d'air.
  */
  .tabbar.mac {
    padding-left: 92px;
    min-height: 49px;
  }
  .settings {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    margin-left: 0.4rem;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 6px;
    background: transparent;
    color: var(--text-faint);
    cursor: pointer;
  }
  .settings svg {
    width: 16px;
    height: 16px;
  }
  .settings:hover {
    background: var(--bg);
    color: var(--text);
  }
  /* Onglet des paramètres affiché : le bouton qui y mène reste allumé. */
  .settings.on {
    background: var(--accent-bg);
    border-color: var(--accent);
    color: var(--accent-soft);
  }
  /* Les onglets défilent horizontalement plutôt que d'écraser le bouton « + ». */
  .tabs {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    flex: 1;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .tabs::-webkit-scrollbar {
    display: none;
  }
  .tab {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    flex: none;
    /* Contexte d'empilement : l'onglet glissé doit passer au-dessus des autres. */
    position: relative;
    max-width: 15rem;
    height: 30px;
    padding: 0 0.5rem 0 0.75rem;
    border: 1px solid transparent;
    border-radius: 6px;
    /* Seul l'onglet actif a un fond : les autres ne sont que leur libellé,
       posé sur la barre. Un onglet glissé est toujours l'actif — il s'active
       au `pointerdown` —, il ne passe donc jamais transparent sur ses voisins. */
    background: transparent;
    color: var(--text-dim);
    font-size: 0.83rem;
    cursor: pointer;
  }
  .tab:hover {
    color: var(--text);
  }
  /* Un onglet inactif survolé s'éclaircit à mi-chemin du fond de l'actif : il
     annonce qu'on peut y aller, sans se confondre avec celui où l'on est. */
  .tab:hover:not(.active) {
    background: color-mix(in srgb, var(--bg) 55%, transparent);
  }
  /* Le fond seul distingue l'onglet actif, sans bordure. Celle, transparente,
     de `.tab` reste en place : l'onglet garde la même taille qu'il soit actif
     ou non. */
  .tab.active {
    background: var(--bg);
    color: var(--text);
  }
  /*
    La transition n'existe que pendant un glissement : les onglets écartés
    glissent, mais au lâcher la classe disparaît dans la même mise à jour que la
    remise à zéro des `transform`. Sans ça, chacun rejouerait en sens inverse le
    déplacement que la nouvelle disposition vient déjà d'appliquer.
  */
  .tabs.reordering .tab {
    transition: transform 120ms ease;
  }
  /* L'onglet saisi, lui, colle au curseur : aucune inertie. */
  .tabs.reordering .tab.dragging {
    transition: none;
    z-index: 2;
    cursor: grabbing;
    box-shadow: 0 6px 16px var(--shadow-color);
  }
  .name {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Icône de l'onglet des paramètres, devant son libellé. */
  .tab-ic {
    flex: none;
    width: 14px;
    height: 14px;
    color: var(--text-dim);
  }
  /* Opération distante en cours dans ce dépôt : un anneau qui tourne, de la
     taille d'une icône d'onglet. */
  .spinner {
    flex: none;
    width: 11px;
    height: 11px;
    border: 1.5px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: tab-spin 0.8s linear infinite;
  }
  @keyframes tab-spin {
    to {
      transform: rotate(360deg);
    }
  }
  /* Issue d'une opération terminée hors de vue : une pastille pleine. */
  .unseen {
    flex: none;
    width: 7px;
    height: 7px;
    border-radius: 50%;
  }
  .unseen.ok {
    background: var(--ok);
  }
  .unseen.warn {
    background: var(--warn);
  }
  .unseen.danger {
    background: var(--danger);
  }
  @media (prefers-reduced-motion: reduce) {
    .spinner {
      animation: none;
      border-color: var(--accent);
    }
  }
  /* Un onglet sans dépôt ne nomme rien : son libellé se fait discret. */
  .name.blank {
    font-weight: 500;
    font-style: italic;
  }
  .close {
    flex: none;
    width: 1.15rem;
    height: 1.15rem;
    padding: 0;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--text-faint);
    font-size: 0.95rem;
    line-height: 1;
    cursor: pointer;
    opacity: 0;
    /* La croix est un tracé (`Cross`) : le bouton n'a plus qu'à centrer sa boîte. */
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  /* Révélée au survol, au focus clavier, ou sur l'onglet courant. */
  .tab:hover .close,
  .tab:focus-within .close,
  .tab.active .close {
    opacity: 1;
  }
  .close:hover {
    background: var(--bg-raised);
    color: var(--text);
  }
  /* Même gabarit qu'un onglet, en plus étroit : il en est la continuation. */
  .add {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 30px;
    height: 30px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 6px;
    background: transparent;
    color: var(--text-dim);
    font-size: 1rem;
    line-height: 1;
    cursor: pointer;
  }
  .add:hover {
    background: var(--bg);
    color: var(--text);
  }
  .menu-ic {
    flex: none;
    width: 14px;
    height: 14px;
  }
  /* ── Groupes ─────────────────────────────────────────────────────────── */
  /*
    La pastille porte la couleur du groupe en aplat, son texte en sombre ou en
    clair selon le thème — `--bg` est justement la couleur sur laquelle tout le
    reste est posé, donc lisible sur une teinte vive dans les deux.
  */
  .group-chip {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    flex: none;
    position: relative;
    max-width: 10rem;
    height: 22px;
    min-width: 22px;
    padding: 0 0.5rem;
    border: none;
    border-radius: 6px;
    background: var(--gc);
    color: var(--bg);
    font-size: 0.75rem;
    font-weight: 700;
    cursor: pointer;
  }
  .group-chip.unnamed {
    padding: 0;
  }
  /* Sans nom, la pastille n'est qu'un carré de couleur — replié, son compteur
     lui redonne une largeur. */
  .group-chip.unnamed.collapsed {
    padding: 0 0.45rem;
  }
  .group-chip:hover {
    filter: brightness(1.08);
  }
  .gname {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .gcount {
    font-variant-numeric: tabular-nums;
    opacity: 0.8;
  }
  .group-chip .spinner {
    border-color: color-mix(in srgb, var(--bg) 40%, transparent);
    border-top-color: var(--bg);
  }
  .group-chip .unseen {
    box-shadow: 0 0 0 1.5px var(--bg);
  }
  /* Un onglet groupé est souligné de la couleur de son groupe. */
  .tab.grouped::after {
    content: "";
    position: absolute;
    left: 0.5rem;
    right: 0.5rem;
    bottom: 1px;
    height: 2px;
    border-radius: 1px;
    background: var(--gc);
  }
  .tabs.reordering .group-chip {
    transition: transform 120ms ease;
  }
  .tabs.reordering .strip-item.dragging {
    transition: none;
    z-index: 2;
    cursor: grabbing;
  }
  .tabs.reordering .group-chip.dragging {
    box-shadow: 0 6px 16px var(--shadow-color);
  }
  .tab-menu {
    min-width: 220px;
  }
  .swatch-dot {
    flex: none;
    width: 10px;
    height: 10px;
    margin: 0 2px;
    border-radius: 50%;
    background: var(--gc);
  }
  .item-name {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .unnamed {
    font-style: italic;
    color: var(--text-dim);
  }
  .group-chip.unnamed {
    color: var(--bg);
    font-style: normal;
  }
  .group-editor {
    padding: 0.5rem;
  }
  .gname-input {
    box-sizing: border-box;
    width: 100%;
    padding: 0.35rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-size: 0.8rem;
    outline: none;
  }
  .gname-input:focus {
    border-color: var(--accent);
  }
  .swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    padding: 0.55rem 0.15rem 0.3rem;
  }
  .swatch {
    width: 16px;
    height: 16px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: var(--gc);
    cursor: pointer;
  }
  /* La couleur choisie : un anneau détaché par un liseré du fond du menu. */
  .swatch.on {
    box-shadow:
      0 0 0 2px var(--bg-raised),
      0 0 0 3.5px var(--gc);
  }
  /* La croix suit le `font-size` : à 14px, elle a la taille des autres icônes. */
  .cross-ic {
    display: inline-flex;
    flex: none;
    width: 14px;
    justify-content: center;
    font-size: 14px;
  }
</style>
