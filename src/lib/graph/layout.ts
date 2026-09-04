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
}

export interface GraphRow {
  commit: GraphCommit;
  /** Colonne du point du commit. */
  lane: number;
  color: number;
  edges: GraphEdge[];
}

export interface GraphLayout {
  rows: GraphRow[];
  /** Nombre de colonnes occupées au plus fort — dimensionne la gouttière. */
  laneCount: number;
}

function colorOf(lane: number): number {
  return lane % LANE_COLORS.length;
}

/** Première lane libre, ou une nouvelle colonne à droite. */
function allocLane(lanes: (string | null)[]): number {
  const free = lanes.indexOf(null);
  if (free !== -1) return free;
  lanes.push(null);
  return lanes.length - 1;
}

/** Index de la dernière lane occupée + 1. */
function widthOf(lanes: (string | null)[]): number {
  for (let i = lanes.length - 1; i >= 0; i--) {
    if (lanes[i] !== null) return i + 1;
  }
  return 0;
}

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
 * Coût : O(n · lanes). Recalculé intégralement à chaque page chargée, ce qui
 * reste négligeable devant l'appel Tauri.
 */
export function layoutGraph(commits: GraphCommit[]): GraphLayout {
  const rows: GraphRow[] = [];
  // Pour chaque colonne : l'oid attendu, ou null si la colonne est libre.
  const lanes: (string | null)[] = [];
  let laneCount = 0;

  for (const commit of commits) {
    // État des colonnes en haut de la rangée, avant traitement du commit.
    const before = lanes.slice();

    // 1. Colonne du commit : celle qui l'attend, sinon une nouvelle (c'est une tête).
    let lane = lanes.indexOf(commit.oid);
    if (lane === -1) lane = allocLane(lanes);

    // 2. Les autres colonnes qui attendaient ce commit convergent vers `lane`.
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] === commit.oid) lanes[i] = null;
    }

    // 3. Les parents prennent la relève. Le premier reste dans la colonne du
    //    commit (continuité visuelle de la branche) ; les suivants réutilisent
    //    une colonne qui attend déjà le même parent, sinon en ouvrent une.
    const parentLanes: number[] = [];
    commit.parents.forEach((parent, i) => {
      if (i === 0) {
        lanes[lane] = parent;
        parentLanes.push(lane);
        return;
      }
      let l = lanes.indexOf(parent);
      if (l === -1) {
        l = allocLane(lanes);
        lanes[l] = parent;
      }
      // Un même parent listé deux fois ne doit pas produire deux segments.
      if (!parentLanes.includes(l)) parentLanes.push(l);
    });

    // 4. Segments de la rangée : ce qui descend du haut, puis ce qui repart du point.
    const edges: GraphEdge[] = [];
    for (let i = 0; i < before.length; i++) {
      const waiting = before[i];
      if (waiting === null) continue;
      if (waiting === commit.oid) {
        edges.push({ fromLane: i, toLane: lane, color: colorOf(i), kind: "in" });
      } else {
        // Colonne non concernée : elle traverse la rangée sans changer d'index
        // (aucune étape ne déplace un oid déjà en attente).
        edges.push({ fromLane: i, toLane: i, color: colorOf(i), kind: "through" });
      }
    }
    for (const l of parentLanes) {
      edges.push({ fromLane: lane, toLane: l, color: colorOf(l), kind: "out" });
    }

    laneCount = Math.max(laneCount, lane + 1, widthOf(before), widthOf(lanes));
    rows.push({ commit, lane, color: colorOf(lane), edges });
  }

  return { rows, laneCount };
}
