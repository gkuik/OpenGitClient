<script lang="ts">
  import { tick, untrack } from "svelte";
  import { font } from "../font.svelte";
  import { i18n, t } from "../i18n.svelte";
  import { repo } from "../stores/repo.svelte";
  import { theme } from "../theme.svelte";
  import {
    lanePalette,
    layoutGraph,
    type GraphEdge,
    type GraphLayout,
    type GraphRow,
  } from "../graph/layout";
  import {
    LAND_MS,
    OPEN_LEAD_MS,
    OPEN_MS,
    PULSE_MS,
    RISE_MS,
    SLIDE_MS,
    climb,
    dotProgress,
    durationOf,
    freshCommits,
    morphProgress,
    movedLocalRefs,
    movedRemoteRefs,
    newLocalBranches,
    pulseProgress,
    openProgress,
    openedAbove,
    snapshot,
    trailFront,
    trailsOf,
    type Fresh,
    type NewBranch,
    type RefMove,
    type Seen,
    type Trails,
  } from "../graph/appear";
  import { flowBands, flowTips } from "../gitflow";
  import { groupRefs, type RefBadge } from "../graph/refs";
  import {
    MESSAGE,
    dropIndex,
    placeColumns,
    type ColumnId,
    type PlacedColumn,
  } from "../graph/columns";
  import { graphColumns } from "../graphColumns.svelte";
  import { graphLines } from "../graphLines.svelte";
  import { bucketLabel, bucketStarts, type TimeBucket } from "../graph/timeBuckets";
  import type { TreeCounts } from "../tree";
  import type { GraphCommit } from "../types";

  // ── Géométrie ──────────────────────────────────────────────────────────────
  // ROW_H est la seule chose qui aligne le canvas et le DOM : elle est appliquée
  // aux lignes en style inline, jamais en CSS, pour qu'elles ne puissent pas
  // diverger.
  //
  // Elle suit la taille du texte, parce que la rangée en porte : figée, elle le
  // rognerait dès la première taille au-dessus du défaut. Le facteur vaut
  // exactement 26 px à la taille par défaut — la géométrie du graph est donc
  // inchangée tant qu'on ne touche pas au réglage. Le canvas se redessine tout
  // seul, `draw` lisant ces dérivées.
  const ROW_H = $derived(Math.round(font.rootPx * 1.625));
  const LANE_W = 20;
  const DOT_R = 5;
  /** Épaisseur des lignes de lanes, et du cercle WIP. */
  const LINE_W = 1.6;
  /**
   * Rayon du cercle « modifications en cours » : même diamètre que le point
   * d'un commit. C'est le trait qui s'aligne sur `DOT_R`, pas son axe — un
   * cercle de rayon `DOT_R` déborderait d'une demi-épaisseur.
   */
  const WIP_R = DOT_R - LINE_W / 2;
  /** Motif de la ligne qui relie le nœud WIP à HEAD : ce lien n'est pas un commit. */
  const WIP_DASH = [3, 2.5];
  /**
   * Motif du cercle WIP lui-même, plus serré que celui de la ligne : sur un
   * cercle de cette taille, le motif de la ligne ne laisserait que trois
   * tirets. Six périodes font exactement le tour, sans raccord visible.
   */
  const WIP_RING_DASH = ((p) => [p * 0.6, p * 0.4])((2 * Math.PI * WIP_R) / 6);
  /**
   * Opacité du prolongement d'une branche pérenne au-dessus de sa pointe
   * (Git Flow) : sa couleur, en retrait — la colonne attend, l'historique
   * n'y est pas.
   */
  const GHOST_ALPHA = 0.35;
  /** Marge horizontale de la gouttière, de chaque côté des lanes. */
  const PAD_X = 8;
  /*
    Le graph est un tableau : Branch / Tag, Graph, Commit message, Author, Date,
    SHA — redimensionnables, déplaçables, masquables depuis l'en-tête. La
    disposition est commune à tous les dépôts (`graphColumns.svelte.ts`), son
    calcul pur et testé (`graph/columns.ts`).

    Une seule grille pour l'en-tête et les rangées : le même
    `grid-template-columns`, en pixels, posé en style inline sur les deux —
    c'est ce qui les garde alignés, comme `ROW_H` aligne le canvas sur les
    rangées. Les largeurs ne dépendent que de la disposition et de la taille du
    texte, jamais du contenu : mesurées sur les rangées montées, elles
    varieraient au défilement.
  */
  /** Largeur ajustée minimale du graph, en rem : de quoi lire son titre. */
  const GRAPH_MIN_REM = 4;
  /** Place réservée à droite de l'en-tête pour le bouton des colonnes. */
  const MENU_BTN_W = 28;
  /** Déplacement en deçà duquel un appui sur un en-tête n'est pas un glissement. */
  const DRAG_THRESHOLD = 4;
  /*
    Pastilles affichées au maximum, le reste tenant dans un « +n ». Deux tiennent
    dans la colonne ; au-delà elles se réduisent jusqu'à n'être plus qu'un
    contour et des icônes, ce qui ne nomme plus rien. Mieux vaut dire combien il
    en reste que les montrer illisibles. `groupRefs` les a triées par
    importance : ce qui est masqué est ce qui compte le moins.
  */
  const MAX_REFS = 2;
  /** Lanes réservées au minimum : évite que le texte colle au bord. */
  const MIN_LANES = 2;
  /** Rangées restantes sous le viewport qui déclenchent le chargement suivant. */
  const LOAD_AHEAD = 50;

  let scroller = $state<HTMLDivElement | null>(null);
  let canvas = $state<HTMLCanvasElement | null>(null);
  let scrollTop = $state(0);
  let viewportH = $state(0);
  /** Largeur utile des rangées (barre de défilement exclue). */
  let tableW = $state(0);
  let graphEl = $state<HTMLDivElement | null>(null);

  /*
    Pastille survolée dont le nom ne tient pas : on en montre une copie entière,
    posée exactement sur elle et libre de déborder sur les colonnes voisines.

    Une copie plutôt que la pastille elle-même élargie : la cellule et la
    rangée rognent ce qui dépasse (`overflow: hidden`), et c'est ce qui garde le
    tableau aligné — les lever, même le temps d'un survol, ferait déborder
    toutes les autres. La copie vit donc au niveau du graph, au-dessus du canvas
    et de l'en-tête, et ne capte pas la souris : c'est la vraie pastille, restée
    dessous, qui décide quand elle disparaît.
  */
  let peek = $state<{
    badge: RefBadge;
    lane: string;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  function onBadgeEnter(e: MouseEvent, badge: RefBadge, lane: string) {
    const el = e.currentTarget as HTMLElement;
    const name = el.querySelector<HTMLElement>(".bname");
    const cell = el.closest<HTMLElement>(".cell");
    if (!graphEl || !name || !cell) return;
    const r = el.getBoundingClientRect();
    const c = cell.getBoundingClientRect();
    // Tronquée par son ellipse, ou coupée par le bord de sa colonne.
    const hidden = name.scrollWidth > name.clientWidth || r.left < c.left || r.right > c.right;
    if (!hidden) return;
    const g = graphEl.getBoundingClientRect();
    // Alignées à droite, les pastilles d'une colonne trop étroite débordent
    // par la **gauche** : la copie repart alors du bord de la colonne, pour
    // toujours s'étendre vers la droite, jamais hors du tableau.
    const left = Math.max(r.left, c.left);
    peek = { badge, lane, x: left - g.left, y: r.top - g.top, width: r.right - left, height: r.height };
  }
  /** Onglet dont l'historique est actuellement affiché (détection de bascule). */
  let shownRepoId: string | null = null;
  /** Vrai le temps de rétablir le défilement après un changement d'onglet. */
  let restoring = false;

  /*
    Rangée « modifications en cours », en tête du graph — comme GitKraken.

    Elle se raccorde à HEAD, que `repoInfo` porte déjà (HEAD détaché compris), et
    n'apparaît qu'une fois le dépôt chargé : le statut arrive avant l'historique,
    sans quoi le nœud clignoterait seul, une ligne pendant dans le vide.
  */
  const wip = $derived(
    repo.loaded && repo.changeCount > 0
      ? { head: repo.repoInfo?.head ?? null }
      : null,
  );
  /*
    Git Flow : colonnes fixes à gauche (`main`, `stage`, `develop`…, dans
    l'ordre des paramètres du dépôt), le reste après. Éteint, `null`, et le
    placement est celui d'origine.
  */
  const bands = $derived(
    repo.flowEnabled
      ? flowBands(
          repo.graph,
          flowTips(repo.branches, repo.remoteBranches),
          repo.flowConfig.order,
        )
      : null,
  );
  /*
    Le graph ne montre jamais un état à moitié relu ; il garde ce qu'il
    montrait dans deux cas.

    - **Pendant un commit.** Le commit relit `repoInfo`, puis le statut — la
      rangée WIP disparaît, tout l'historique remonte d'un cran —, puis les
      branches, puis le graph — le nouveau commit arrive en tête, tout
      redescend. Figé, il passe d'un état à l'autre en une fois, et le cercle
      WIP peut se remplir sur place (voir `graph/appear.ts`).
    - **Quand HEAD a bougé mais pas encore l'historique.** Un commit fait
      ailleurs (terminal, autre client) arrive par la surveillance du disque,
      qui relit `repoInfo` avant le graph : le cercle WIP pendait alors vers un
      HEAD absent de l'historique chargé — une ligne pointillée vers le vide,
      les commits déportés d'une colonne, le graph élargi —, le temps d'une
      image. On attend que le graph soit relu (un nouveau tableau), quel qu'il
      soit : un HEAD hors de la première page ne bloque donc rien.

    Hors de là, rien n'est retenu : `held` n'est qu'une mémoire du dernier
    affichage.
  */
  let held: {
    repoId: string;
    layout: GraphLayout;
    graph: GraphCommit[];
    head: string | null;
  } | null = null;
  const layout = $derived.by(() => {
    const next = layoutGraph(repo.graph, wip, bands);
    const head = wip?.head ?? null;
    if (held?.repoId === repo.repoId) {
      if (repo.committing) return held.layout;
      const behind =
        head !== null &&
        head !== held.head &&
        repo.graph === held.graph &&
        !repo.graph.some((c) => c.oid === head);
      if (behind) return held.layout;
    }
    held = { repoId: repo.repoId, layout: next, graph: repo.graph, head };
    return next;
  });

  // ── Apparition des commits ─────────────────────────────────────────────────
  /*
    À chaque nouvel affichage, ce qui n'était pas là avant s'anime, en deux
    temps :

    1. **la place s'ouvre** (`opening`) : ce qui est sous les rangées nouvelles
       glisse vers le bas depuis où il était, au lieu d'y sauter, et les
       rangées nouvelles s'ouvrent en accordéon — les lignes qui les
       traversent s'étirent, sans jamais se rompre ;
    2. **les commits poussent**, de bas en haut (`appearing`) : chaque ligne
       nouvelle monte depuis le point du parent — sur autant de rangées qu'il
       faut, celle de la branche fusionnée d'un merge comprise —, et le point
       apparaît quand ses lignes l'atteignent. Le commit qu'on vient de faire,
       lui, n'ouvre rien : il remplit le cercle WIP.

    Le canvas lit l'horloge à chaque image (une boucle `requestAnimationFrame`
    tant qu'il reste quelque chose à animer) ; les rangées du DOM ont la même
    chose en animations CSS, déclenchées par `opening` et `freshRows`, sur la
    même courbe (`EASE_IN_OUT` = `easeInOutCubic`).

    Purement décoratif : rien n'attend la fin d'une animation, et tout se cale
    sur l'horloge réelle. `requestAnimationFrame` est suspendu quand la fenêtre
    ne se peint pas ; à la reprise, une animation déjà finie est simplement
    dessinée finie. Le réglage système « réduire les animations » coupe tout.
  */
  /** `easeInOutCubic` en CSS : le DOM glisse sur la même courbe que le canvas. */
  const EASE_IN_OUT = "cubic-bezier(0.65, 0, 0.35, 1)";
  /** Monte avec un rebond léger (~4 %) : la pastille se pose, elle ne saute pas. */
  const EASE_RISE = "cubic-bezier(0.34, 1.3, 0.64, 1)";
  /** Durée du fondu et du surlignage du texte d'une rangée nouvelle. */
  const FRESH_TEXT_MS = 1800;
  /**
   * Commits en train de pousser. `at` : arrivée de leurs lignes sur leur point
   * (horloge de `performance.now`) — ou départ du remplissage, pour le cercle
   * WIP ; `msPerRow` : vitesse de leurs lignes.
   */
  const appearing = new Map<string, { at: number; morph: boolean; msPerRow: number }>();
  /**
   * Lignes nouvelles des commits qui poussent, recalculées quand l'affichage
   * ou l'ensemble des commits change : un rechargement en pleine animation
   * (la surveillance du disque rapporte nos propres écritures ~300 ms après)
   * déplace les colonnes, pas les commits.
   */
  let trailCache: { layout: GraphLayout; version: number; trails: Trails } | null = null;
  let appearingVersion = 0;
  function currentTrails(): Trails {
    if (trailCache?.layout !== layout || trailCache.version !== appearingVersion) {
      const growing = new Set<string>();
      for (const [oid, a] of appearing) if (!a.morph) growing.add(oid);
      trailCache = { layout, version: appearingVersion, trails: trailsOf(layout, growing) };
    }
    return trailCache.trails;
  }
  /** Place en train de s'ouvrir : depuis quand, et pour quels commits. */
  let opening = $state.raw<{ start: number; oids: Set<string> } | null>(null);
  /** Rangées dont le texte s'anime, avec leur retard en ms. */
  let freshRows = $state.raw<Map<string, number>>(new Map());
  /** Index, dans l'affichage, des rangées qui s'ouvrent (croissants). */
  const opened = $derived.by(() => {
    if (!opening) return [];
    const oids = opening.oids;
    const out: number[] = [];
    layout.rows.forEach((row, i) => {
      if (row.kind === "commit" && oids.has(row.commit.oid)) out.push(i);
    });
    return out;
  });
  let seen: Seen | null = null;
  let frame = 0;
  let freshTimer: ReturnType<typeof setTimeout> | undefined;
  let openTimer: ReturnType<typeof setTimeout> | undefined;
  const reducedMotion =
    typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;

  function animate() {
    if (frame) return;
    const step = () => {
      frame = 0;
      draw();
      const stillOpening = opening !== null && performance.now() - opening.start < OPEN_MS;
      if (appearing.size > 0 || stillOpening || pulses.size > 0) {
        frame = requestAnimationFrame(step);
      }
    };
    frame = requestAnimationFrame(step);
  }

  /** Compare le nouvel affichage au précédent, et lance ce qui est nouveau. */
  function noticeChanges(repoId: string, next: GraphLayout) {
    const now = snapshot(repoId, next);
    const fresh = freshCommits(seen, now, next);
    const moves = [
      ...movedRemoteRefs(seen, now).map((move) => ({ move, local: false })),
      ...movedLocalRefs(seen, now).map((move) => ({ move, local: true })),
    ];
    const born = newLocalBranches(seen, now);
    seen = now;
    if (reducedMotion?.matches) return;
    const start = performance.now();
    if (fresh.length > 0) growCommits(next, fresh, start);
    // Après les commits : une branche qui arrive sur un commit nouveau — la
    // distante après un fetch, la locale après un commit — se pose avec son
    // point.
    if (moves.length > 0) launchFlights(next, moves, start);
    if (born.length > 0) welcomeBranches(next, born, start);
  }

  /** Lance l'ouverture de la place et la pousse des commits `fresh`. */
  function growCommits(next: GraphLayout, fresh: Fresh[], start: number) {
    // Le commit qui remplit le cercle WIP prend sa place : rien à ouvrir.
    const toOpen = new Set(fresh.filter((f) => !f.morph).map((f) => f.oid));
    // Les lignes montent une fois la place ouverte.
    const base = start + (toOpen.size > 0 ? OPEN_LEAD_MS : 0);
    const plan = climb(next, toOpen, trailsOf(next, toOpen));
    const delays = new Map<string, number>();
    for (const f of fresh) {
      const at = f.morph ? start : base + (plan.arrive.get(f.oid) ?? 0);
      appearing.set(f.oid, { at, morph: f.morph, msPerRow: plan.msPerRow });
      // Le texte arrive avec le point.
      delays.set(f.oid, Math.round(at - start));
    }
    appearingVersion++;
    freshRows = delays;
    clearTimeout(freshTimer);
    // Passé le plus long retard et le fondu, plus rien à marquer.
    freshTimer = setTimeout(
      () => (freshRows = new Map()),
      Math.max(...delays.values()) + FRESH_TEXT_MS,
    );
    clearTimeout(openTimer);
    if (toOpen.size > 0) {
      opening = { start, oids: toOpen };
      // Retiré après coup : une rangée montée plus tard (défilement) ne doit
      // pas rejouer le glissement.
      openTimer = setTimeout(() => (opening = null), OPEN_MS + 50);
    } else {
      opening = null;
    }
    animate();
  }

  // ── Branches qui glissent ──────────────────────────────────────────────────
  /*
    Une branche arrivée sur un autre commit ne saute pas d'une rangée à
    l'autre : une copie de sa pastille glisse de son ancienne place vers la
    nouvelle, puis s'efface pendant que l'arrivée se pose.

    - **Distante** — un push l'amène sur le commit local qu'on vient de
      publier, un fetch sur ce qu'il a téléchargé : c'est l'icône du serveur
      qui se pose sur la pastille d'arrivée (ou la pastille entière, quand
      aucune branche locale ne l'accueille). Au premier push, rien ne glisse :
      l'icône se pose sur place.
    - **Locale** — un commit la fait monter d'un cran, un pull en avance
      rapide ou un merge sur une branche inactive plus haut : la copie porte
      son nom (et la coche si c'est la branche courante), et c'est la pastille
      entière qui se pose (`badgeLandings`) — l'icône d'écran seule ne dirait
      pas qu'une branche est arrivée. Une branche *nouvelle* n'est pas un
      déplacement : elle monte à sa place (plus bas).

    Tout est en CSS, posé en style : la copie (`flights`) part de sa place
    d'avant (`--dx`, `--dy`) et va vers celle de la pastille d'arrivée, mesurée
    dans le DOM juste après le rendu du nouvel affichage ; l'arrivée
    (`landings`) attend la fin du glissement pour apparaître. La place d'avant
    n'existe plus dans le DOM : c'est le bord droit de la colonne, où une
    pastille distante seule sur sa rangée se trouve.
  */
  interface Flight {
    key: string;
    badge: RefBadge;
    color: string;
    /** Place d'arrivée, dans le contenu défilant. */
    top: number;
    right: number;
    height: number;
    /** D'où elle part, relativement à l'arrivée. */
    dx: number;
    dy: number;
    delay: number;
  }
  /** Marge horizontale d'une cellule (`.cell`), en rem. */
  const CELL_PAD_REM = 0.5;
  let flights = $state.raw<Flight[]>([]);
  /** Arrivées distantes à animer : `oid|clé de pastille` → retard en ms. */
  let landings = $state.raw<Map<string, number>>(new Map());
  /** Arrivées locales — la pastille entière : `oid|clé de pastille` → retard. */
  let badgeLandings = $state.raw<Map<string, number>>(new Map());
  let flightTimer: ReturnType<typeof setTimeout> | undefined;

  function launchFlights(
    next: GraphLayout,
    moves: { move: RefMove; local: boolean }[],
    start: number,
  ) {
    const index = new Map<string, number>();
    next.rows.forEach((r, i) => {
      if (r.kind === "commit") index.set(r.commit.oid, i);
    });
    const refsCol = placed.find((c) => c.id === "refs");
    const spacer = scroller?.firstElementChild as HTMLElement | null;
    const lands = new Map<string, number>();
    const wholeLands = new Map<string, number>();
    const out: Flight[] = [];
    for (const { move: m, local } of moves) {
      const to = index.get(m.to);
      const row = to !== undefined ? next.rows[to] : undefined;
      if (to === undefined || row?.kind !== "commit") continue;
      // Rien à faire arriver sur une pastille cachée sous le « +n ».
      const badge = groupRefs(row.commit.refs)
        .slice(0, MAX_REFS)
        .find((b) => (local ? b.local && b.name === m.name : b.remotes.includes(m.name)));
      if (!badge) continue;
      // Elle se pose quand le commit est là : tout de suite s'il l'était,
      // avec son point s'il apparaît.
      const dotAt = appearing.get(m.to)?.at ?? start;
      const from = m.from !== null ? index.get(m.from) : undefined;
      const landAt = from !== undefined ? Math.max(dotAt, start + SLIDE_MS) : dotAt;
      // L'arrivée commence un peu avant la fin du glissement : la copie
      // s'efface pendant que l'icône se pose, sans blanc entre les deux.
      const overlap = from !== undefined ? SLIDE_MS * 0.15 : 0;
      (local ? wholeLands : lands).set(`${m.to}|${badge.key}`, Math.round(landAt - start - overlap));
      if (from === undefined || !refsCol || !spacer) continue;
      const rowEl = spacer.querySelector<HTMLElement>(`[data-oid="${m.to}"]`);
      const badgeEl = rowEl?.querySelector<HTMLElement>(`[data-badge="${CSS.escape(badge.key)}"]`);
      if (!rowEl || !badgeEl) continue;
      // Écarts mesurés dans la rangée : insensibles au glissement qu'elle
      // pourrait être en train de faire.
      const rr = rowEl.getBoundingClientRect();
      const br = badgeEl.getBoundingClientRect();
      const right = br.right - rr.left;
      const startRight = refsCol.x + refsCol.width - CELL_PAD_REM * font.rootPx;
      const fromRow = next.rows[from];
      out.push({
        key: `${local ? "l" : "r"}:${m.name}@${start}`,
        // Une locale voyage seule, sans les distantes qui l'attendaient peut-
        // être à l'arrivée : c'est elle qui bouge, pas elles.
        badge: local
          ? {
              name: m.name,
              isHead: badge.isHead,
              local: true,
              tag: false,
              remotes: [],
              title: m.name,
              key: "l:" + m.name,
            }
          : {
              name: m.name,
              isHead: false,
              local: false,
              tag: false,
              remotes: [m.name],
              title: m.name,
              key: "r:" + m.name,
            },
        color: lanes[fromRow.color],
        top: rowEl.offsetTop + (br.top - rr.top),
        right: spacer.clientWidth - right,
        height: br.height,
        dx: startRight - right,
        dy: (from - to) * ROW_H,
        delay: Math.round(landAt - start - SLIDE_MS),
      });
    }
    landings = lands;
    badgeLandings = wholeLands;
    flights = out;
    clearTimeout(flightTimer);
    flightTimer = setTimeout(
      () => {
        flights = [];
        landings = new Map();
        badgeLandings = new Map();
      },
      Math.max(0, ...lands.values(), ...wholeLands.values()) + LAND_MS + 50,
    );
  }

  // ── Branches nouvelles ─────────────────────────────────────────────────────
  /*
    Une branche créée — barre, menus, Git Flow, branche distante extraite, ou
    terminal — n'a pas de commit à elle : ce qui naît, c'est sa pastille. Elle
    monte à sa place depuis un peu plus bas (`rising`, `graph-ref-rise`), et
    une onde part du point d'où elle naît (`pulses`, sur le canvas) : c'est là
    que la branche commence. Sur un commit qui apparaît lui-même, les deux
    attendent son point.
  */
  /** Pastilles de branches nouvelles : `oid|clé de pastille` → retard en ms. */
  let rising = $state.raw<Map<string, number>>(new Map());
  /** Ondes en cours : commit → départ (horloge de `performance.now`). */
  const pulses = new Map<string, number>();
  let riseTimer: ReturnType<typeof setTimeout> | undefined;

  function welcomeBranches(next: GraphLayout, born: NewBranch[], start: number) {
    const rise = new Map<string, number>();
    for (const b of born) {
      const at = appearing.get(b.at)?.at ?? start;
      rise.set(`${b.at}|l:${b.name}`, Math.round(at - start));
      pulses.set(b.at, at);
    }
    rising = rise;
    clearTimeout(riseTimer);
    riseTimer = setTimeout(
      () => (rising = new Map()),
      Math.max(0, ...rise.values()) + Math.max(RISE_MS, PULSE_MS) + 50,
    );
    animate();
  }

  /**
   * Animations CSS d'une rangée (ou d'un séparateur) : le glissement depuis
   * sa place d'avant, si une rangée s'ouvre au-dessus d'elle, et le fondu de
   * son texte si elle est nouvelle. `--shift` dit de combien elle glisse.
   */
  function rowMotion(row: GraphRow | null, index: number): { animation?: string; shift?: string } {
    const oid = row?.kind === "commit" ? row.commit.oid : null;
    const parts: string[] = [];
    let shift: string | undefined;
    if (opening && !(oid !== null && opening.oids.has(oid))) {
      const above = openedAbove(opened, index);
      if (above > 0) {
        parts.push(`graph-row-shift ${OPEN_MS}ms ${EASE_IN_OUT} both`);
        shift = `${above * ROW_H}px`;
      }
    }
    const fade = oid !== null ? freshRows.get(oid) : undefined;
    if (fade !== undefined) parts.push(`graph-row-fresh ${FRESH_TEXT_MS}ms ease-in-out ${fade}ms both`);
    return { animation: parts.length > 0 ? parts.join(", ") : undefined, shift };
  }

  $effect(() => {
    const next = layout;
    const id = repo.repoId;
    untrack(() => noticeChanges(id, next));
  });

  $effect(() => () => {
    cancelAnimationFrame(frame);
    clearTimeout(freshTimer);
    clearTimeout(openTimer);
    clearTimeout(flightTimer);
    clearTimeout(riseTimer);
  });
  const counts = $derived(repo.changeCounts);
  /*
    La rangée WIP est en surbrillance quand c'est bien elle qu'on regarde, soit
    quand aucun commit n'est sélectionné : c'est exactement là que la colonne de
    droite montre le working directory. Aucun état de plus, donc rien qui puisse
    diverger de ce qui est affiché.
  */
  const wipSelected = $derived(repo.selectedCommitOid === null);
  /*
    Le canvas ne voit pas les variables CSS : le thème lui parvient par le
    store, et le redessin suit tout seul — `draw` lit ces dérivées, donc son
    effet se réexécute quand la palette change.

    `ring` détache le point de la ligne de même couleur qui le traverse : c'est
    le fond du thème. Le commit sélectionné n'a pas de marque sur le canvas :
    le fond de sa ligne suffit à le désigner.
  */
  const lanes = $derived(lanePalette(theme.dark));
  const ring = $derived(
    theme.dark ? "rgba(0, 0, 0, 0.55)" : "rgba(255, 255, 255, 0.9)",
  );
  /** Largeur ajustée du graph : celle qu'il prend tant qu'on n'en a pas choisi. */
  const gutterW = $derived(
    PAD_X * 2 + Math.max(layout.laneCount, MIN_LANES) * LANE_W,
  );

  // ── Colonnes ───────────────────────────────────────────────────────────────
  const LABELS = $derived<Record<ColumnId, string>>({
    refs: t("graph.col.refs"),
    graph: t("graph.col.graph"),
    message: t("graph.col.message"),
    author: t("graph.col.author"),
    date: t("graph.col.date"),
    sha: t("graph.col.sha"),
  });
  /** L'en-tête a la hauteur d'une rangée : il en est la première. */
  const HEAD_H = $derived(ROW_H);
  const placed = $derived(
    placeColumns(graphColumns.columns, {
      availablePx: Math.max(0, tableW - MENU_BTN_W),
      rootPx: font.rootPx,
      // Jamais plus étroit que son titre : sur un historique linéaire, deux
      // lanes ne laisseraient lire que « Gr… ».
      graphAutoPx: Math.max(gutterW, GRAPH_MIN_REM * font.rootPx),
    }),
  );
  const template = $derived(placed.map((c) => `${c.width}px`).join(" "));
  /** Colonne du graph, ou `null` si elle est masquée — plus rien à dessiner. */
  const graphCol = $derived(placed.find((c) => c.id === "graph") ?? null);
  const messageIndex = $derived(placed.findIndex((c) => c.id === MESSAGE));

  /*
    Déplacement d'une colonne par son en-tête. Même mécanique que les onglets
    (`TabBar`) : événements pointeur plutôt que glisser-déposer HTML5, et la
    géométrie mesurée à l'appui vaut pour tout le geste. Seul l'en-tête glissé
    bouge ; un trait montre où il va tomber, et le tableau ne change qu'au
    lâcher — les rangées n'ont pas à se réorganiser à chaque image.
  */
  let colDrag = $state<{
    id: ColumnId;
    from: number;
    startX: number;
    /** Disposition au moment de l'appui : c'est contre elle qu'on décide. */
    origin: PlacedColumn[];
    offset: number;
    started: boolean;
  } | null>(null);

  /** Index d'insertion visé par le glissement en cours. */
  const dropAt = $derived(
    colDrag?.started
      ? dropIndex(colDrag.origin, colDrag.from, colDrag.origin[colDrag.from].x + colDrag.offset)
      : null,
  );
  /** Abscisse du trait de dépôt, `null` quand le lâcher ne changerait rien. */
  const dropX = $derived.by(() => {
    if (!colDrag || dropAt === null) return null;
    if (dropAt === colDrag.from || dropAt === colDrag.from + 1) return null;
    const last = colDrag.origin[colDrag.origin.length - 1];
    return dropAt < colDrag.origin.length ? colDrag.origin[dropAt].x : last.x + last.width;
  });

  function onHeadDown(e: PointerEvent, index: number) {
    if (e.button !== 0) return;
    const col = placed[index];
    colDrag = {
      id: col.id,
      from: index,
      startX: e.clientX,
      origin: placed.map((c) => ({ ...c })),
      offset: 0,
      started: false,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onHeadMove(e: PointerEvent) {
    if (!colDrag) return;
    const dx = e.clientX - colDrag.startX;
    if (!colDrag.started && Math.abs(dx) < DRAG_THRESHOLD) return;
    colDrag.started = true;
    // L'en-tête glissé reste dans les bornes du tableau, comme un onglet dans
    // la barre.
    const col = colDrag.origin[colDrag.from];
    const last = colDrag.origin[colDrag.origin.length - 1];
    const maxLeft = last.x + last.width - col.width;
    colDrag.offset = Math.min(Math.max(col.x + dx, 0), maxLeft) - col.x;
  }

  function onHeadUp() {
    if (!colDrag) return;
    const { id, from, origin } = colDrag;
    const at = dropAt;
    colDrag = null;
    if (at === null || at === from || at === from + 1) return;
    // L'index d'insertion compte encore la colonne glissée : la colonne qui
    // l'occupe est donc celle devant laquelle se poser, des deux côtés.
    graphColumns.move(id, at < origin.length ? origin[at].id : null);
  }

  /*
    Redimensionnement, par une poignée sur le bord de l'en-tête. Le message est
    élastique, et c'est ce qui décide du bord : une colonne à sa gauche se tire
    par son bord droit, une colonne à sa droite par son bord gauche — celui qui
    touche le message, puisque l'autre est collé au bord du tableau.
  */
  let resize: { id: ColumnId; startX: number; startW: number; sign: 1 | -1 } | null = null;

  function onGripDown(e: PointerEvent, col: PlacedColumn, sign: 1 | -1) {
    if (e.button !== 0) return;
    // Ni déplacement de la colonne, ni sélection de texte.
    e.stopPropagation();
    e.preventDefault();
    resize = { id: col.id, startX: e.clientX, startW: col.width, sign };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    // Le curseur reste celui du redimensionnement même hors de la poignée
    // (`app.css`), comme pour les colonnes latérales.
    document.body.classList.add("resizing");
  }

  function onGripMove(e: PointerEvent) {
    if (!resize) return;
    graphColumns.setWidthPx(resize.id, resize.startW + resize.sign * (e.clientX - resize.startX));
  }

  function onGripUp() {
    resize = null;
    document.body.classList.remove("resizing");
  }

  // ── Menu des colonnes ──────────────────────────────────────────────────────
  let columnsMenu = $state<{ x: number; y: number } | null>(null);
  const COLUMNS_MENU_W = 220;

  function openColumnsMenu(e: MouseEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    columnsMenu = {
      x: Math.max(8, Math.min(r.right - COLUMNS_MENU_W, window.innerWidth - COLUMNS_MENU_W - 8)),
      y: r.bottom + 2,
    };
  }

  // ── Menu d'une rangée ──────────────────────────────────────────────────────
  // Deux entrées, et pas davantage : le graph reste en lecture seule — aucun
  // checkout, reset ni revert d'ici. Poser un tag n'écrit qu'une référence ;
  // créer une branche en écrit une et bascule dessus, ce qui passe par la barre
  // de saisie et par la même bascule SAFE que partout ailleurs.
  let rowMenu = $state<{ x: number; y: number; commit: GraphCommit } | null>(null);
  const ROW_MENU_W = 240;
  const ROW_MENU_H = 112;

  /**
   * Clic droit sur une rangée de commit. La sélection ne change pas : le menu
   * nomme le commit visé, et la colonne de droite reste ce qu'elle était. La
   * rangée WIP garde le menu natif — son champ de résumé a besoin du
   * copier-coller.
   */
  function openRowMenu(e: MouseEvent, row: GraphRow) {
    if (row.kind !== "commit") return;
    e.preventDefault();
    rowMenu = {
      x: Math.max(8, Math.min(e.clientX, window.innerWidth - ROW_MENU_W - 8)),
      y: Math.max(8, Math.min(e.clientY, window.innerHeight - ROW_MENU_H - 8)),
      commit: row.commit,
    };
  }

  function createBranchHere() {
    const commit = rowMenu?.commit;
    rowMenu = null;
    if (commit) repo.askBranch({ oid: commit.oid, from: commit.shortOid });
  }

  function createTagHere() {
    const commit = rowMenu?.commit;
    rowMenu = null;
    if (commit) repo.askTag(commit);
  }

  // Fenêtre de rangées réellement montées (virtualisation).
  const first = $derived(Math.max(0, Math.floor(scrollTop / ROW_H) - 1));
  // Pendant qu'une place s'ouvre, les rangées remontées laissent entrer par le
  // bas celles qui étaient juste sous la fenêtre.
  const visible = $derived(
    layout.rows.slice(first, first + Math.ceil(viewportH / ROW_H) + 3 + opened.length),
  );

  // Dérivé, et non figé au montage : c'est la langue qui décide du format, et
  // le graph reste monté d'un onglet à l'autre.
  const dateFmt = $derived(
    new Intl.DateTimeFormat(i18n.locale, {
      day: "2-digit",
      month: "short",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }),
  );

  /*
    Tranches de temps, comme GitKraken : entre deux commits de tranches
    différentes, un trait qui porte l'âge de la nouvelle (« 3 hours ago »),
    dans sa continuité. Seulement quand la colonne Date est masquée : affichée,
    elle dit déjà la même chose, rangée par rangée. `now` avance chaque minute
    — sans lui, un commit resterait « this hour » toute la journée.
  */
  let now = $state(Math.floor(Date.now() / 1000));
  $effect(() => {
    const timer = setInterval(() => (now = Math.floor(Date.now() / 1000)), 60_000);
    return () => clearInterval(timer);
  });
  const relFmt = $derived(new Intl.RelativeTimeFormat(i18n.locale, { numeric: "auto" }));
  /** Tranche ouverte par chaque rangée, alignée sur `layout.rows` (WIP : `null`). */
  const bucketAt = $derived.by(() => {
    const indexes: number[] = [];
    const stamps: number[] = [];
    layout.rows.forEach((row, i) => {
      if (row.kind !== "commit") return;
      indexes.push(i);
      stamps.push(row.commit.timestamp);
    });
    const starts = bucketStarts(stamps, now);
    const out: (TimeBucket | null)[] = new Array(layout.rows.length).fill(null);
    indexes.forEach((rowIndex, k) => (out[rowIndex] = starts[k]));
    return out;
  });

  const dateShown = $derived(placed.some((c) => c.id === "date"));

  /**
   * Séparateurs visibles : un par rangée qui ouvre une tranche, posé sur sa
   * frontière haute. Il faut une rangée au-dessus — le WIP compris : sur la
   * toute première, l'étiquette centrée sur le bord serait coupée en deux.
   */
  const separators = $derived.by(() => {
    if (dateShown) return [];
    const out: { index: number; label: string }[] = [];
    visible.forEach((_, i) => {
      const index = first + i;
      const bucket = bucketAt[index];
      if (bucket && index > 0) out.push({ index, label: bucketLabel(bucket, relFmt) });
    });
    return out;
  });

  function formatDate(ts: number): string {
    return dateFmt.format(new Date(ts * 1000));
  }

  /** Clé `{#each}` : les commits ont leur oid, la rangée WIP est unique. */
  function rowKey(row: GraphRow): string {
    return row.kind === "wip" ? "wip" : row.commit.oid;
  }

  function isSelected(row: GraphRow): boolean {
    return row.kind === "wip" ? wipSelected : row.commit.oid === repo.selectedCommitOid;
  }

  /** Clic ou Entrée sur une rangée : détail du commit, ou changements en cours. */
  function activate(row: GraphRow) {
    if (row.kind === "wip") repo.selectWip();
    else repo.selectCommit(row.commit.oid);
  }

  /** Détail de la pastille de compteurs ("4 modified, 2 added"). */
  function countsLabel(c: TreeCounts): string {
    const parts: string[] = [];
    if (c.modified) parts.push(t("graph.counts.modified", { n: c.modified }));
    if (c.added) parts.push(t("graph.counts.added", { n: c.added }));
    if (c.deleted) parts.push(t("graph.counts.deleted", { n: c.deleted }));
    return parts.join(", ");
  }

  function laneX(lane: number): number {
    return PAD_X + lane * LANE_W + LANE_W / 2;
  }

  /*
    Passage d'une colonne à l'autre, dans le tracé choisi dans les paramètres
    (`graphLines`) : angle droit arrondi (par défaut, comme GitKraken), angle
    droit vif, courbe en S, ou diagonale droite. Pour les deux angles droits, le
    sens du coude dépend du segment :

    - `vertical-first` : la ligne descend dans sa colonne, puis tourne pour
      rejoindre le point à l'horizontale — une branche qui **arrive** sur le
      commit dont elle part (segment `in`) ;
    - `horizontal-first` : la ligne part du point à l'horizontale jusqu'à sa
      colonne, puis descend — un merge vers son second parent, ou une branche
      qui **repart** (segment `out`).

    Les horizontales sont donc toujours à la hauteur d'un point : c'est là
    qu'une rangée n'a qu'un seul nœud, et qu'aucun autre ne peut se trouver sur
    le trajet. Même colonne : ligne droite.
  */
  function link(
    ctx: CanvasRenderingContext2D,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    turn: "vertical-first" | "horizontal-first",
  ) {
    const style = graphLines.style;
    if (x1 === x2 || style === "diagonal") {
      ctx.lineTo(x2, y2);
      return;
    }
    // L'arrondi choisi dans les paramètres, de 0 à 1.
    const k = graphLines.roundness / 100;
    if (style === "curve") {
      // Tension : les poignées partent des extrémités vers l'autre bout, d'une
      // fraction `k` de la hauteur. 0 : quasi droite ; ½ : le S d'origine ; 1 :
      // un S qui ne quitte sa colonne qu'au milieu.
      const dy = y2 - y1;
      ctx.bezierCurveTo(x1, y1 + k * dy, x2, y2 - k * dy, x2, y2);
      return;
    }
    // Angle droit : l'arrondi va du vif (0) au quart de cercle (1), borné par
    // le plus court des deux côtés du coude. Vif : un rayon nul, que `arcTo`
    // trace en angle.
    const r = style === "sharp" ? 0 : k * Math.min(Math.abs(x2 - x1), Math.abs(y2 - y1));
    if (turn === "vertical-first") ctx.arcTo(x1, y2, x2, y2, r);
    else ctx.arcTo(x2, y1, x2, y2, r);
    ctx.lineTo(x2, y2);
  }

  /**
   * Trace un segment d'une rangée. `outY` est l'ordonnée d'où repart ce qui
   * quitte le point (sous le cercle WIP, qui est vide) ; `dotR`, le rayon du
   * point de la rangée, auquel s'arrête un prolongement Git Flow qui l'atteint.
   */
  function strokeEdge(
    ctx: CanvasRenderingContext2D,
    edge: GraphEdge,
    rowLane: number,
    top: number,
    mid: number,
    outY: number,
    dotR: number,
  ) {
    const x1 = laneX(edge.fromLane);
    const x2 = laneX(edge.toLane);
    ctx.strokeStyle = lanes[edge.color];
    if (edge.ghost) {
      // Prolongement Git Flow : une verticale atténuée, qui s'arrête au
      // bord du point quand elle l'atteint — le cercle WIP est vide, elle
      // le barrerait.
      const r = rowLane === edge.fromLane ? dotR : 0;
      const bottom = top + ROW_H;
      const spans =
        edge.ghost === "top" ? [[top, mid - r]]
        : edge.ghost === "bottom" ? [[mid + r, bottom]]
        : r > 0 ? [[top, mid - r], [mid + r, bottom]]
        : [[top, bottom]];
      const alpha = ctx.globalAlpha;
      ctx.globalAlpha = alpha * GHOST_ALPHA;
      ctx.beginPath();
      for (const [y1, y2] of spans) {
        ctx.moveTo(x1, y1);
        ctx.lineTo(x1, y2);
      }
      ctx.stroke();
      ctx.globalAlpha = alpha;
      return;
    }
    // Ligne WIP → HEAD : pointillés, comme le nœud. Le décalage se cale sur
    // la position **absolue** du segment dans le graph, pas sur la vue :
    // chaque rangée trace son morceau à part, et sans ça le motif
    // repartirait de zéro à chaque rangée et glisserait au défilement.
    if (edge.dashed) {
      ctx.setLineDash(WIP_DASH);
      ctx.lineDashOffset = (edge.kind === "out" ? outY : top) + scrollTop;
    }
    ctx.beginPath();
    if (edge.kind === "through") {
      ctx.moveTo(x1, top);
      ctx.lineTo(x1, top + ROW_H);
    } else if (edge.kind === "in") {
      // Descend du haut de la rangée jusqu'au point du commit.
      ctx.moveTo(x1, top);
      link(ctx, x1, top, x2, mid, "vertical-first");
    } else {
      // Repart du point vers la rangée suivante.
      ctx.moveTo(x1, outY);
      link(ctx, x1, outY, x2, top + ROW_H, "horizontal-first");
    }
    ctx.stroke();
    if (edge.dashed) ctx.setLineDash([]);
  }

  /** Cercle vide en pointillés du nœud « modifications en cours ». */
  function strokeWipRing(ctx: CanvasRenderingContext2D, x: number, mid: number, color: string) {
    // Dans la couleur de la lane de HEAD : ces modifications sont sur cette
    // branche, mais ne sont pas un commit.
    ctx.setLineDash(WIP_RING_DASH);
    ctx.lineDashOffset = 0;
    ctx.beginPath();
    ctx.arc(x, mid, WIP_R, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /**
   * Point d'un commit. L'anneau le détache de la ligne qui le traverse (même
   * couleur) et reste lisible quelle que soit la surbrillance de la ligne, sur
   * laquelle le canvas est superposé.
   */
  function fillDot(ctx: CanvasRenderingContext2D, x: number, mid: number, r: number, color: string) {
    ctx.beginPath();
    ctx.arc(x, mid, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = ring;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.lineWidth = LINE_W;
  }

  /**
   * Redessine la portion visible du graph.
   *
   * Le canvas ne couvre que le viewport (pas toute la hauteur de l'historique) :
   * il est en overlay au-dessus du conteneur scrollable et on décale le dessin de
   * `scrollTop`. C'est ce qui permet d'afficher des dizaines de milliers de
   * commits sans surface géante ni nœud DOM par ligne.
   *
   * Un commit en cours d'apparition (`appearing`) est dessiné à l'étape où il
   * en est : sa rangée tracée de bas en haut jusqu'à `reveal`, son point à
   * l'échelle `dot` — ou, s'il remplace le cercle WIP, le trait plein qui
   * monte du parent puis ce cercle qui s'efface pendant qu'un disque grandit.
   */
  function draw() {
    const cv = canvas;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    // Une colonne plus étroite que le graph le rogne : ce qui dépasse n'est
    // simplement pas sur le canvas.
    const w = graphCol?.width ?? 0;
    const h = viewportH;
    // Redimensionner réinitialise le contexte : on ne le fait qu'en cas de besoin.
    const dpr = window.devicePixelRatio || 1;
    const pw = Math.max(1, Math.round(w * dpr));
    const ph = Math.max(1, Math.round(h * dpr));
    if (cv.width !== pw || cv.height !== ph) {
      cv.width = pw;
      cv.height = ph;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = LINE_W;

    const now = performance.now();
    // Les animations finies sont retirées toutes, visibles ou non : une
    // rangée nouvelle hors de l'écran ferait sinon tourner la boucle sans fin.
    for (const [oid, a] of appearing) {
      if (now - a.at >= durationOf(a.morph)) {
        appearing.delete(oid);
        appearingVersion++;
      }
    }
    for (const [oid, at] of pulses) {
      if (now - at >= PULSE_MS) pulses.delete(oid);
    }
    const trails = currentTrails();
    // Ouverture de la place des rangées nouvelles : `open` va de 0 à 1. Une
    // rangée qui s'ouvre est écrasée à `open` de sa hauteur ; une rangée sous
    // `n` rangées qui s'ouvrent est remontée de `(1 − open) · n` rangées — là
    // d'où elle vient.
    const open = opening ? openProgress(now - opening.start) : 1;
    const squeezing = open < 1;

    const from = Math.max(0, Math.floor(scrollTop / ROW_H) - 1);
    // Remontées, des rangées de plus entrent par le bas.
    const extra = squeezing ? opened.length : 0;
    const to = Math.min(layout.rows.length, from + Math.ceil(h / ROW_H) + 3 + extra);
    let above = squeezing ? openedAbove(opened, from) : 0;

    for (let i = from; i < to; i++) {
      const row = layout.rows[i];
      const top = (i - (1 - open) * above) * ROW_H - scrollTop;
      const opens =
        squeezing && row.kind === "commit" && opening!.oids.has(row.commit.oid);
      if (opens) {
        above++;
        // Dessinée chez elle puis écrasée : les lignes qui la traversent
        // s'étirent avec elle, sans se rompre.
        ctx.save();
        ctx.translate(0, top);
        ctx.scale(1, open);
        drawRow(ctx, row, i, 0, w, now, trails);
        ctx.restore();
      } else {
        drawRow(ctx, row, i, top, w, now, trails);
      }
    }
  }

  /**
   * La rangée `index` du canvas, à l'ordonnée `top`, à l'étape où en est son
   * apparition.
   */
  function drawRow(
    ctx: CanvasRenderingContext2D,
    row: GraphRow,
    index: number,
    top: number,
    w: number,
    now: number,
    trails: Trails,
  ) {
    const mid = top + ROW_H / 2;
    const isWip = row.kind === "wip";
    // Le nœud WIP est un cercle vide : son segment part de sous le cercle et
    // non de son centre, qui le barrerait. Rien ne descend jamais sur lui.
    const outY = isWip ? mid + WIP_R : mid;
    const dotR = isWip ? WIP_R : DOT_R;
    const x = laneX(row.lane);
    const color = lanes[row.color];

    const a = row.kind === "commit" ? appearing.get(row.commit.oid) : undefined;

    if (a?.morph) {
      const anim = morphProgress(now - a.at);
      for (const edge of row.edges) {
        if (edge.kind !== "out" || edge.fromLane !== row.lane) {
          strokeEdge(ctx, edge, row.lane, top, mid, outY, dotR);
          continue;
        }
        // La ligne vers le parent : le pointillé d'avant s'efface pendant
        // que le trait plein monte du parent vers le point.
        ctx.globalAlpha = 1 - anim.reveal;
        strokeEdge(ctx, { ...edge, dashed: true }, row.lane, top, mid, mid + WIP_R, dotR);
        ctx.globalAlpha = 1;
        const span = (top + ROW_H - mid) * anim.reveal;
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, top + ROW_H - span, w, span);
        ctx.clip();
        strokeEdge(ctx, edge, row.lane, top, mid, outY, dotR);
        ctx.restore();
      }
      ctx.globalAlpha = 1 - anim.dot;
      strokeWipRing(ctx, x, mid, color);
      ctx.globalAlpha = 1;
      if (anim.dot > 0) fillDot(ctx, x, mid, DOT_R * anim.dot, color);
    } else {
      // Un segment d'une ligne nouvelle n'est dessiné que sous le bout de
      // cette ligne, qui monte du parent vers le commit qui la tire. Le
      // reste — ce qui était là avant — est dessiné tel quel.
      const segments = row.kind === "commit" ? trails.byRow.get(row.commit.oid) : undefined;
      row.edges.forEach((edge, ei) => {
        const t = segments?.get(ei);
        const trail = t !== undefined ? trails.list[t] : undefined;
        const owner = trail ? appearing.get(trail.child) : undefined;
        if (!trail || !owner || owner.morph) {
          strokeEdge(ctx, edge, row.lane, top, mid, outY, dotR);
          return;
        }
        const front = trailFront(trail, now - owner.at, owner.msPerRow);
        if (front >= trail.bottom) return;
        ctx.save();
        ctx.beginPath();
        const y = top + (front - index) * ROW_H;
        ctx.rect(0, y, w, top + ROW_H - y);
        ctx.clip();
        strokeEdge(ctx, edge, row.lane, top, mid, outY, dotR);
        ctx.restore();
      });

      if (isWip) strokeWipRing(ctx, x, mid, color);
      else if (!a) fillDot(ctx, x, mid, DOT_R, color);
      else {
        // Le point apparaît quand ses lignes l'atteignent.
        const p = dotProgress(now - a.at);
        if (p.dot > 0) {
          ctx.globalAlpha = p.alpha;
          fillDot(ctx, x, mid, DOT_R * p.dot, color);
          ctx.globalAlpha = 1;
        }
      }
    }

    // L'onde d'une branche qui naît ici : un anneau qui s'élargit et s'éteint.
    const pulse = row.kind === "commit" ? pulses.get(row.commit.oid) : undefined;
    if (pulse !== undefined) {
      const p = pulseProgress(now - pulse);
      if (p.alpha > 0) {
        ctx.beginPath();
        ctx.arc(x, mid, DOT_R + 2 + 9 * p.radius, 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.7 * p.alpha;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.lineWidth = LINE_W;
      }
    }
  }

  /** Charge la page suivante avant d'arriver réellement au bout. */
  function maybeLoadMore() {
    if (!repo.graphHasMore || repo.graphLoading) return;
    const lastVisible = Math.floor((scrollTop + viewportH) / ROW_H);
    if (lastVisible >= layout.rows.length - LOAD_AHEAD) repo.loadMoreGraph();
  }

  function onScroll() {
    if (!scroller) return;
    // Pendant une bascule d'onglet, le navigateur émet un scroll parasite en
    // ramenant la position dans les bornes du nouvel historique (souvent plus
    // court). L'enregistrer écraserait la position mémorisée de cet onglet.
    if (restoring) return;
    // La copie est posée en coordonnées fixes : elle ne suivrait pas la rangée.
    peek = null;
    scrollTop = scroller.scrollTop;
    repo.graphScrollTop = scrollTop;
    maybeLoadMore();
  }

  function onRowKey(e: KeyboardEvent, row: GraphRow) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      activate(row);
    }
  }

  /**
   * Clavier du champ de résumé de la rangée WIP. La rangée écoute déjà Entrée
   * et l'espace pour se sélectionner : sans arrêt de la propagation, taper une
   * espace ici serait avalé par son `preventDefault`. Entrée et Échap ne font
   * que sortir du champ — committer demande des fichiers indexés, et reste au
   * bouton de la boîte de commit.
   */
  function onSummaryKey(e: KeyboardEvent & { currentTarget: HTMLInputElement }) {
    e.stopPropagation();
    if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
  }

  // Tous les onglets partagent ce composant : en changer remplace l'historique
  // affiché, il faut donc rétablir le défilement mémorisé pour ce dépôt.
  $effect(() => {
    const id = repo.repoId;
    if (id === shownRepoId) return;
    shownRepoId = id;

    const target = repo.graphScrollTop;
    restoring = true;
    // Après le rendu des nouvelles lignes : la hauteur du conteneur doit être à
    // jour, sinon la position demandée serait tronquée.
    //
    // La reprise se fait dès l'écriture, sans passer par `requestAnimationFrame` :
    // celui-ci est suspendu quand la fenêtre ne peint pas (app en arrière-plan),
    // ce qui laisserait `restoring` bloqué et ferait perdre tout défilement
    // ultérieur. Les scrolls parasites du clamp sont distribués après cette
    // microtâche : ils relisent alors la position déjà rétablie, donc sans dégât.
    tick().then(() => {
      if (scroller) scroller.scrollTop = target;
      scrollTop = target;
      restoring = false;
    });
  });

  // Le canvas suit la taille du conteneur (colonne redimensionnée, fenêtre…).
  $effect(() => {
    const el = scroller;
    if (!el) return;
    viewportH = el.clientHeight;
    tableW = el.clientWidth;
    const ro = new ResizeObserver(() => {
      viewportH = el.clientHeight;
      tableW = el.clientWidth;
    });
    ro.observe(el);
    return () => ro.disconnect();
  });

  // Redessin : les dépendances (layout, scrollTop, viewportH, sélection) sont
  // captées par les lectures faites dans `draw`.
  $effect(() => {
    draw();
  });

  // Un viewport plus haut que la première page ne déclencherait aucun scroll :
  // on vérifie aussi à chaque arrivée de commits.
  $effect(() => {
    if (layout.rows.length > 0 && viewportH > 0) maybeLoadMore();
  });

  // Une sélection venue d'ailleurs (clic sur une branche dans la sidebar) doit
  // être amenée à l'écran. On ne bouge pas si la ligne est déjà visible, pour ne
  // pas déplacer le graph sous les yeux de l'utilisateur qui vient d'y cliquer.
  $effect(() => {
    const oid = repo.selectedCommitOid;
    const el = scroller;
    if (!oid || !el) return;

    const index = layout.rows.findIndex(
      (r) => r.kind === "commit" && r.commit.oid === oid,
    );
    if (index < 0) return; // commit hors des pages chargées

    const top = index * ROW_H;
    const view = el.scrollTop;
    if (top >= view && top + ROW_H <= view + el.clientHeight) return;
    el.scrollTop = Math.max(0, top - el.clientHeight / 2 + ROW_H / 2);
  });
</script>

<div class="graph" bind:this={graphEl}>
  {#if !repo.repoInfo}
    <p class="placeholder">{t("common.noRepo")}</p>
  {:else if layout.rows.length === 0}
    <p class="placeholder">
      {repo.graphLoading ? t("graph.loading") : t("graph.empty")}
    </p>
  {:else}
    <!-- En-tête : le nom de chaque colonne, sur la même grille que les rangées.
         Un appui glissé déplace la colonne, la poignée de bord la redimensionne
         (double-clic : largeur d'origine — pour le graph, ajustée aux
         branches). -->
    <div class="thead" style="height: {HEAD_H}px">
      <div class="thead-grid" style="grid-template-columns: {template}">
        {#each placed as col, i (col.id)}
          {@const side = i < messageIndex ? 1 : i > messageIndex ? -1 : 0}
          <!-- Un en-tête n'est pas un widget : on le glisse à la souris, et le
               menu des colonnes offre au clavier ce que le geste fait. -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="th"
            class:dragging={colDrag?.started && colDrag.id === col.id}
            style:transform={colDrag?.started && colDrag.id === col.id
              ? `translateX(${colDrag.offset}px)`
              : undefined}
            title={t("graph.col.move")}
            onpointerdown={(e) => onHeadDown(e, i)}
            onpointermove={onHeadMove}
            onpointerup={onHeadUp}
            onpointercancel={onHeadUp}
          >
            <span class="th-label">{LABELS[col.id]}</span>
            {#if side !== 0}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <span
                class="grip"
                class:left={side === -1}
                title={t("graph.col.resize")}
                onpointerdown={(e) => onGripDown(e, col, side === 1 ? 1 : -1)}
                onpointermove={onGripMove}
                onpointerup={onGripUp}
                onpointercancel={onGripUp}
                ondblclick={() => graphColumns.setWidthPx(col.id, null)}
              ></span>
            {/if}
          </div>
        {/each}
      </div>
      {#if dropX !== null}
        <span class="drop-mark" style="left: {dropX}px"></span>
      {/if}
      <button
        class="cols-btn"
        class:on={columnsMenu !== null}
        style="width: {MENU_BTN_W}px"
        title={t("graph.columns.hint")}
        aria-label={t("graph.columns.hint")}
        aria-haspopup="menu"
        onclick={openColumnsMenu}
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="8" cy="8" r="2.1" />
          <path d="M12.9 9.8a1.1 1.1 0 0 0 .22 1.21l.04.04a1.33 1.33 0 1 1-1.88 1.88l-.04-.04a1.1 1.1 0 0 0-1.21-.22 1.1 1.1 0 0 0-.67 1v.11a1.33 1.33 0 1 1-2.67 0v-.06a1.1 1.1 0 0 0-.72-1 1.1 1.1 0 0 0-1.21.22l-.04.04a1.33 1.33 0 1 1-1.88-1.88l.04-.04a1.1 1.1 0 0 0 .22-1.21 1.1 1.1 0 0 0-1-.67h-.11a1.33 1.33 0 1 1 0-2.67h.06a1.1 1.1 0 0 0 1-.72 1.1 1.1 0 0 0-.22-1.21l-.04-.04a1.33 1.33 0 1 1 1.88-1.88l.04.04a1.1 1.1 0 0 0 1.21.22h.05a1.1 1.1 0 0 0 .67-1v-.11a1.33 1.33 0 1 1 2.67 0v.06a1.1 1.1 0 0 0 .67 1 1.1 1.1 0 0 0 1.21-.22l.04-.04a1.33 1.33 0 1 1 1.88 1.88l-.04.04a1.1 1.1 0 0 0-.22 1.21v.05a1.1 1.1 0 0 0 1 .67h.11a1.33 1.33 0 1 1 0 2.67h-.06a1.1 1.1 0 0 0-1 .67z" />
        </svg>
      </button>
    </div>

    <!-- Canvas en overlay sur la colonne du graph : uniquement la géométrie des
         lanes, jamais de texte. Absent quand la colonne est masquée. -->
    {#if graphCol}
      <canvas
        class="lanes"
        bind:this={canvas}
        style="left: {graphCol.x}px; top: {HEAD_H}px; width: {graphCol.width}px; height: {viewportH}px"
        aria-hidden="true"
      ></canvas>
    {/if}

    <div class="scroller" bind:this={scroller} onscroll={onScroll}>
      <div class="spacer" style="height: {layout.rows.length * ROW_H}px">
        {#each visible as row, i (rowKey(row))}
          {@const motion = rowMotion(row, first + i)}
          <div
            class="row"
            data-oid={row.kind === "commit" ? row.commit.oid : undefined}
            class:wip={row.kind === "wip"}
            class:selected={isSelected(row)}
            style="top: {(first + i) * ROW_H}px; height: {ROW_H}px; grid-template-columns: {template}"
            style:animation={motion.animation}
            style:--shift={motion.shift}
            role="button"
            tabindex="0"
            onclick={() => activate(row)}
            onkeydown={(e) => onRowKey(e, row)}
            oncontextmenu={(e) => openRowMenu(e, row)}
          >
            {#each placed as col (col.id)}
              {@render cell(row, col.id)}
            {/each}
          </div>
        {/each}
        <!-- Posés sur la frontière entre deux rangées, hors d'elles : dans la
             rangée, la moitié haute de l'étiquette serait rognée. Sous le
             canvas, pour que les branches passent par-dessus le trait. -->
        {#each separators as sep (sep.index)}
          {@const motion = rowMotion(null, sep.index)}
          <div
            class="sep"
            style="top: {sep.index * ROW_H}px"
            style:animation={motion.animation}
            style:--shift={motion.shift}
          >
            <span class="sep-line"></span>
            <span class="sep-label">{sep.label}</span>
          </div>
        {/each}
        <!-- Pastilles en train de glisser vers leur nouveau commit. -->
        {#each flights as f (f.key)}
          <span
            class="ref flight"
            class:head={f.badge.isHead}
            class:remote={!f.badge.local}
            style="--lane: {f.color}; top: {f.top}px; right: {f.right}px; height: {f.height}px; --dx: {f.dx}px; --dy: {f.dy}px"
            style:animation="graph-ref-flight {SLIDE_MS}ms {EASE_IN_OUT} {f.delay}ms both"
            aria-hidden="true"
          >
            {@render badgeBody(f.badge)}
          </span>
        {/each}
      </div>
    </div>

    <!-- Copie entière de la pastille survolée, quand la sienne est tronquée. -->
    {#if peek}
      <span
        class="ref peek"
        class:head={peek.badge.isHead}
        class:remote={!peek.badge.local && !peek.badge.tag}
        class:tag={peek.badge.tag}
        style="--lane: {peek.lane}; left: {peek.x}px; top: {peek.y}px; min-width: {peek.width}px; height: {peek.height}px"
        aria-hidden="true"
      >
        {@render badgeBody(peek.badge)}
      </span>
    {/if}
  {/if}
</div>


<!--
  Une cellule. La rangée WIP n'a ni pastilles, ni auteur, ni date, ni oid : rien
  de tout ça n'existe encore. À la place du message, le résumé du prochain
  commit — le champ *est* celui de la boîte de commit, `repo.commitSummary`,
  édité indifféremment d'un côté ou de l'autre ; vide, il ne montre que
  « // WIP ». Les compteurs reprennent le vocabulaire des dossiers de la liste
  de fichiers (✎ / + / −).
-->
{#snippet cell(row: GraphRow, id: ColumnId)}
  {#if id === "graph"}
    <!-- Vide : le canvas dessine par-dessus. -->
    <span class="cell graph-cell"></span>
  {:else if row.kind === "wip"}
    {#if id === MESSAGE}
      <span class="cell message">
        <input
          class="wip-summary"
          aria-label={t("graph.wip.summary")}
          placeholder="// WIP"
          title={repo.commitSummary || t("graph.wip.summary")}
          bind:value={repo.commitSummary}
          onkeydown={onSummaryKey}
        />
        <span class="counts" title={countsLabel(counts)}>
          {#if counts.modified}<span class="c mod">✎ {counts.modified}</span>{/if}
          {#if counts.added}<span class="c add">+ {counts.added}</span>{/if}
          {#if counts.deleted}<span class="c del">− {counts.deleted}</span>{/if}
        </span>
      </span>
    {:else}
      <span class="cell"></span>
    {/if}
  {:else if id === "refs"}
              <!-- Une pastille par branche, pas par référence : `main` et
         `origin/main` au même commit n'ont qu'une chose à dire, et la
         disent une fois (voir `graph/refs.ts`). Ce qui reste tient
         dans le nom et deux icônes — l'écran pour « ici », le nuage
         pour « sur le serveur ». Une branche locale en avance ou en
         retard sur son distant est sur une autre rangée : ce sont
         alors deux pastilles, que ces icônes distinguent. La coche
         marque la branche courante, comme dans la sidebar. -->
    {@const badges = groupRefs(row.commit.refs)}
    <span class="cell refs">
      {#if badges.length > MAX_REFS}
        <span
          class="more"
          title={badges
            .slice(MAX_REFS)
            .map((b) => b.title)
            .join(" · ")}
        >
          +{badges.length - MAX_REFS}
        </span>
      {/if}
      {#each badges.slice(0, MAX_REFS) as b (b.key)}
        <!-- Une branche distante qui arrive ici : l'icône du serveur se pose
             sur une pastille locale, la pastille entière sinon. -->
        {@const land = landings.get(row.commit.oid + "|" + b.key)}
        {@const landing =
          land !== undefined ? `graph-ref-land ${LAND_MS}ms ease-out ${land}ms both` : undefined}
        <!-- Une branche locale qui arrive ici : la pastille entière se pose. -->
        {@const landed = badgeLandings.get(row.commit.oid + "|" + b.key)}
        {@const landingWhole =
          landed !== undefined ? `graph-ref-land ${LAND_MS}ms ease-out ${landed}ms both` : undefined}
        <!-- Une branche qui vient d'être créée : sa pastille monte à sa place. -->
        {@const rise = rising.get(row.commit.oid + "|" + b.key)}
        {@const risingIn =
          rise !== undefined ? `graph-ref-rise ${RISE_MS}ms ${EASE_RISE} ${rise}ms both` : undefined}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <span
          class="ref"
          data-badge={b.key}
          class:head={b.isHead}
          class:remote={!b.local && !b.tag}
          class:tag={b.tag}
          style="--lane: {lanes[row.color]}"
          style:animation={risingIn ?? landingWhole ?? (b.local ? undefined : landing)}
          title={b.title}
          onmouseenter={(e) => onBadgeEnter(e, b, lanes[row.color])}
          onmouseleave={() => (peek = null)}
        >
          {@render badgeBody(b, b.local ? landing : undefined)}
        </span>
      {/each}
    </span>
  {:else if id === MESSAGE}
    <span class="cell message" title={row.commit.summary}>
      <span class="summary">{row.commit.summary}</span>
    </span>
  {:else if id === "author"}
    <span class="cell author" title={row.commit.authorName}>{row.commit.authorName}</span>
  {:else if id === "date"}
    <span class="cell date">{formatDate(row.commit.timestamp)}</span>
  {:else}
    <span class="cell oid">{row.commit.shortOid}</span>
  {/if}
{/snippet}

<!-- Contenu d'une pastille : la coche de HEAD, le nom, puis l'écran (« ici »)
     et le nuage (« sur le serveur »). Partagé par la pastille et sa copie
     entière au survol. -->
{#snippet badgeBody(b: RefBadge, cloudAnimation?: string)}
  {#if b.isHead}<span class="mark" aria-hidden="true">✓</span>{/if}
  {#if b.tag}
    <!-- Étiquette, en tête : un tag se reconnaît avant de se lire. -->
    <svg class="ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round">
      <path d="M2 2.75a.75.75 0 0 1 .75-.75h4.4a1 1 0 0 1 .7.3l5.9 5.9a1 1 0 0 1 0 1.4l-4.4 4.4a1 1 0 0 1-1.4 0L2.3 8.1a1 1 0 0 1-.3-.7z" />
      <circle cx="5.25" cy="5.25" r="1" fill="currentColor" stroke="none" />
    </svg>
  {/if}
  <span class="bname">{b.name}</span>
  {#if b.local}
    <svg
      class="ic"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linejoin="round"
    >
      <title>{t("graph.ref.local")}</title>
      <rect x="2.25" y="3.25" width="11.5" height="8" rx="1.2" />
      <path d="M5.5 13.75h5" stroke-linecap="round" />
    </svg>
  {/if}
  {#if b.remotes.length > 0}
    <svg
      class="ic"
      style:animation={cloudAnimation}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linejoin="round"
    >
      <title>{b.remotes.join(", ")}</title>
      <path
        d="M4.6 11.6A2.2 2.2 0 0 1 4.9 7.3 3.3 3.3 0 0 1 11.2 7.6 2.1 2.1 0 0 1 11.4 11.6Z"
      />
    </svg>
  {/if}
{/snippet}

<!-- Menu des colonnes : cocher ce qu'on affiche. Le message reste coché et
     grisé — c'est la colonne qui prend la place des autres. Le menu reste
     ouvert d'un clic à l'autre : on en règle souvent plusieurs d'affilée. -->
{#if columnsMenu}
  <button
    class="ctx-overlay"
    aria-label={t("common.closeMenu")}
    onclick={() => (columnsMenu = null)}
    oncontextmenu={(e) => {
      e.preventDefault();
      columnsMenu = null;
    }}
  ></button>
  <div
    class="ctx-menu columns-menu"
    style="left: {columnsMenu.x}px; top: {columnsMenu.y}px"
    role="menu"
  >
    <p class="ctx-head">{t("graph.columns")}</p>
    {#each graphColumns.columns.order as id (id)}
      {@const shown = !graphColumns.columns.hidden.includes(id)}
      <button
        class="ctx-item"
        role="menuitemcheckbox"
        aria-checked={shown}
        disabled={id === MESSAGE}
        onclick={() => graphColumns.toggle(id)}
      >
        <span class="check">{shown ? "✓" : ""}</span>
        <span>{LABELS[id]}</span>
      </button>
    {/each}
    <div class="ctx-sep"></div>
    <button
      class="ctx-item"
      role="menuitem"
      onclick={() => {
        graphColumns.reset();
        columnsMenu = null;
      }}
    >
      <span class="check"></span>
      <span>{t("graph.columns.reset")}</span>
    </button>
  </div>
{/if}

<!-- Menu d'une rangée de commit : une branche ou un tag, rien d'autre. -->
{#if rowMenu}
  <button
    class="ctx-overlay"
    aria-label={t("common.closeMenu")}
    onclick={() => (rowMenu = null)}
    oncontextmenu={(e) => {
      e.preventDefault();
      rowMenu = null;
    }}
  ></button>
  <div
    class="ctx-menu row-menu"
    style="left: {rowMenu.x}px; top: {rowMenu.y}px"
    role="menu"
  >
    <p class="ctx-head">{rowMenu.commit.shortOid} · {rowMenu.commit.summary}</p>
    <button
      class="ctx-item"
      role="menuitem"
      disabled={repo.checkingOut || repo.busy}
      onclick={createBranchHere}
    >
      <svg class="menu-ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="4.5" cy="3.5" r="1.75" />
        <circle cx="4.5" cy="12.5" r="1.75" />
        <circle cx="11.5" cy="5" r="1.75" />
        <path d="M4.5 5.25v5.5" />
        <path d="M9.75 6.4A5 5 0 0 1 6.2 11.9" />
      </svg>
      <span>{t("graph.menu.createBranch")}</span>
    </button>
    <button class="ctx-item" role="menuitem" onclick={createTagHere}>
      <svg class="menu-ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round">
        <path d="M2 2.75a.75.75 0 0 1 .75-.75h4.4a1 1 0 0 1 .7.3l5.9 5.9a1 1 0 0 1 0 1.4l-4.4 4.4a1 1 0 0 1-1.4 0L2.3 8.1a1 1 0 0 1-.3-.7z" />
        <circle cx="5.25" cy="5.25" r="1" fill="currentColor" stroke="none" />
      </svg>
      <span>{t("graph.menu.createTag")}</span>
    </button>
  </div>
{/if}

<svelte:window
  onkeydown={(e) => {
    if (e.key !== "Escape") return;
    columnsMenu = null;
    rowMenu = null;
  }}
/>

<style>
  /* En-tête, puis rangées qui défilent dessous : l'en-tête ne défile jamais. */
  .graph {
    position: relative;
    height: 100%;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .thead {
    position: relative;
    flex: none;
    border-bottom: 1px solid var(--border);
    background: var(--bg);
    font-size: 0.72rem;
    color: var(--text-dim);
    /* Un en-tête se glisse et se tire : rien à y sélectionner. */
    -webkit-user-select: none;
    user-select: none;
    /* Au-dessus du canvas, qui démarre juste en dessous. */
    z-index: 4;
  }
  .thead-grid {
    display: grid;
    height: 100%;
    /* L'en-tête glissé ne doit pas élargir la grille en sortant de sa case. */
    overflow: visible;
  }
  .th {
    position: relative;
    display: flex;
    align-items: center;
    min-width: 0;
    padding: 0 0.5rem;
    cursor: grab;
  }
  .th:hover {
    color: var(--text);
  }
  .th.dragging {
    z-index: 2;
    cursor: grabbing;
    background: var(--bg-raised);
    border-radius: 4px;
    box-shadow: 0 4px 12px var(--shadow-color);
    color: var(--text);
  }
  .th-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }
  /* Poignée de redimensionnement, à cheval sur la frontière : 7px de prise
     pour un trait d'1px, visible au survol seulement. */
  .grip {
    position: absolute;
    top: 0;
    bottom: 0;
    right: -4px;
    width: 7px;
    cursor: col-resize;
    z-index: 1;
  }
  .grip.left {
    right: auto;
    left: -4px;
  }
  .grip::after {
    content: "";
    position: absolute;
    top: 25%;
    bottom: 25%;
    left: 3px;
    width: 1px;
    background: var(--border);
  }
  .grip:hover::after {
    top: 0;
    bottom: 0;
    background: var(--accent);
  }
  /* Où tombera la colonne glissée. */
  .drop-mark {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    margin-left: -1px;
    background: var(--accent);
    pointer-events: none;
  }
  .cols-btn {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--text-faint);
    cursor: pointer;
  }
  .cols-btn svg {
    width: 14px;
    height: 14px;
  }
  .cols-btn:hover,
  .cols-btn.on {
    color: var(--text);
  }
  .columns-menu {
    min-width: 220px;
  }
  .check {
    flex: none;
    width: 0.9rem;
    color: var(--accent-soft);
  }
  .ctx-sep {
    height: 1px;
    margin: 0.3rem 0;
    background: var(--border);
  }
  .placeholder {
    margin: 0;
    padding: 1rem 0.9rem;
    color: var(--text-dim);
    font-size: 0.9rem;
  }
  /* Posé en style inline sur la colonne du graph, sous l'en-tête. */
  .lanes {
    position: absolute;
    /* Purement décoratif : ne doit jamais intercepter les clics des lignes. */
    pointer-events: none;
    /*
      Au-dessus des lignes : leur fond de survol/sélection couvre toute la
      largeur, gouttière comprise, et masquerait les lanes si le canvas passait
      dessous. Le canvas s'arrête à la gouttière, il ne recouvre aucun texte.
    */
    z-index: 3;
  }
  .scroller {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
  }
  .spacer {
    position: relative;
  }
  /* Une rangée est une ligne de la grille de l'en-tête : même
     `grid-template-columns`, en style inline. Ce qui dépasse à droite, quand
     les colonnes ne tiennent plus, est rogné. */
  .row {
    position: absolute;
    left: 0;
    right: 0;
    display: grid;
    align-items: center;
    overflow: hidden;
    font-size: 0.82rem;
    cursor: pointer;
    /* Au-dessus du canvas pour rester cliquable et lisible. */
    z-index: 2;
  }
  .row:hover {
    background: var(--bg-raised);
  }
  .row.selected {
    background: var(--accent-bg);
  }
  /* Animations d'apparition des commits, posées en style par `rowMotion` —
     globales pour que ce style les nomme. `graph-row-shift` : la rangée
     glisse depuis sa place d'avant (`--shift` plus haut). `graph-row-fresh` :
     le texte d'une rangée nouvelle arrive en fondu, puis son surlignage
     s'efface. */
  .row {
    --fresh-bg: color-mix(in srgb, var(--accent) 14%, transparent);
  }
  @keyframes -global-graph-row-shift {
    from {
      transform: translateY(calc(-1 * var(--shift, 0px)));
    }
    to {
      transform: none;
    }
  }
  @keyframes -global-graph-row-fresh {
    0% {
      opacity: 0;
      background-color: var(--fresh-bg);
    }
    30% {
      opacity: 1;
      background-color: var(--fresh-bg);
    }
    100% {
      opacity: 1;
      background-color: transparent;
    }
  }
  .cell {
    min-width: 0;
    padding: 0 0.5rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .graph-cell {
    padding: 0;
  }
  /* Pastilles alignées à droite de leur colonne — contre le graph dans la
     disposition par défaut. Elles se resserrent plutôt que de déborder. */
  .refs {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.25rem;
    height: 100%;
  }
  .message {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .ref {
    /* Plusieurs pastilles se resserrent au lieu de sortir de la colonne : chacune
       garde de quoi montrer un début de nom, l'infobulle porte le nom complet. */
    flex: 0 1 auto;
    min-width: 3.2rem;
    max-width: 12rem;
    display: flex;
    align-items: center;
    gap: 0.2rem;
    font-size: 0.7rem;
    /* `--lane` est posée en style inline par la ligne (couleur de la lane). */
    color: var(--lane);
    background: var(--bg-raised);
    border: 1px solid var(--lane);
    padding: 0.05rem 0.35rem;
    border-radius: 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Les pastilles en trop, comptées. Placée avant elles, la puce se lit comme un
     « et n autres » à gauche de ce qui est montré, et c'est elle qui se fait
     rogner en premier si la colonne déborde malgré tout. */
  .more {
    flex: none;
    font-size: 0.68rem;
    color: var(--text-dim);
  }
  /* Seul le nom se tronque : la coche et les icônes disent *quoi* est cette
     branche, les rogner reviendrait à la décrire faussement. */
  .bname {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mark,
  .ic {
    flex: none;
  }
  .ic {
    width: 0.72rem;
    height: 0.72rem;
    /* Le trait d'un pictogramme de 11px pèse plus lourd que celui d'une lettre :
       l'atténuer le remet au niveau du nom qu'il accompagne. */
    opacity: 0.75;
  }
  /* HEAD : même couleur, mais pastille pleine pour rester repérable d'un coup d'œil. */
  .ref.head {
    color: var(--bg);
    background: var(--lane);
    font-weight: 600;
  }
  /* Référence distante : même couleur de lane, contour pointillé — elle n'est
     pas ici mais sur le serveur. */
  .ref.remote {
    border-style: dashed;
    opacity: 0.85;
  }
  /* Tag : même couleur de lane, trait plein, l'étiquette en tête suffit à le
     distinguer d'une branche. Le fond reste celui des pastilles non pleines :
     seul HEAD est plein. */
  .ref.tag {
    border-radius: 8px;
  }
  /* Copie entière d'une pastille tronquée, au survol : aucune limite de
     largeur, au-dessus du canvas (3) et de l'en-tête (4). Opaque, y compris pour
     une référence distante — sinon le texte de la colonne voisine transparaîtrait
     à travers. Elle ne capte pas la souris : la vraie pastille, dessous, reste
     celle qu'on survole. */
  /* Copie d'une pastille distante qui glisse vers son nouveau commit
     (`flights`) : posée à l'arrivée, elle part de sa place d'avant. Au-dessus
     des rangées, sans capter la souris. */
  .ref.flight {
    position: absolute;
    z-index: 2;
    max-width: none;
    pointer-events: none;
  }
  @keyframes -global-graph-ref-flight {
    0% {
      opacity: 0.85;
      transform: translate(var(--dx, 0px), var(--dy, 0px));
    }
    85% {
      opacity: 0.85;
      transform: none;
    }
    100% {
      opacity: 0;
      transform: none;
    }
  }
  /* Pastille d'une branche qui vient d'être créée : elle monte à sa place. */
  @keyframes -global-graph-ref-rise {
    from {
      opacity: 0;
      transform: translateY(0.6em) scale(0.85);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  /* Ce qui arrive se pose : l'icône du serveur, ou la pastille entière. */
  @keyframes -global-graph-ref-land {
    from {
      opacity: 0;
      transform: scale(0.4);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  .ref.peek {
    position: absolute;
    z-index: 6;
    max-width: none;
    opacity: 1;
    box-shadow: 0 2px 8px var(--shadow-color);
    pointer-events: none;
  }
  /* Résumé du prochain commit : un champ, mais qui se lit comme le texte des
     autres rangées — ni fond ni bordure tant qu'on ne le vise pas. Le liseré au
     survol et au focus est ce qui dit qu'il s'édite. */
  .wip-summary {
    flex: 1;
    min-width: 0;
    /* La rangée impose sa police et sa taille : un champ ne les hérite pas. */
    font: inherit;
    color: var(--text);
    background: transparent;
    border: 1px solid transparent;
    border-radius: 4px;
    padding: 0.1rem 0.35rem;
    margin: 0;
  }
  .wip-summary::placeholder {
    color: var(--text-dim);
    font-style: italic;
  }
  .wip-summary:hover {
    border-color: var(--border);
  }
  .wip-summary:focus {
    outline: none;
    border-color: var(--accent);
    background: var(--bg);
  }
  /* Compteurs de changements, mêmes symboles et mêmes couleurs que les dossiers
     de la liste de fichiers (voir TreeRow). */
  .counts {
    flex: none;
    display: flex;
    gap: 0.4rem;
    font-size: 0.72rem;
    white-space: nowrap;
  }
  .c.mod {
    color: var(--warn);
  }
  .c.add {
    color: var(--ok);
  }
  .c.del {
    color: var(--danger);
  }
  /* Le résumé se tronque ; l'âge de la tranche, lui, reste entier. */
  .summary {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Séparateur de tranche : une ligne de hauteur nulle posée sur la frontière,
     dont les enfants se centrent verticalement — le trait comme l'étiquette,
     qui se lit ainsi dans sa continuité. Au-dessus des rangées (leur fond de
     survol le masquerait), sous le canvas (les branches passent dessus). */
  .sep {
    position: absolute;
    left: 0;
    right: 0;
    height: 0;
    display: flex;
    align-items: center;
    pointer-events: none;
    z-index: 2;
  }
  .sep-line {
    flex: 1;
    height: 1px;
    background: var(--border);
  }
  /* En bout de ligne, au bord droit du tableau : l'étiquette n'appartient à
     aucune colonne, elle termine le trait. */
  .sep-label {
    flex: none;
    padding: 0 0.6rem 0 0.4rem;
    font-size: 0.68rem;
    line-height: 1;
    color: var(--text-faint);
  }
  .author {
    color: var(--text-dim);
    font-size: 0.75rem;
  }
  .date {
    color: var(--text-faint);
    font-size: 0.72rem;
  }
  .oid {
    font-family: var(--mono);
    font-size: 0.72rem;
    color: var(--text-faint);
  }
  /* Menu d'une rangée : le résumé du commit, en en-tête, se replie. */
  .row-menu {
    min-width: 220px;
    max-width: 280px;
  }
  .row-menu .ctx-head {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .menu-ic {
    flex: none;
    width: 14px;
    height: 14px;
  }
</style>
