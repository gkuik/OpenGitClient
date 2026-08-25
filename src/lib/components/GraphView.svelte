<script lang="ts">
  import { repo } from "../stores/repo.svelte";
  import { LANE_COLORS, layoutGraph } from "../graph/layout";

  // ── Géométrie ──────────────────────────────────────────────────────────────
  // ROW_H est la seule chose qui aligne le canvas et le DOM : elle est appliquée
  // aux lignes en style inline, jamais en CSS, pour qu'elles ne puissent pas
  // diverger.
  const ROW_H = 26;
  const LANE_W = 14;
  const DOT_R = 4;
  /** Marge horizontale de la gouttière, de chaque côté des lanes. */
  const PAD_X = 8;
  /** Lanes réservées au minimum : évite que le texte colle au bord. */
  const MIN_LANES = 2;
  /** Rangées restantes sous le viewport qui déclenchent le chargement suivant. */
  const LOAD_AHEAD = 50;

  let scroller = $state<HTMLDivElement | null>(null);
  let canvas = $state<HTMLCanvasElement | null>(null);
  let scrollTop = $state(0);
  let viewportH = $state(0);

  const layout = $derived(layoutGraph(repo.graph));
  const gutterW = $derived(
    PAD_X * 2 + Math.max(layout.laneCount, MIN_LANES) * LANE_W,
  );

  // Fenêtre de rangées réellement montées (virtualisation).
  const first = $derived(Math.max(0, Math.floor(scrollTop / ROW_H) - 1));
  const visible = $derived(
    layout.rows.slice(first, first + Math.ceil(viewportH / ROW_H) + 3),
  );

  const dateFmt = new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
  });

  function formatDate(ts: number): string {
    return dateFmt.format(new Date(ts * 1000));
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

    const w = gutterW;
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
    ctx.lineWidth = 1.6;

    const from = Math.max(0, Math.floor(scrollTop / ROW_H) - 1);
    const to = Math.min(layout.rows.length, from + Math.ceil(h / ROW_H) + 3);
    const selected = repo.selectedCommitOid;

    for (let i = from; i < to; i++) {
      const row = layout.rows[i];
      const top = i * ROW_H - scrollTop;
      const mid = top + ROW_H / 2;

      for (const edge of row.edges) {
        const x1 = laneX(edge.fromLane);
        const x2 = laneX(edge.toLane);
        ctx.strokeStyle = LANE_COLORS[edge.color];
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
          ctx.moveTo(x1, mid);
          link(ctx, x1, mid, x2, top + ROW_H);
        }
        ctx.stroke();
      }

      // Point du commit. L'anneau sombre le détache de la ligne qui le traverse
      // (même couleur) et reste lisible quelle que soit la surbrillance de la
      // ligne, sur laquelle le canvas est superposé.
      const x = laneX(row.lane);
      ctx.beginPath();
      ctx.arc(x, mid, DOT_R, 0, Math.PI * 2);
      ctx.fillStyle = LANE_COLORS[row.color];
      ctx.fill();
      ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
      ctx.lineWidth = 2;
      ctx.stroke();

      if (row.commit.oid === selected) {
        ctx.beginPath();
        ctx.arc(x, mid, DOT_R + 3, 0, Math.PI * 2);
        // L'app est en thème sombre fixe (color-scheme: dark dans app.css).
        ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.lineWidth = 1.6;
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
    scrollTop = scroller.scrollTop;
    maybeLoadMore();
  }

  function onRowKey(e: KeyboardEvent, oid: string) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      repo.selectCommit(oid);
    }
  }

  // Le canvas suit la taille du conteneur (colonne redimensionnée, fenêtre…).
  $effect(() => {
    const el = scroller;
    if (!el) return;
    viewportH = el.clientHeight;
    const ro = new ResizeObserver(() => {
      viewportH = el.clientHeight;
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

    const index = layout.rows.findIndex((r) => r.commit.oid === oid);
    if (index < 0) return; // commit hors des pages chargées

    const top = index * ROW_H;
    const view = el.scrollTop;
    if (top >= view && top + ROW_H <= view + el.clientHeight) return;
    el.scrollTop = Math.max(0, top - el.clientHeight / 2 + ROW_H / 2);
  });
</script>

<div class="graph">
  {#if !repo.repoInfo}
    <p class="placeholder">Aucun dépôt ouvert.</p>
  {:else if layout.rows.length === 0}
    <p class="placeholder">
      {repo.graphLoading ? "Chargement de l'historique…" : "Aucun commit."}
    </p>
  {:else}
    <!-- Canvas en overlay : uniquement la géométrie des lanes, jamais de texte. -->
    <canvas
      class="lanes"
      bind:this={canvas}
      style="width: {gutterW}px"
      aria-hidden="true"
    ></canvas>

    <div class="scroller" bind:this={scroller} onscroll={onScroll}>
      <div class="spacer" style="height: {layout.rows.length * ROW_H}px">
        {#each visible as row, i (row.commit.oid)}
          <div
            class="row"
            class:selected={row.commit.oid === repo.selectedCommitOid}
            style="top: {(first + i) * ROW_H}px; height: {ROW_H}px; padding-left: {gutterW}px"
            role="button"
            tabindex="0"
            onclick={() => repo.selectCommit(row.commit.oid)}
            onkeydown={(e) => onRowKey(e, row.commit.oid)}
          >
            <!-- La pastille reprend la couleur de la lane du commit. -->
            {#each row.commit.refs as r (r.name)}
              <span
                class="ref"
                class:head={r.kind === "head"}
                style="--lane: {LANE_COLORS[row.color]}"
                title={r.name}
              >
                {r.name}
              </span>
            {/each}
            <span class="summary" title={row.commit.summary}>{row.commit.summary}</span>
            <span class="author" title={row.commit.authorName}>{row.commit.authorName}</span>
            <span class="date">{formatDate(row.commit.timestamp)}</span>
            <span class="oid">{row.commit.shortOid}</span>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .graph {
    position: relative;
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }
  .placeholder {
    margin: 0;
    padding: 1rem 0.9rem;
    color: var(--text-dim);
    font-size: 0.9rem;
  }
  .lanes {
    position: absolute;
    top: 0;
    left: 0;
    height: 100%;
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
    height: 100%;
    overflow-y: auto;
    overflow-x: hidden;
  }
  .spacer {
    position: relative;
  }
  .row {
    position: absolute;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding-right: 0.7rem;
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
  .ref {
    flex: none;
    max-width: 12rem;
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
  /* HEAD : même couleur, mais pastille pleine pour rester repérable d'un coup d'œil. */
  .ref.head {
    color: var(--bg);
    background: var(--lane);
    font-weight: 600;
  }
  .summary {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .author {
    flex: none;
    max-width: 9rem;
    color: var(--text-dim);
    font-size: 0.75rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .date {
    flex: none;
    color: var(--text-faint);
    font-size: 0.72rem;
    white-space: nowrap;
  }
  .oid {
    flex: none;
    font-family: var(--mono);
    font-size: 0.72rem;
    color: var(--text-faint);
  }
</style>
