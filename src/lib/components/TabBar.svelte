<script lang="ts">
  import { tabs } from "../stores/repo.svelte";

  // Cette barre remplace l'ancienne topbar (logo + bouton « Ouvrir un dépôt ») :
  // elle ne contient que les onglets et le « + » qui en ouvre un nouveau.
  //
  // Un onglet est soit un dépôt ouvert, soit une page « Nouvel onglet » qui
  // n'en a pas encore (voir `NewTab`) : la barre les traite exactement pareil,
  // seul le libellé les distingue.
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

  // ── Réordonnancement par glisser-déposer ────────────────────────────────
  //
  // Pointer events plutôt que le drag & drop HTML5 : pas d'image fantôme
  // imposée par le navigateur, pas de `DataTransfer` à alimenter pour un
  // déplacement purement interne, et la capture du pointeur garantit qu'on
  // reçoit le relâchement même hors de la fenêtre.
  //
  // L'onglet saisi suit le curseur, borné à la bande d'onglets, et ceux qu'il
  // enjambe s'écartent pour ouvrir la place où il atterrira.
  //
  // Rien n'est réordonné dans le DOM avant le relâchement : tout passe par des
  // `transform`, qui ne touchent pas à la disposition. La géométrie relevée à la
  // prise reste donc valable pendant tout le glissement — sinon il faudrait
  // re-mesurer après chaque échange, et l'onglet saisi sauterait d'une largeur
  // le temps d'une image.

  /** Pixels à parcourir avant qu'un appui devienne un glissement. */
  const DRAG_THRESHOLD = 4;

  /** Disposition figée au moment de la prise. */
  type Press = {
    id: string;
    index: number;
    /** Abscisse de l'appui, pour le seuil de déclenchement. */
    startX: number;
    /** Distance entre le curseur et le bord gauche de l'onglet saisi. */
    grab: number;
    left: number;
    width: number;
    /** Milieux des onglets, dans leur disposition d'origine. */
    mids: number[];
    /** Place que libère l'onglet saisi : sa largeur + l'écart. */
    shift: number;
    /** Bornes de déplacement — l'onglet ne sort pas de la bande. */
    min: number;
    max: number;
  };

  type Drag = {
    id: string;
    from: number;
    /** Index d'insertion visé, dans la liste courante (onglet saisi compris). */
    to: number;
    /** Translation de l'onglet saisi. */
    dx: number;
    shift: number;
  };

  let strip: HTMLDivElement;
  let press: Press | null = null;
  let drag = $state<Drag | null>(null);

  function onPointerDown(e: PointerEvent & { currentTarget: HTMLElement }, id: string) {
    if (e.button !== 0) return;
    // La croix garde son clic.
    if ((e.target as HTMLElement).closest(".close")) return;

    // Coupe la sélection de texte et le glisser natif de WebKit. En contrepartie
    // l'appui ne donne plus le focus tout seul : on le fait à la main pour ne pas
    // perdre la navigation au clavier.
    e.preventDefault();
    e.currentTarget.focus();

    // Activation à l'appui, comme dans un navigateur — et non au clic : celui-ci
    // arrive après le réordonnancement, sur l'onglet qui se trouve alors sous le
    // curseur, donc pas forcément celui qu'on a saisi.
    tabs.activate(id);

    press = measure(e.clientX, id);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    if (!press) return;
    // Tant que le seuil n'est pas franchi, c'est un clic : ne rien bouger.
    if (!drag && Math.abs(e.clientX - press.startX) < DRAG_THRESHOLD) return;

    const left = Math.min(Math.max(e.clientX - press.grab, press.min), press.max);

    drag = {
      id: press.id,
      from: press.index,
      to: dropIndex(press, left),
      dx: left - press.left,
      shift: press.shift,
    };
  }

  /**
   * Index d'insertion visé, dans la liste courante — l'onglet saisi y compte
   * encore, d'où le `i + 1` en repartant vers la droite.
   *
   * C'est le **bord avant** de l'onglet saisi qui est comparé au milieu des
   * voisins : son bord gauche quand il part à gauche, son bord droit quand il
   * part à droite. Comparer son centre, comme au premier jet, rend des places
   * carrément inatteignables dès que les onglets n'ont pas la même largeur :
   * poussé à fond à gauche, le centre d'un onglet large reste à droite du milieu
   * d'un onglet étroit, donc impossible de passer devant lui.
   *
   * Les milieux comparés sont ceux de la disposition d'origine, jamais des
   * positions décalées : la décision reste monotone, donc sans oscillation.
   */
  function dropIndex(p: Press, left: number): number {
    for (let i = 0; i < p.index; i++) {
      if (left < p.mids[i]) return i;
    }
    for (let i = p.mids.length - 1; i > p.index; i--) {
      if (left + p.width > p.mids[i]) return i + 1;
    }
    return p.index;
  }

  function onPointerUp() {
    // Réordonnancement et remise à zéro des translations tombent dans la même
    // mise à jour : les onglets écartés sont déjà exactement à leur place finale
    // et ne bougent pas d'un pixel au lâcher. Seul l'onglet saisi se replace, du
    // curseur vers le trou qui l'attend.
    if (drag) tabs.move(drag.id, drag.to);
    press = null;
    drag = null;
  }

  /** Relève la disposition des onglets une fois pour toutes, à la prise. */
  function measure(x: number, id: string): Press {
    const rects = [...strip.querySelectorAll<HTMLElement>(".tab")].map((el) =>
      el.getBoundingClientRect(),
    );
    const index = tabs.tabs.findIndex((t) => t.id === id);
    const rect = rects[index];
    // Écart mesuré entre deux onglets, plutôt que la valeur du `gap` recopiée ici.
    const gap =
      rects.length < 2
        ? 0
        : index > 0
          ? rect.left - rects[index - 1].right
          : rects[1].left - rect.right;
    const bounds = strip.getBoundingClientRect();

    return {
      id,
      index,
      startX: x,
      grab: x - rect.left,
      left: rect.left,
      width: rect.width,
      mids: rects.map((r) => r.left + r.width / 2),
      shift: rect.width + gap,
      min: bounds.left,
      max: bounds.right - rect.width,
    };
  }

  /**
   * Translation d'un onglet pendant le glissement : l'onglet saisi suit le
   * curseur, ceux qu'il enjambe reculent de la place qu'il libère.
   */
  function offsetOf(i: number, id: string): string {
    if (!drag) return "";
    if (id === drag.id) return `translateX(${drag.dx}px)`;
    if (drag.to > drag.from && i > drag.from && i < drag.to)
      return `translateX(${-drag.shift}px)`;
    if (drag.to < drag.from && i >= drag.to && i < drag.from)
      return `translateX(${drag.shift}px)`;
    return "";
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
    {#each tabs.tabs as tab, i (tab.id)}
      {@const active = tab.id === tabs.activeId}
      {@const label = tab.kind === "new" ? "Nouvel onglet" : (tab.repoInfo?.name ?? "…")}
      <div
        class="tab"
        class:active
        class:dragging={drag?.id === tab.id}
        style:transform={offsetOf(i, tab.id)}
        role="tab"
        tabindex="0"
        aria-selected={active}
        title={tab.kind === "new" ? label : tab.repoId}
        onpointerdown={(e) => onPointerDown(e, tab.id)}
        onpointermove={onPointerMove}
        onpointerup={onPointerUp}
        onpointercancel={onPointerUp}
        onauxclick={(e) => onMiddle(e, tab.id)}
        onkeydown={(e) => (e.key === "Enter" ? tabs.activate(tab.id) : undefined)}
      >
        <span class="name" class:blank={tab.kind === "new"}>{label}</span>
        <button
          class="close"
          title="Fermer l'onglet"
          aria-label="Fermer l'onglet"
          onclick={(e) => onClose(e, tab.id)}
        >
          ×
        </button>
      </div>
    {/each}

    <!-- Dans le même flux que les onglets : il suit le dernier, sans être collé
         au bord droit de la fenêtre. -->
    <button
      class="add"
      title="Nouvel onglet"
      aria-label="Nouvel onglet"
      onclick={() => tabs.newTab()}
    >
      +
    </button>
  </div>

  <!--
    Hors de `.tabs` (qui prend `flex: 1` et défile) : le bouton reste collé au
    bord droit quel que soit le nombre d'onglets, au lieu de partir hors champ
    avec eux. Un `<button>` garde son clic malgré la zone de drag de la barre.
  -->
  <button
    class="settings"
    class:on={tabs.settingsOpen}
    title="Paramètres"
    aria-label="Paramètres"
    aria-pressed={tabs.settingsOpen}
    onclick={() => tabs.toggleSettings()}
  >
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="8" cy="8" r="2.1" />
      <path d="M12.9 9.8a1.1 1.1 0 0 0 .22 1.21l.04.04a1.33 1.33 0 1 1-1.88 1.88l-.04-.04a1.1 1.1 0 0 0-1.21-.22 1.1 1.1 0 0 0-.67 1v.11a1.33 1.33 0 1 1-2.67 0v-.06a1.1 1.1 0 0 0-.72-1 1.1 1.1 0 0 0-1.21.22l-.04.04a1.33 1.33 0 1 1-1.88-1.88l.04-.04a1.1 1.1 0 0 0 .22-1.21 1.1 1.1 0 0 0-1-.67h-.11a1.33 1.33 0 1 1 0-2.67h.06a1.1 1.1 0 0 0 1-.72 1.1 1.1 0 0 0-.22-1.21l-.04-.04a1.33 1.33 0 1 1 1.88-1.88l.04.04a1.1 1.1 0 0 0 1.21.22h.05a1.1 1.1 0 0 0 .67-1v-.11a1.33 1.33 0 1 1 2.67 0v.06a1.1 1.1 0 0 0 .67 1 1.1 1.1 0 0 0 1.21-.22l.04-.04a1.33 1.33 0 1 1 1.88 1.88l-.04.04a1.1 1.1 0 0 0-.22 1.21v.05a1.1 1.1 0 0 0 1 .67h.11a1.33 1.33 0 1 1 0 2.67h-.06a1.1 1.1 0 0 0-1 .67z" />
    </svg>
  </button>
</div>

<style>
  .tabbar {
    display: flex;
    align-items: center;
    padding: 0.35rem 0.5rem;
    min-height: 42px;
    border-bottom: 1px solid var(--border);
    background: var(--bg);
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
    background: var(--bg-raised);
    color: var(--text);
  }
  /* Écran ouvert : le bouton reste allumé, c'est une bascule. */
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
    background: var(--bg-raised);
    color: var(--text-dim);
    font-size: 0.83rem;
    cursor: pointer;
  }
  .tab:hover {
    color: var(--text);
  }
  .tab.active {
    background: var(--accent-bg);
    border-color: var(--accent);
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
  }
  /* Révélée au survol, au focus clavier, ou sur l'onglet courant. */
  .tab:hover .close,
  .tab:focus-within .close,
  .tab.active .close {
    opacity: 1;
  }
  .close:hover {
    background: var(--bg);
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
    background: var(--bg-raised);
    color: var(--text);
  }
</style>
