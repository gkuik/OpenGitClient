<script lang="ts">
  import { tick } from "svelte";
  import { font } from "../font.svelte";
  import { i18n, t } from "../i18n.svelte";
  import { repo } from "../stores/repo.svelte";
  import { theme } from "../theme.svelte";
  import { lanePalette, layoutGraph, type GraphRow } from "../graph/layout";
  import { groupRefs } from "../graph/refs";
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
  const DOT_R = 4;
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
    Colonne des noms de branches, à gauche des lanes — comme GitKraken. Elle ne
    dépend que de la taille du texte, jamais du contenu : la calculer sur les
    rangées montées la ferait varier au défilement, et la calculer sur tout
    l'historique la ferait sauter à chaque page chargée. 168 px à la taille par
    défaut. Les pastilles y sont alignées à droite, contre le graph, et se
    resserrent entre elles plutôt que de déborder.
  */
  const REFS_W = $derived(Math.round(font.rootPx * 10.6));
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
  const gutterW = $derived(
    PAD_X * 2 + Math.max(layout.laneCount, MIN_LANES) * LANE_W,
  );
  /** Début du texte de la rangée : colonne des refs, puis gouttière des lanes. */
  const textX = $derived(REFS_W + gutterW);

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
    <!-- Canvas en overlay : uniquement la géométrie des lanes, jamais de texte. -->
    <canvas
      class="lanes"
      bind:this={canvas}
      style="left: {REFS_W}px; width: {gutterW}px"
      aria-hidden="true"
    ></canvas>

    <div class="scroller" bind:this={scroller} onscroll={onScroll}>
      <div class="spacer" style="height: {layout.rows.length * ROW_H}px">
        {#each visible as row, i (rowKey(row))}
          <div
            class="row"
            class:wip={row.kind === "wip"}
            class:selected={isSelected(row)}
            style="top: {(first + i) * ROW_H}px; height: {ROW_H}px; padding-left: {textX}px"
            role="button"
            tabindex="0"
            onclick={() => activate(row)}
            onkeydown={(e) => onRowKey(e, row)}
          >
            {#if row.kind === "wip"}
              <!-- Pas de date, pas d'auteur, pas d'oid : rien de tout ça
                   n'existe encore. À leur place, le résumé du prochain commit —
                   le champ *est* celui de la boîte de commit, `repo.commitSummary`,
                   édité indifféremment d'un côté ou de l'autre. Vide, il ne
                   montre que « // WIP ». Les compteurs reprennent le vocabulaire
                   des dossiers de la liste de fichiers (✎ / + / −). -->
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
            {:else}
              <!-- Colonne des refs, hors du flux de la rangée (celle-ci ne
                   commence qu'après la gouttière) : les pastilles se lisent en
                   colonne, alignées contre le graph, et un commit qui en porte
                   plusieurs ne décale plus son résumé.

                   Une pastille par branche, pas par référence : `main` et
                   `origin/main` au même commit n'ont qu'une chose à dire, et la
                   disent une fois (voir `graph/refs.ts`). Ce qui reste tient
                   dans le nom et deux icônes — l'écran pour « ici », le nuage
                   pour « sur le serveur ». Une branche locale en avance ou en
                   retard sur son distant est sur une autre rangée : ce sont
                   alors deux pastilles, que ces icônes distinguent. La coche
                   marque la branche courante, comme dans la sidebar. -->
              {@const badges = groupRefs(row.commit.refs)}
              <span class="refs" style="width: {REFS_W}px">
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
              <span class="summary" title={row.commit.summary}>{row.commit.summary}</span>
              <span class="author" title={row.commit.authorName}>{row.commit.authorName}</span>
              <span class="date">{formatDate(row.commit.timestamp)}</span>
              <span class="oid">{row.commit.shortOid}</span>
            {/if}
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
  /* Hors du flux : la rangée réserve déjà la place par son `padding-left`, et
     l'alignement à droite fait tenir les pastilles contre les lanes. */
  .refs {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.25rem;
    padding: 0 0.4rem 0 0.5rem;
    overflow: hidden;
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
