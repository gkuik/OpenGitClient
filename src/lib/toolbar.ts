// Barre du dépôt personnalisable : ce qui se calcule sans rien demander à
// personne — pur et testé, comme `graph/columns.ts`. L'état et sa persistance
// sont dans `toolbar.svelte.ts`.
//
// La barre est une **liste d'éléments**, dans l'ordre d'affichage : des actions
// (une fois chacune au plus) et des éléments de mise en page (autant qu'on
// veut). Une liste vide est une barre vide — autorisée, même si elle ne sert à
// rien : c'est un choix de l'utilisateur, pas une erreur à corriger.

/** Les boutons d'action, dans l'ordre de la palette. */
export const TOOLBAR_ACTIONS = [
  "pull",
  "push",
  "fetch",
  "branch",
  "stash",
  "pop",
  "tag",
  "stage-all",
  "unstage-all",
  "discard-all",
  "gitflow",
  "forge",
  "finder",
  "terminal",
  "editor",
] as const;
/** Les éléments de mise en page, répétables. */
export const TOOLBAR_SPACERS = ["separator", "space"] as const;

export type ToolbarAction = (typeof TOOLBAR_ACTIONS)[number];
export type ToolbarItem = ToolbarAction | (typeof TOOLBAR_SPACERS)[number];

/** Ce que la palette propose, dans son ordre. */
export const PALETTE: readonly ToolbarItem[] = [...TOOLBAR_ACTIONS, ...TOOLBAR_SPACERS];

/**
 * La barre d'avant la personnalisation : distant · local · Git Flow. Elle ne
 * vit qu'ici — le backend enregistre `null` tant qu'on n'a rien changé, si bien
 * qu'une action ajoutée par une version future apparaît d'elle-même chez qui
 * n'a jamais touché à sa barre.
 */
export const DEFAULT_TOOLBAR: readonly ToolbarItem[] = [
  "pull",
  "push",
  "fetch",
  "separator",
  "branch",
  "stash",
  "separator",
  "gitflow",
];

/**
 * Les boutons dont le libellé ne tient pas dans un carré de 48px : ils
 * s'élargissent, à la hauteur des autres. Partagé par la barre et par les
 * tuiles de personnalisation, sans quoi ce qu'on dépose ne serait pas ce qu'on
 * voit.
 */
const WIDE: readonly ToolbarItem[] = ["gitflow", "stage-all", "unstage-all", "discard-all"];

export function isWide(item: ToolbarItem): boolean {
  return WIDE.includes(item);
}

export function isAction(item: ToolbarItem): item is ToolbarAction {
  return (TOOLBAR_ACTIONS as readonly string[]).includes(item);
}

function isItem(value: unknown): value is ToolbarItem {
  return typeof value === "string" && (PALETTE as readonly string[]).includes(value);
}

/**
 * Ramène ce que le backend a lu à une barre affichable : `null` (jamais
 * personnalisée) donne la barre par défaut, un élément inconnu part, une action
 * en double ne garde que sa première place. Mêmes règles que `sanitize_toolbar`
 * côté Rust — le fichier s'édite à la main.
 */
export function normalizeToolbar(raw: unknown): ToolbarItem[] {
  if (!Array.isArray(raw)) return [...DEFAULT_TOOLBAR];
  const out: ToolbarItem[] = [];
  for (const item of raw) {
    if (!isItem(item)) continue;
    if (isAction(item) && out.includes(item)) continue;
    out.push(item);
  }
  return out;
}

/**
 * Ce que la barre affiche hors personnalisation.
 *
 * Git Flow disparaît sur un dépôt où il n'est pas activé, et c'est ce qui
 * oblige à ranger les séparateurs : celui qui précédait Git Flow resterait
 * pendu au bout de la barre. Un séparateur n'est donc rendu **qu'entre deux
 * actions**, et un seul entre deux mêmes actions — ni en tête, ni en queue, ni
 * en double. Les espaces, eux, restent où on les a mis.
 */
export function visibleToolbar(items: readonly ToolbarItem[], flowEnabled: boolean): ToolbarItem[] {
  const shown = items.filter((item) => item !== "gitflow" || flowEnabled);
  const out: ToolbarItem[] = [];
  let actionBefore = false;
  let separated = false;
  shown.forEach((item, i) => {
    if (item === "separator") {
      if (!actionBefore || separated) return;
      if (!shown.slice(i + 1).some(isAction)) return;
      separated = true;
    } else if (isAction(item)) {
      actionBefore = true;
      separated = false;
    }
    out.push(item);
  });
  return out;
}

/**
 * Insère `item` à l'index d'insertion `at`. Une action déjà présente est
 * **déplacée** plutôt que dupliquée — la tirer de la palette revient alors à la
 * changer de place, comme dans le Finder.
 */
export function insertItem(items: readonly ToolbarItem[], item: ToolbarItem, at: number): ToolbarItem[] {
  const existing = isAction(item) ? items.indexOf(item) : -1;
  if (existing !== -1) return moveItem(items, existing, at);
  const next = [...items];
  next.splice(clamp(at, 0, next.length), 0, item);
  return next;
}

/**
 * Déplace l'élément d'index `from` vers l'index d'insertion `at`, compté dans
 * la liste **telle qu'elle est** — l'élément déplacé y figurant encore : c'est
 * ce que mesure le glissement, et la règle de la barre d'onglets.
 */
export function moveItem(items: readonly ToolbarItem[], from: number, at: number): ToolbarItem[] {
  if (from < 0 || from >= items.length) return [...items];
  const next = [...items];
  const [item] = next.splice(from, 1);
  const to = clamp(at > from ? at - 1 : at, 0, next.length);
  next.splice(to, 0, item);
  return next;
}

/** Retire l'élément d'index `index`. */
export function removeAt(items: readonly ToolbarItem[], index: number): ToolbarItem[] {
  return items.filter((_, i) => i !== index);
}

/**
 * Index d'insertion sous le curseur : le nombre d'éléments dont le milieu est
 * à sa gauche. Les milieux sont ceux de la barre **au début du geste** — rien
 * ne bouge pendant le glissement, donc la réponse ne peut pas osciller.
 */
export function insertionIndex(mids: readonly number[], x: number): number {
  let i = 0;
  while (i < mids.length && mids[i] < x) i++;
  return i;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}
