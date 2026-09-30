/*
  Colonnes du tableau du graph : leur modèle, leur placement, leur déplacement.

  Pur et testé, comme `layout.ts` : le composant ne fait que mesurer et
  dessiner. La disposition — ordre, colonnes masquées, largeurs — est commune à
  tous les dépôts et persistée dans `prefs.json` ; le backend la nettoie avec
  les mêmes règles (`GraphColumns::sanitized`, `dto.rs`), celles d'ici servant
  à ce que le frontend n'affiche jamais rien d'incohérent en attendant.

  Les largeurs sont en **rem**, comme celles des colonnes latérales : une
  largeur figée en pixels tronquerait le texte dès qu'on grossit la police.
*/

export type ColumnId = "refs" | "graph" | "message" | "author" | "date" | "sha";

/** Ordre par défaut — celui de `GRAPH_COLUMNS` côté Rust. */
export const COLUMN_IDS: readonly ColumnId[] = [
  "refs",
  "graph",
  "message",
  "author",
  "date",
  "sha",
];

/**
 * La colonne élastique : jamais masquée, jamais dimensionnée, elle prend ce que
 * les autres laissent. Un tableau sans elle ne dirait plus rien des commits.
 */
export const MESSAGE = "message" satisfies ColumnId;

/**
 * Largeurs par défaut, en rem. Le graph n'y figure pas : sans largeur choisie,
 * il suit le nombre de branches. `refs` reprend les 10,6 rem de l'ancienne
 * colonne des pastilles.
 */
export const DEFAULT_WIDTHS: Readonly<Record<Exclude<ColumnId, "graph" | "message">, number>> = {
  refs: 10.6,
  author: 9,
  // Jour et heure : « Sep 21, 26, 02:32 PM » en anglais.
  date: 9,
  sha: 4.6,
};

/** Bornes d'une largeur, en rem — celles de `GRAPH_COL_W_MIN` / `_MAX`. */
export const COL_W_MIN = 2.5;
export const COL_W_MAX = 40;
/** Ce que le message garde au minimum quand les autres colonnes s'élargissent. */
export const MESSAGE_MIN_REM = 8;

export interface GraphColumns {
  order: ColumnId[];
  hidden: ColumnId[];
  /** En rem. Absente = largeur par défaut ; pour le graph, largeur ajustée. */
  widths: Partial<Record<ColumnId, number>>;
}

export const DEFAULT_COLUMNS: GraphColumns = { order: [...COLUMN_IDS], hidden: [], widths: {} };

function isColumn(id: unknown): id is ColumnId {
  return typeof id === "string" && (COLUMN_IDS as readonly string[]).includes(id);
}

/**
 * Ramène une disposition quelconque à une disposition affichable — mêmes règles
 * que le backend : inconnues et doublons écartés, manquantes rajoutées en fin
 * dans l'ordre par défaut, message ni masqué ni dimensionné, largeurs bornées.
 */
export function normalizeColumns(raw: {
  order?: unknown[];
  hidden?: unknown[];
  widths?: Record<string, unknown>;
}): GraphColumns {
  const order: ColumnId[] = [];
  for (const id of raw.order ?? []) if (isColumn(id) && !order.includes(id)) order.push(id);
  for (const id of COLUMN_IDS) if (!order.includes(id)) order.push(id);

  const hidden: ColumnId[] = [];
  for (const id of raw.hidden ?? []) {
    if (isColumn(id) && id !== MESSAGE && !hidden.includes(id)) hidden.push(id);
  }

  const widths: Partial<Record<ColumnId, number>> = {};
  for (const [id, w] of Object.entries(raw.widths ?? {})) {
    if (!isColumn(id) || id === MESSAGE) continue;
    if (typeof w !== "number" || !Number.isFinite(w)) continue;
    widths[id] = Math.min(Math.max(w, COL_W_MIN), COL_W_MAX);
  }
  return { order, hidden, widths };
}

/** Colonnes affichées, dans leur ordre. */
export function visibleColumns(cols: GraphColumns): ColumnId[] {
  return cols.order.filter((id) => !cols.hidden.includes(id));
}

export interface PlacedColumn {
  id: ColumnId;
  /** Bord gauche, en pixels depuis le début du tableau. */
  x: number;
  width: number;
}

/**
 * Place les colonnes affichées, en pixels. Le message prend la largeur restante
 * sans descendre sous `MESSAGE_MIN_REM` : au-delà, c'est le tableau qui déborde
 * à droite — rogné — plutôt que le message qui disparaît.
 */
export function placeColumns(
  cols: GraphColumns,
  { availablePx, rootPx, graphAutoPx }: { availablePx: number; rootPx: number; graphAutoPx: number },
): PlacedColumn[] {
  const ids = visibleColumns(cols);
  const widthOf = (id: ColumnId): number => {
    const chosen = cols.widths[id];
    if (id === "graph") return chosen !== undefined ? chosen * rootPx : graphAutoPx;
    if (id === MESSAGE) return 0;
    return (chosen ?? DEFAULT_WIDTHS[id]) * rootPx;
  };
  const fixed = ids.reduce((sum, id) => sum + widthOf(id), 0);
  const messageW = Math.max(MESSAGE_MIN_REM * rootPx, availablePx - fixed);

  let x = 0;
  return ids.map((id) => {
    const width = id === MESSAGE ? messageW : widthOf(id);
    const placed = { id, x, width };
    x += width;
    return placed;
  });
}

/**
 * Emplacement de dépôt d'une colonne glissée : index d'**insertion** dans les
 * colonnes affichées, la colonne glissée comptant encore — la règle de la barre
 * d'onglets. C'est le bord **d'attaque** qui décide (le gauche en allant à
 * gauche, le droit en allant à droite), comparé aux milieux de la disposition
 * **d'origine** : avec des colonnes de largeurs très différentes, le centre
 * laisserait des places inatteignables.
 */
export function dropIndex(placed: PlacedColumn[], from: number, left: number): number {
  const origin = placed[from];
  const right = left + origin.width;
  const mid = (c: PlacedColumn) => c.x + c.width / 2;
  if (left < origin.x) {
    for (let i = 0; i < from; i++) if (left < mid(placed[i])) return i;
  } else if (left > origin.x) {
    for (let i = placed.length - 1; i > from; i--) if (right > mid(placed[i])) return i + 1;
  }
  return from;
}

/**
 * Déplace `id` juste avant `beforeId` dans l'ordre complet — `null` pour le
 * mettre en dernier. On raisonne sur l'ordre complet, pas sur les colonnes
 * affichées : une colonne masquée garde sa place relative, et la réafficher
 * la remet là où on l'avait laissée.
 */
export function moveColumn(order: ColumnId[], id: ColumnId, beforeId: ColumnId | null): ColumnId[] {
  if (id === beforeId) return order;
  const next = order.filter((c) => c !== id);
  const at = beforeId === null ? next.length : next.indexOf(beforeId);
  next.splice(at === -1 ? next.length : at, 0, id);
  return next;
}
