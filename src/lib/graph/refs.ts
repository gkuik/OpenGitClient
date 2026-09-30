// Regroupement des références d'un commit en pastilles affichables.
//
// Le backend renvoie une entrée par référence : `main`, `origin/main` et une
// éventuelle marque HEAD arrivent séparément, donc une branche synchronisée
// avec son distant occupait deux pastilles pour dire une seule chose. Ici on
// les réunit : une pastille par branche, portant le nom local et des icônes qui
// disent *où* elle existe.
//
// C'est de la présentation pure — comme l'assignation des lanes, elle vit côté
// frontend et n'a donc rien à dupliquer dans un futur backend CLI.

import type { GraphRef } from "../types";

export interface RefBadge {
  /** Libellé affiché : le nom local quand il existe, sinon le nom complet. */
  name: string;
  /** Branche courante : la pastille porte une coche. */
  isHead: boolean;
  /** La branche existe en local *sur ce commit*. */
  local: boolean;
  /**
   * C'est un tag, pas une branche. Il a sa propre pastille même quand une
   * branche porte le même nom : ce sont deux références distinctes, qui ne
   * disent pas la même chose (l'une avance, l'autre est faite pour rester).
   */
  tag: boolean;
  /** Noms complets des références distantes réunies ici ("origin/main"). */
  remotes: string[];
  /** Toutes les références réunies, pour l'infobulle. */
  title: string;
  /** Clé `{#each}` : stable tant que les références du commit ne changent pas. */
  key: string;
}

/**
 * Réunit les références d'un même commit.
 *
 * Une référence distante rejoint la pastille d'une branche locale quand elle en
 * est le suffixe (`origin/main` → `main`) : c'est le seul cas où les deux sont
 * **au même niveau**, puisque ce regroupement se fait à l'intérieur d'un commit.
 * Une branche locale en avance ou en retard sur son distant est par construction
 * sur une autre rangée, et garde donc sa propre pastille — les icônes disent
 * alors laquelle est laquelle.
 *
 * Le rapprochement se fait sur le suffixe plutôt qu'en découpant au premier
 * `/` : un nom de distant peut contenir un `/`, et un nom de branche aussi. La
 * correspondance la plus longue gagne, pour que `origin/feat/x` aille bien sur
 * `feat/x` et non sur un hypothétique `x`.
 */
export function groupRefs(refs: GraphRef[]): RefBadge[] {
  const badges: RefBadge[] = [];
  const byName = new Map<string, RefBadge>();

  for (const r of refs) {
    if (r.kind === "remoteBranch" || r.kind === "tag") continue;
    const existing = byName.get(r.name);
    if (existing) {
      // Deux références locales de même nom n'existent pas ; par sécurité, la
      // qualité de HEAD ne se perd pas dans le doublon.
      existing.isHead ||= r.kind === "head";
      continue;
    }
    const badge: RefBadge = {
      name: r.name,
      isHead: r.kind === "head",
      local: true,
      tag: false,
      remotes: [],
      title: r.name,
      key: "l:" + r.name,
    };
    byName.set(r.name, badge);
    badges.push(badge);
  }

  for (const r of refs) {
    if (r.kind !== "remoteBranch") continue;
    let host: RefBadge | undefined;
    for (const [name, badge] of byName) {
      if (!badge.local || !r.name.endsWith("/" + name)) continue;
      if (!host || name.length > host.name.length) host = badge;
    }
    if (host) {
      host.remotes.push(r.name);
      continue;
    }
    // Aucune branche locale ici : le nom complet est conservé tel quel, faute de
    // pouvoir en retirer le distant sans risque (son nom peut contenir un `/`).
    badges.push({
      name: r.name,
      isHead: false,
      local: false,
      tag: false,
      remotes: [r.name],
      title: r.name,
      key: "r:" + r.name,
    });
  }

  // Les tags, chacun le sien : aucun rapprochement, ni avec une branche ni
  // avec un distant — le backend ne lit que les tags locaux.
  for (const r of refs) {
    if (r.kind !== "tag") continue;
    badges.push({
      name: r.name,
      isHead: false,
      local: false,
      tag: true,
      remotes: [],
      title: r.name,
      key: "t:" + r.name,
    });
  }

  // L'infobulle porte ce que la pastille a cessé de dire : les noms complets.
  for (const b of badges) {
    if (b.local && b.remotes.length > 0) b.title = [b.name, ...b.remotes].join(" · ");
  }

  /*
    Ordre de lecture, et pas seulement d'affichage : la colonne est étroite, donc
    ce qui est en tête est ce qui survivra si l'affichage doit en couper. La
    branche courante d'abord, puis ce qui est ici, puis ce qui n'est que sur le
    serveur, et les tags en dernier : ils marquent un commit, ils ne disent rien
    de ce qui avance. `sort` est stable, l'ordre du backend (alphabétique) tient
    lieu de départage.
  */
  const rank = (b: RefBadge) => (b.isHead ? 0 : b.local ? 1 : b.tag ? 3 : 2);
  return badges.sort((a, b) => rank(a) - rank(b));
}
