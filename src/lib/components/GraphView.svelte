<script lang="ts">
  import { tick } from "svelte";
  import { font } from "../font.svelte";
  import { i18n, t } from "../i18n.svelte";
  import { repo } from "../stores/repo.svelte";
  import { theme } from "../theme.svelte";
  import { lanePalette, layoutGraph, type GraphRow } from "../graph/layout";
  import { groupRefs } from "../graph/refs";
  import {
    MESSAGE,
    dropIndex,
    placeColumns,
    type ColumnId,
    type PlacedColumn,
  } from "../graph/columns";
  import { graphColumns } from "../graphColumns.svelte";
  import type { TreeCounts } from "../tree";

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
  const LANE_W = 14;
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
  const layout = $derived(layoutGraph(repo.graph, wip));
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
    le fond du thème. `halo` marque le commit sélectionné : son contraire.
  */
  const lanes = $derived(lanePalette(theme.dark));
  const ring = $derived(
    theme.dark ? "rgba(0, 0, 0, 0.55)" : "rgba(255, 255, 255, 0.9)",
  );
  const halo = $derived(
    theme.dark ? "rgba(255, 255, 255, 0.9)" : "rgba(0, 0, 0, 0.7)",
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

  // Fenêtre de rangées réellement montées (virtualisation).
  const first = $derived(Math.max(0, Math.floor(scrollTop / ROW_H) - 1));
  const visible = $derived(
    layout.rows.slice(first, first + Math.ceil(viewportH / ROW_H) + 3),
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

  /** Courbe en S entre deux colonnes ; ligne droite si la colonne ne change pas. */
  function link(
    ctx: CanvasRenderingContext2D,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
  ) {
    if (x1 === x2) {
      ctx.lineTo(x2, y2);
      return;
    }
    const my = (y1 + y2) / 2;
    ctx.bezierCurveTo(x1, my, x2, my, x2, y2);
  }

  /**
   * Redessine la portion visible du graph.
   *
   * Le canvas ne couvre que le viewport (pas toute la hauteur de l'historique) :
   * il est en overlay au-dessus du conteneur scrollable et on décale le dessin de
   * `scrollTop`. C'est ce qui permet d'afficher des dizaines de milliers de
   * commits sans surface géante ni nœud DOM par ligne.
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

    const from = Math.max(0, Math.floor(scrollTop / ROW_H) - 1);
    const to = Math.min(layout.rows.length, from + Math.ceil(h / ROW_H) + 3);
    const selected = repo.selectedCommitOid;

    for (let i = from; i < to; i++) {
      const row = layout.rows[i];
      const top = i * ROW_H - scrollTop;
      const mid = top + ROW_H / 2;
      const isWip = row.kind === "wip";
      // Le nœud WIP est un cercle vide : son segment part de sous le cercle et
      // non de son centre, qui le barrerait. Rien ne descend jamais sur lui.
      const outY = isWip ? mid + WIP_R : mid;

      for (const edge of row.edges) {
        const x1 = laneX(edge.fromLane);
        const x2 = laneX(edge.toLane);
        ctx.strokeStyle = lanes[edge.color];
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
          link(ctx, x1, top, x2, mid);
        } else {
          // Repart du point vers la rangée suivante.
          ctx.moveTo(x1, outY);
          link(ctx, x1, outY, x2, top + ROW_H);
        }
        ctx.stroke();
        if (edge.dashed) ctx.setLineDash([]);
      }

      const x = laneX(row.lane);
      const radius = isWip ? WIP_R : DOT_R;
      if (isWip) {
        // Cercle vide en pointillés, dans la couleur de la lane de HEAD : ces
        // modifications sont sur cette branche, mais ne sont pas un commit.
        ctx.setLineDash(WIP_RING_DASH);
        ctx.lineDashOffset = 0;
        ctx.beginPath();
        ctx.arc(x, mid, radius, 0, Math.PI * 2);
        ctx.strokeStyle = lanes[row.color];
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        // Point du commit. L'anneau le détache de la ligne qui le traverse (même
        // couleur) et reste lisible quelle que soit la surbrillance de la ligne,
        // sur laquelle le canvas est superposé.
        ctx.beginPath();
        ctx.arc(x, mid, radius, 0, Math.PI * 2);
        ctx.fillStyle = lanes[row.color];
        ctx.fill();
        ctx.strokeStyle = ring;
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      if (isWip ? selected === null : row.commit.oid === selected) {
        ctx.beginPath();
        // Même halo pour les deux : les nœuds ont désormais la même taille.
        ctx.arc(x, mid, DOT_R + 3, 0, Math.PI * 2);
        ctx.strokeStyle = halo;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.lineWidth = LINE_W;
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

<div class="graph">
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
          <div
            class="row"
            class:wip={row.kind === "wip"}
            class:selected={isSelected(row)}
            style="top: {(first + i) * ROW_H}px; height: {ROW_H}px; grid-template-columns: {template}"
            role="button"
            tabindex="0"
            onclick={() => activate(row)}
            onkeydown={(e) => onRowKey(e, row)}
          >
            {#each placed as col (col.id)}
              {@render cell(row, col.id)}
            {/each}
          </div>
        {/each}
      </div>
    </div>
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
        <span
          class="ref"
          class:head={b.isHead}
          class:remote={!b.local}
          style="--lane: {lanes[row.color]}"
          title={b.title}
        >
          {#if b.isHead}<span class="mark" aria-hidden="true">✓</span>{/if}
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
        </span>
      {/each}
    </span>
  {:else if id === MESSAGE}
    <span class="cell message summary" title={row.commit.summary}>{row.commit.summary}</span>
  {:else if id === "author"}
    <span class="cell author" title={row.commit.authorName}>{row.commit.authorName}</span>
  {:else if id === "date"}
    <span class="cell date">{formatDate(row.commit.timestamp)}</span>
  {:else}
    <span class="cell oid">{row.commit.shortOid}</span>
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

<svelte:window onkeydown={(e) => (e.key === "Escape" ? (columnsMenu = null) : undefined)} />

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
  /* Un résumé se tronque comme du texte, pas comme un conteneur flex. */
  .summary {
    display: block;
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
</style>
