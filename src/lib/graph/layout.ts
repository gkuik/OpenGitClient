// Assignation des lanes du graph de commits.
//
// Fonction pure, sans accès au DOM ni au backend : le backend ne transporte que
// les commits et leurs parents, toute la géométrie est calculée ici. C'est le
// seul vrai algorithme du frontend, d'où son isolement dans un module testable.

import type { GraphCommit } from "../types";

/**
 * Palette des lanes en thème sombre, alignée sur les couleurs de badges déjà
 * utilisées dans l'app. La couleur d'une lane est son index modulo la taille de
 * la palette : stable tant que la lane vit, et sans état à maintenir.
 *
 * Les lanes sont peintes sur un canvas : elles échappent aux variables CSS et
 * sont donc le seul endroit du frontend où les deux thèmes coexistent en dur.
 */
export const LANE_COLORS = [
  "#60a5fa",
  "#4ade80",
  "#fbbf24",
  "#f87171",
  "#a78bfa",
  "#22d3ee",
  "#fb923c",
  "#f472b6",
];

/**
 * La même palette en thème clair : mêmes teintes, en plus soutenu. Les couleurs
 * du thème sombre sont choisies pour briller sur un fond presque noir — sur
 * blanc, un trait de 1,6px dans ces tons disparaît.
 *
 * **Même longueur et même ordre que `LANE_COLORS`**, obligatoirement : l'index
 * de couleur calculé ici accompagne chaque lane et chaque arête, et il ne
 * connaît pas le thème.
 */
export const LANE_COLORS_LIGHT = [
  "#2563eb",
  "#16a34a",
  "#d97706",
  "#dc2626",
  "#7c3aed",
  "#0891b2",
  "#ea580c",
  "#db2777",
];

/** Palette à utiliser pour le thème courant. */
export function lanePalette(dark: boolean): string[] {
  return dark ? LANE_COLORS : LANE_COLORS_LIGHT;
}

/**
 * Nature d'un segment dessiné dans une rangée :
 *  - `through` : une lane non concernée par le commit, traversée de haut en bas ;
 *  - `in`      : une ligne qui descend du haut et aboutit sur le point du commit ;
 *  - `out`     : une ligne qui part du point du commit vers la rangée suivante.
 */
export type GraphEdgeKind = "through" | "in" | "out";

export interface GraphEdge {
  fromLane: number;
  toLane: number;
  /** Index dans `LANE_COLORS`. */
  color: number;
  kind: GraphEdgeKind;
  /**
   * Segment de la ligne qui relie les modifications en cours à HEAD : dessiné
   * en pointillés, comme le nœud WIP lui-même — ce lien n'est pas encore un
   * commit. Absent partout ailleurs, plutôt que `false`.
   */
  dashed?: true;
  /**
   * Git Flow : prolongement d'une branche pérenne au-dessus de sa pointe,
   * jusqu'en haut du graph — dessiné atténué, ce n'est pas de l'historique,
   * seulement la colonne qui attend. Toujours un `through` dans une seule
   * colonne ; `top` / `bottom` n'en couvrent que la moitié haute ou basse,
   * l'autre étant déjà occupée par un vrai segment. Absent partout ailleurs.
   */
  ghost?: "full" | "top" | "bottom";
}

/** Géométrie commune à toutes les rangées, commit ou non. */
interface RowGeometry {
  /** Colonne du point de la rangée. */
  lane: number;
  color: number;
  edges: GraphEdge[];
}

export interface CommitRow extends RowGeometry {
  kind: "commit";
  commit: GraphCommit;
}

/**
 * Rangée des modifications en cours, en tête du graph. Elle n'a pas de commit :
 * d'où le type discriminé plutôt qu'un faux `GraphCommit`, qui aurait exigé un
 * oid inventé — et l'aurait rendu comparable à un vrai (sélection, pastilles).
 */
export interface WipRow extends RowGeometry {
  kind: "wip";
}

export type GraphRow = CommitRow | WipRow;

/**
 * Nœud « modifications en cours » à placer en tête du graph, quand le working
 * directory n'est pas propre.
 */
export interface WipInput {
  /**
   * Commit sur lequel ces modifications reposent (HEAD) — la rangée s'y
   * raccorde. `null` sur un dépôt sans commit : le nœud est alors seul.
   */
  head: string | null;
}

export interface GraphLayout {
  rows: GraphRow[];
  /** Nombre de colonnes occupées au plus fort — dimensionne la gouttière. */
  laneCount: number;
}

/**
 * Colonnes fixes du graph : à chaque commit, la bande où il doit être dessiné.
 *
 * Une bande est un groupe de colonnes contiguës. Les `count` premières sont
 * celles que l'utilisateur a ordonnées (Git Flow : `main`, `stage`,
 * `develop`…) ; tout commit absent de `bandOf` tombe dans une dernière bande,
 * libre, à droite des autres — les features en premier lieu. Voir
 * `flowBands` dans `lib/gitflow.ts`, qui la calcule.
 */
export interface GraphBands {
  bandOf: Map<string, number>;
  count: number;
  /**
   * Bandes à prolonger jusqu'en haut du graph (les branches pérennes : noms
   * exacts, pas les groupes) — voir `GraphEdge.ghost`.
   */
  extend?: number[];
}

function colorOf(lane: number): number {
  return lane % LANE_COLORS.length;
}

/** Index de la dernière lane occupée + 1. */
function widthOf(lanes: (string | null)[]): number {
  for (let i = lanes.length - 1; i >= 0; i--) {
    if (lanes[i] !== null) return i + 1;
  }
  return 0;
}

/**
 * Pendant le parcours, une lane est désignée par sa bande et son rang dans la
 * bande, codés dans un seul nombre : la largeur d'une bande n'est connue
 * qu'à la fin, et c'est elle qui fixe où commence la suivante. Les rangées
 * sont donc produites dans ce codage, puis ramenées en colonnes une fois les
 * largeurs connues.
 */
const STRIDE = 1 << 16;

/**
 * Place les commits en lanes et produit les segments à dessiner.
 *
 * Prérequis : `commits` est trié topologiquement (un enfant précède toujours ses
 * parents) — c'est ce que garantit le tri `TOPOLOGICAL | TIME` du backend.
 *
 * Principe : on maintient, pour chaque colonne, l'oid du prochain commit qu'elle
 * attend. Un commit prend la colonne qui l'attend (ou une nouvelle s'il est une
 * tête) ; les autres colonnes qui l'attendaient y convergent ; puis ses parents
 * prennent la relève — le premier dans sa propre colonne, les suivants dans une
 * colonne déjà en attente ou dans une nouvelle.
 *
 * `wip` ajoute en tête la rangée des modifications en cours. Elle est traitée
 * comme un pseudo-commit dont HEAD serait le parent : la boucle réserve alors la
 * colonne de HEAD dès le haut du graph, y fait traverser les rangées
 * intermédiaires et l'y fait aboutir, sans un seul cas particulier de plus. La
 * branche courante prend donc la colonne 0 même si son commit n'est pas le
 * premier de la liste — c'est exactement ce que le nœud raconte.
 *
 * `bands` (Git Flow) range les colonnes par groupes : chaque bande a les
 * siennes, allouées comme ci-dessus mais **dans la bande**, et un commit prend
 * une colonne de sa propre bande — celle qui l'y attend, sinon une nouvelle,
 * vers laquelle convergent les colonnes d'autres bandes qui l'attendaient.
 * Chaque bande est aussi large qu'au plus fort de l'historique chargé, et ce
 * sur toute la hauteur : `develop` ne glisse pas d'une colonne quand `stage`
 * n'a plus de commit à l'écran. Sans `bands`, il n'y a qu'une bande, libre, et
 * le résultat est exactement celui de l'algorithme d'origine.
 *
 * Coût : O(n · lanes). Recalculé intégralement à chaque page chargée, ce qui
 * reste négligeable devant l'appel Tauri.
 */
export function layoutGraph(
  commits: GraphCommit[],
  wip: WipInput | null = null,
  bands: GraphBands | null = null,
): GraphLayout {
  const bandCount = (bands?.count ?? 0) + 1;
  const free = bandCount - 1;
  const bandOf = (oid: string | null): number =>
    oid === null ? free : (bands?.bandOf.get(oid) ?? free);

  const rows: GraphRow[] = [];
  // Pour chaque bande, pour chaque colonne : l'oid attendu, ou null si libre.
  const lanes: (string | null)[][] = Array.from({ length: bandCount }, () => []);
  // Largeur atteinte par chaque bande au plus fort.
  const widths: number[] = new Array(bandCount).fill(0);
  // Colonne qui porte la ligne WIP → HEAD, tant que HEAD n'est pas atteint.
  // Elle ne bouge jamais : aucune étape ne déplace un oid déjà en attente.
  let wipLane: number | null = null;

  const at = (id: number) => lanes[Math.floor(id / STRIDE)];
  const get = (id: number) => at(id)[id % STRIDE];
  const set = (id: number, value: string | null) => {
    at(id)[id % STRIDE] = value;
  };

  /** Première lane libre de la bande, ou une nouvelle colonne à sa droite. */
  function alloc(band: number): number {
    const own = lanes[band];
    let free = own.indexOf(null);
    if (free === -1) {
      own.push(null);
      free = own.length - 1;
    }
    return band * STRIDE + free;
  }

  /** Lane qui attend `oid`, dans la bande `band` seulement si elle est donnée. */
  function waiting(oid: string, band?: number): number {
    for (let b = 0; b < bandCount; b++) {
      if (band !== undefined && b !== band) continue;
      const i = lanes[b].indexOf(oid);
      if (i !== -1) return b * STRIDE + i;
    }
    return -1;
  }

  function measure(snapshot: (string | null)[][]) {
    for (let b = 0; b < bandCount; b++) {
      widths[b] = Math.max(widths[b], widthOf(snapshot[b]));
    }
  }

  function touch(id: number) {
    const b = Math.floor(id / STRIDE);
    widths[b] = Math.max(widths[b], (id % STRIDE) + 1);
  }

  if (wip) {
    // La rangée prend la bande de HEAD : c'est vers lui que sa ligne descend.
    const lane = alloc(bandOf(wip.head));
    const edges: GraphEdge[] = [];
    // Sans commit (dépôt vierge), le nœud ne descend nulle part.
    if (wip.head !== null) {
      set(lane, wip.head);
      wipLane = lane;
      edges.push({ fromLane: lane, toLane: lane, color: 0, kind: "out", dashed: true });
    }
    rows.push({ kind: "wip", lane, color: 0, edges });
    touch(lane);
  }

  for (const commit of commits) {
    // État des colonnes en haut de la rangée, avant traitement du commit.
    const before = lanes.map((band) => band.slice());
    const band = bandOf(commit.oid);

    // 1. Colonne du commit : celle qui l'attend dans sa bande ; à défaut, dans
    //    la bande libre, n'importe laquelle qui l'attend (l'algorithme
    //    d'origine) ; sinon une nouvelle — c'est une tête, ou une branche fixe
    //    que seule une autre bande attendait.
    let lane = waiting(commit.oid, band);
    if (lane === -1 && band === free) lane = waiting(commit.oid);
    if (lane === -1) lane = alloc(band);

    // 2. Les autres colonnes qui attendaient ce commit convergent vers `lane`.
    for (const own of lanes) {
      for (let i = 0; i < own.length; i++) {
        if (own[i] === commit.oid) own[i] = null;
      }
    }

    // 3. Les parents prennent la relève. Le premier reste dans la colonne du
    //    commit (continuité visuelle de la branche) ; les suivants réutilisent
    //    une colonne qui attend déjà le même parent, sinon en ouvrent une dans
    //    la bande du parent.
    const parentLanes: number[] = [];
    commit.parents.forEach((parent, i) => {
      if (i === 0) {
        set(lane, parent);
        parentLanes.push(lane);
        return;
      }
      let l = waiting(parent);
      if (l === -1) {
        l = alloc(bandOf(parent));
        set(l, parent);
      }
      // Un même parent listé deux fois ne doit pas produire deux segments.
      if (!parentLanes.includes(l)) parentLanes.push(l);
    });

    // 4. Segments de la rangée : ce qui descend du haut, puis ce qui repart du point.
    const edges: GraphEdge[] = [];
    before.forEach((own, b) => {
      for (let i = 0; i < own.length; i++) {
        const expected = own[i];
        if (expected === null) continue;
        const id = b * STRIDE + i;
        const kind: GraphEdgeKind = expected === commit.oid ? "in" : "through";
        // Colonne non concernée : elle traverse la rangée sans changer d'index
        // (aucune étape ne déplace un oid déjà en attente).
        const edge: GraphEdge = { fromLane: id, toLane: kind === "in" ? lane : id, color: 0, kind };
        if (id === wipLane) edge.dashed = true;
        edges.push(edge);
      }
    });
    // HEAD atteint : la ligne WIP s'arrête sur son point, ce qui en repart est
    // l'historique ordinaire.
    if (wipLane !== null && before[Math.floor(wipLane / STRIDE)][wipLane % STRIDE] === commit.oid) {
      wipLane = null;
    }
    for (const l of parentLanes) {
      edges.push({ fromLane: lane, toLane: l, color: 0, kind: "out" });
    }

    touch(lane);
    measure(before);
    measure(lanes);
    rows.push({ kind: "commit", commit, lane, color: 0, edges });
  }

  // Les largeurs sont connues : chaque bande commence où finit la précédente.
  const offsets: number[] = [];
  let laneCount = 0;
  for (const w of widths) {
    offsets.push(laneCount);
    laneCount += w;
  }
  const column = (id: number) => offsets[Math.floor(id / STRIDE)] + (id % STRIDE);
  for (const row of rows) {
    row.lane = column(row.lane);
    row.color = colorOf(row.lane);
    for (const edge of row.edges) {
      edge.fromLane = column(edge.fromLane);
      edge.toLane = column(edge.toLane);
      // Ce qui descend prend la couleur de sa colonne d'origine, ce qui
      // repart celle du parent qu'il rejoint.
      edge.color = colorOf(edge.kind === "out" ? edge.toLane : edge.fromLane);
    }
  }

  // Git Flow : une branche pérenne qui n'a pas bougé depuis longtemps
  // laisserait sa colonne vide au-dessus de sa pointe. On la prolonge
  // jusqu'en haut, dans la colonne de sa pointe — la rangée la plus haute de
  // sa bande —, partout où cette colonne est libre : un merge peut déjà y
  // ouvrir une ligne vers elle, qui reste alors seule. Ajouté en tête de la
  // rangée, pour être dessiné sous les vrais segments qu'il croise.
  for (const b of bands?.extend ?? []) {
    const tip = rows.findIndex((r) => r.kind === "commit" && bandOf(r.commit.oid) === b);
    if (tip === -1) continue;
    const lane = rows[tip].lane;
    for (let i = 0; i <= tip; i++) {
      // Moitiés de la colonne déjà occupées dans cette rangée.
      let top = false;
      let bottom = i === tip; // sous la pointe, c'est son historique
      for (const e of rows[i].edges) {
        if (e.kind === "through" && e.fromLane === lane) top = bottom = true;
        else if (e.kind === "in" && e.fromLane === lane) top = true;
        else if (e.kind === "out" && e.toLane === lane) bottom = true;
      }
      const ghost = !top && !bottom ? "full" : !top ? "top" : !bottom ? "bottom" : null;
      if (ghost) {
        rows[i].edges.unshift({ fromLane: lane, toLane: lane, color: colorOf(lane), kind: "through", ghost });
      }
    }
  }

  return { rows, laneCount };
}
