// Groupes d'onglets : ce qui se calcule sans rien demander à personne — pur et
// testé. `TabsStore` tient l'état et la persistance, `TabBar` l'affichage et
// le glissement.
//
// Un groupe est **permanent** : il retient ses dépôts par chemin canonique,
// ouverts ou non. Sa place dans la barre n'est enregistrée nulle part : elle
// découle de l'ordre des onglets, où ses membres ouverts sont toujours d'un
// seul tenant — sa pastille se pose devant le premier.

import type { TabGroup } from "./types";

/** Couleurs proposées, dans l'ordre du sélecteur. Teintes dans `app.css`. */
export const GROUP_COLORS = [
  "grey",
  "blue",
  "red",
  "yellow",
  "green",
  "pink",
  "purple",
  "cyan",
  "orange",
] as const;

export type GroupColor = (typeof GROUP_COLORS)[number];

/** Même borne que `TAB_GROUP_NAME_MAX` côté Rust. */
export const GROUP_NAME_MAX = 40;

/**
 * Les règles de `sanitize_tab_groups`, côté frontend : un dépôt n'appartient
 * qu'au premier groupe qui le cite, un groupe sans membre disparaît, une
 * couleur inconnue retombe sur le bleu.
 */
export function normalizeGroups(groups: TabGroup[]): TabGroup[] {
  const ids = new Set<string>();
  const taken = new Set<string>();
  const out: TabGroup[] = [];
  for (const g of groups) {
    if (!g.id || ids.has(g.id)) continue;
    ids.add(g.id);
    const members = g.members.filter((m) => {
      if (!m || taken.has(m)) return false;
      taken.add(m);
      return true;
    });
    if (members.length === 0) continue;
    out.push({
      ...g,
      members,
      color: (GROUP_COLORS as readonly string[]).includes(g.color) ? g.color : "blue",
      name: g.name.trim().slice(0, GROUP_NAME_MAX),
    });
  }
  return out;
}

export function groupOf(groups: TabGroup[], id: string): TabGroup | null {
  return groups.find((g) => g.members.includes(id)) ?? null;
}

/** Première couleur qu'aucun groupe n'utilise encore, sinon on recommence. */
export function nextColor(groups: TabGroup[]): GroupColor {
  const used = new Set(groups.map((g) => g.color));
  return (
    GROUP_COLORS.find((c) => c !== "grey" && !used.has(c)) ??
    GROUP_COLORS[(groups.length % (GROUP_COLORS.length - 1)) + 1]
  );
}

/**
 * Rassemble les membres ouverts de chaque groupe à la place du premier d'entre
 * eux, dans leur ordre relatif. Le reste ne bouge pas. C'est ce qui rend un
 * groupe d'un seul tenant après une restauration de session, une ouverture
 * (le nouveau venu rejoint les siens) ou un retrait (celui qui sort se
 * retrouve après le groupe qu'il quitte).
 */
export function contiguous(ids: string[], groups: TabGroup[]): string[] {
  const owner = new Map<string, string>();
  for (const g of groups) for (const m of g.members) owner.set(m, g.id);
  const out: string[] = [];
  const placed = new Set<string>();
  for (const id of ids) {
    const gid = owner.get(id);
    if (gid === undefined) {
      out.push(id);
    } else if (!placed.has(gid)) {
      placed.add(gid);
      out.push(...ids.filter((x) => owner.get(x) === gid));
    }
  }
  return out;
}

/** Ce que la barre affiche, dans l'ordre : pastilles de groupe et onglets. */
export type StripItem =
  | {
      kind: "group";
      group: TabGroup;
      /** Membres ouverts, dans l'ordre de la barre, cachés compris. */
      tabs: string[];
    }
  | { kind: "tab"; id: string; group: TabGroup | null };

/**
 * Éléments affichés. Un groupe replié ne montre que sa pastille — **sauf
 * l'onglet affiché**, qui reste visible juste après elle : replier un groupe
 * ne doit pas changer de dépôt sous les yeux.
 *
 * `ids` est supposé d'un seul tenant (voir `contiguous`).
 */
export function stripItems(
  ids: string[],
  groups: TabGroup[],
  activeId: string | null,
): StripItem[] {
  const items: StripItem[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const group = groupOf(groups, id);
    if (group && !seen.has(group.id)) {
      seen.add(group.id);
      items.push({ kind: "group", group, tabs: ids.filter((x) => group.members.includes(x)) });
    }
    if (group?.collapsed && id !== activeId) continue;
    items.push({ kind: "tab", id, group });
  }
  return items;
}

/** Un onglet est-il visible dans la barre ? */
export function isVisible(id: string, groups: TabGroup[], activeId: string | null): boolean {
  return id === activeId || !groupOf(groups, id)?.collapsed;
}

function lastMember(ids: string[], group: TabGroup): number {
  let last = -1;
  ids.forEach((x, i) => {
    if (group.members.includes(x)) last = i;
  });
  return last;
}

/**
 * Où atterrit un onglet lâché à l'emplacement `slot` des éléments affichés —
 * un index d'insertion dans `items` où l'onglet glissé compte encore, comme
 * pour la barre sans groupes.
 *
 * L'appartenance se lit sur les voisins, pas sur la géométrie :
 *
 * - juste après la pastille d'un groupe déployé → il y entre, en tête ;
 * - entre deux onglets d'un même groupe → il y entre ;
 * - juste après le dernier onglet d'un groupe → il n'y entre que s'il en était
 *   déjà : un onglet du groupe peut ainsi passer en queue, et un étranger posé
 *   là se place à côté du groupe, sans y entrer. L'ambiguïté du bord est
 *   inévitable ; le menu contextuel est là pour l'autre cas.
 *
 * Un onglet qui ne peut pas être groupé (page d'accueil, paramètres) ou un
 * groupe replié n'accueillent personne : lâché au milieu, l'onglet est posé
 * après le groupe, jamais dedans.
 */
export function dropTab(
  ids: string[],
  groups: TabGroup[],
  items: StripItem[],
  slot: number,
  dragged: string,
  groupable: boolean,
): { order: string[]; group: string | null } {
  const from = items.findIndex((it) => it.kind === "tab" && it.id === dragged);
  const rest = items.filter((_, i) => i !== from);
  const at = from !== -1 && slot > from ? slot - 1 : slot;
  const prev = rest[at - 1];
  const next = rest[at];
  const own = groupOf(groups, dragged);

  // La pastille d'un groupe ouvre ce groupe : elle compte pour lui côté gauche,
  // mais à droite elle n'est que le début du suivant.
  const prevGroup = prev?.group ?? null;
  const nextGroup = next?.kind === "tab" ? next.group : null;

  let join: TabGroup | null = null;
  if (groupable && prevGroup && !prevGroup.collapsed) {
    if (prev!.kind === "group") join = prevGroup;
    else if (nextGroup?.id === prevGroup.id || own?.id === prevGroup.id) join = prevGroup;
  }

  const order = ids.filter((x) => x !== dragged);
  let index: number;
  if (join && next?.kind === "tab" && next.group?.id === join.id) {
    index = order.indexOf(next.id);
  } else if (join) {
    const last = lastMember(order, join);
    index = last === -1 ? order.length : last + 1;
  } else if (prevGroup && nextGroup?.id === prevGroup.id) {
    // Au milieu d'un groupe sans y entrer : après lui.
    index = lastMember(order, prevGroup) + 1;
  } else if (next?.kind === "tab") {
    index = order.indexOf(next.id);
  } else if (next?.kind === "group") {
    index = order.indexOf(next.tabs.find((x) => x !== dragged) ?? "");
  } else {
    index = order.length;
  }
  if (index < 0) index = order.length;
  order.splice(index, 0, dragged);
  return { order, group: join?.id ?? null };
}

/**
 * Unités déplaçables quand on glisse une pastille : un groupe entier (pastille
 * et onglets affichés) ou un onglet hors groupe. Bornes en index de `items`,
 * fin exclue.
 */
export function groupUnits(items: StripItem[]): { start: number; end: number }[] {
  const units: { start: number; end: number }[] = [];
  for (let i = 0; i < items.length; ) {
    const it = items[i];
    let end = i + 1;
    if (it.kind === "group") {
      while (end < items.length) {
        const n = items[end];
        if (n.kind !== "tab" || n.group?.id !== it.group.id) break;
        end++;
      }
    }
    units.push({ start: i, end });
    i = end;
  }
  return units;
}

/**
 * Déplace un groupe entier — ses membres ouverts, cachés compris — à l'unité
 * `slot` (index d'insertion dans `groupUnits(items)`, le groupe glissé compté).
 */
export function dropGroup(
  ids: string[],
  items: StripItem[],
  slot: number,
  groupId: string,
): string[] {
  const units = groupUnits(items);
  const from = units.findIndex((u) => {
    const it = items[u.start];
    return it.kind === "group" && it.group.id === groupId;
  });
  if (from === -1) return ids;
  const block = (items[units[from].start] as Extract<StripItem, { kind: "group" }>).tabs;
  const rest = units.filter((_, i) => i !== from);
  const at = slot > from ? slot - 1 : slot;
  const order = ids.filter((x) => !block.includes(x));
  const next = rest[at];
  let index = order.length;
  if (next) {
    const it = items[next.start];
    const first = it.kind === "group" ? it.tabs[0] : it.id;
    index = order.indexOf(first);
    if (index < 0) index = order.length;
  }
  order.splice(index, 0, ...block);
  return order;
}
