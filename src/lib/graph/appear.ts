// Animation d'apparition des commits dans le graph.
//
// Rien ici ne sait quelle action a eu lieu : on compare l'historique affiché à
// celui d'avant, et ce qui est nouveau s'anime. Un commit, un fetch, un pull,
// un merge — ou un `git commit` lancé dans un terminal, que la surveillance du
// disque rapporte — passent donc tous par le même chemin. Fonctions pures,
// testées à part ; `GraphView` mesure le temps et dessine.

import type { GraphLayout } from "./layout";
import type { GraphCommit } from "../types";

/** Ce qu'il faut retenir d'un affichage pour reconnaître le suivant. */
export interface Seen {
  repoId: string;
  commits: GraphCommit[];
  oids: Set<string>;
  /** Colonne de la rangée « modifications en cours », si elle était là. */
  wipLane: number | null;
}

export function snapshot(repoId: string, layout: GraphLayout): Seen {
  const commits: GraphCommit[] = [];
  for (const row of layout.rows) if (row.kind === "commit") commits.push(row.commit);
  const head = layout.rows[0];
  return {
    repoId,
    commits,
    oids: new Set(commits.map((c) => c.oid)),
    wipLane: head?.kind === "wip" ? head.lane : null,
  };
}

/** Un commit à faire apparaître. */
export interface Fresh {
  oid: string;
  /**
   * Rang parmi les nouveaux, **en partant du bas** : il fixe le décalage. Un
   * commit naît de son parent, qui est en dessous ; la ligne monte donc de
   * l'historique déjà là vers le plus récent.
   */
  rank: number;
  /**
   * Le commit prend la place du cercle « modifications en cours » : même
   * rangée (la première), même colonne, et le cercle n'est plus là. C'est le
   * commit qu'on vient de faire — le cercle se remplit au lieu d'apparaître.
   */
  morph: boolean;
}

/**
 * Commits du nouvel affichage absents du précédent.
 *
 * Rien à animer quand l'onglet a changé (c'est un autre historique, pas du
 * nouveau), au premier affichage, ni quand une page s'est ajoutée au bout :
 * le défilement infini garde les objets de la page déjà là, et c'est à ça
 * qu'on le reconnaît — le premier et le dernier commit connus sont les mêmes
 * objets, aux mêmes places. Un rechargement, lui, en crée de nouveaux.
 */
export function freshCommits(prev: Seen | null, next: Seen, layout: GraphLayout): Fresh[] {
  if (!prev || prev.repoId !== next.repoId || prev.commits.length === 0) return [];
  const n = prev.commits.length;
  if (
    next.commits.length >= n &&
    next.commits[0] === prev.commits[0] &&
    next.commits[n - 1] === prev.commits[n - 1]
  ) {
    return [];
  }
  const out: Fresh[] = [];
  layout.rows.forEach((row, index) => {
    if (row.kind !== "commit" || prev.oids.has(row.commit.oid)) return;
    const morph =
      index === 0 && next.wipLane === null && prev.wipLane !== null && prev.wipLane === row.lane;
    out.push({ oid: row.commit.oid, rank: out.length, morph });
  });
  // Rangs comptés depuis le bas, une fois le compte connu.
  return out.map((f, i) => ({ ...f, rank: out.length - 1 - i }));
}

// ── Minutage ─────────────────────────────────────────────────────────────────

/*
  Des durées qu'on a le temps de voir sans attendre : en dessous, l'animation
  passait pour un saut de l'affichage plutôt qu'un mouvement.
*/
/**
 * Le tracé d'une rangée, de bas en haut. Égal au décalage entre deux rangées,
 * et linéaire : la rangée du dessus démarre quand celle du dessous finit, et
 * la ligne monte à vitesse constante, sans trou au raccord.
 */
export const LINE_MS = 180;
/** Décalage entre deux rangées nouvelles : la ligne semble monter. */
export const STAGGER_MS = LINE_MS;
/** Au-delà, les rangées démarrent ensemble : un gros fetch ne traîne pas. */
export const MAX_STAGGERED = 8;
/** Le point apparaît quand la ligne l'atteint, à mi-hauteur de sa rangée… */
export const DOT_DELAY_MS = LINE_MS / 2;
/** …et grossit en se dévoilant, avec un rebond à peine visible. */
export const DOT_MS = 520;
/** Le cercle « modifications en cours » qui se remplit. */
export const MORPH_MS = 750;
/**
 * La place des rangées nouvelles s'ouvre : ce qui est dessous glisse vers le
 * bas au lieu d'y sauter, et les lignes qui la traversent s'étirent.
 */
export const OPEN_MS = 380;
/**
 * Les commits commencent à pousser quand la place est presque ouverte (à ~97 %
 * de sa hauteur) : plus tôt, leur point serait dessiné dans une rangée encore
 * écrasée.
 */
export const OPEN_LEAD_MS = Math.round(OPEN_MS * 0.8);

/**
 * Retard de départ d'une rangée nouvelle : après l'ouverture de la place, puis
 * de bas en haut. Le commit qui remplit le cercle WIP n'ouvre rien — il prend
 * la place du cercle — et part tout de suite.
 */
export function delayOf(fresh: Fresh): number {
  return fresh.morph ? 0 : OPEN_LEAD_MS + Math.min(fresh.rank, MAX_STAGGERED) * STAGGER_MS;
}

/** Part de la place déjà ouverte, `t` ms après le début. */
export function openProgress(t: number): number {
  return easeInOutCubic(t / OPEN_MS);
}

/**
 * Rangées qui s'ouvrent au-dessus de la rangée `index` (`opened` trié) : c'est
 * de combien de rangées elle était plus haut avant, et donc d'où elle glisse.
 */
export function openedAbove(opened: number[], index: number): number {
  let n = 0;
  while (n < opened.length && opened[n] < index) n++;
  return n;
}

/** Durée totale d'une animation, retard exclu. */
export function durationOf(morph: boolean): number {
  return morph ? MORPH_MS : Math.max(LINE_MS, DOT_DELAY_MS + DOT_MS);
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export function easeOutCubic(x: number): number {
  const p = clamp01(x);
  return 1 - (1 - p) ** 3;
}

/** Démarre et finit en douceur : rien ne part ni ne s'arrête d'un coup. */
export function easeInOutCubic(x: number): number {
  const p = clamp01(x);
  return p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2;
}

/**
 * Dépasse à peine 1 avant d'y revenir (de l'ordre de 4 %) : le point se pose
 * plutôt qu'il ne saute.
 */
export function easeOutBack(x: number): number {
  const p = clamp01(x);
  const c1 = 0.8;
  const c3 = c1 + 1;
  return 1 + c3 * (p - 1) ** 3 + c1 * (p - 1) ** 2;
}

/**
 * Où en est une rangée `t` ms après son départ : `reveal`, la part de sa
 * hauteur déjà tracée ; `dot`, l'échelle de son point (peut dépasser 1, c'est
 * le rebond) ; `alpha`, son opacité. Pour le remplissage du cercle WIP,
 * `reveal` est le passage du pointillé au trait plein et `dot` le disque qui
 * grandit.
 */
export function progress(
  t: number,
  morph: boolean,
): { reveal: number; dot: number; alpha: number } {
  if (morph) {
    // Le trait monte du parent jusqu'au cercle, qui se remplit en suivant.
    return {
      reveal: easeInOutCubic(t / (MORPH_MS * 0.6)),
      dot: easeInOutCubic((t - MORPH_MS * 0.3) / (MORPH_MS * 0.7)),
      alpha: 1,
    };
  }
  const d = (t - DOT_DELAY_MS) / DOT_MS;
  return {
    reveal: clamp01(t / LINE_MS),
    // Le point part d'un tiers de sa taille : grossir depuis rien le faisait
    // jaillir. Il se dévoile sur la première moitié de sa course.
    dot: t <= DOT_DELAY_MS ? 0 : 0.35 + 0.65 * easeOutBack(d),
    alpha: t <= DOT_DELAY_MS ? 0 : easeOutCubic(d * 2),
  };
}
