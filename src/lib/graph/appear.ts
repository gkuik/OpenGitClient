// Animation d'apparition des commits dans le graph.
//
// Rien ici ne sait quelle action a eu lieu : on compare l'historique affiché à
// celui d'avant, et ce qui est nouveau s'anime. Un commit, un fetch, un pull,
// un merge — ou un `git commit` lancé dans un terminal, que la surveillance du
// disque rapporte — passent donc tous par le même chemin. Fonctions pures,
// testées à part ; `GraphView` mesure le temps et dessine.
//
// **Tout monte, toujours** : un commit naît de ses parents, qui sont en
// dessous. Chaque ligne nouvelle se dessine depuis le point du parent jusqu'à
// celui du commit, et le point n'apparaît que quand ses lignes l'atteignent.
// Pour un merge, les deux lignes — la branche cible et la branche fusionnée —
// montent ensemble et arrivent en même temps sur le point du merge.

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

/**
 * Le nouvel affichage est-il un rechargement du même historique — la seule
 * chose qui puisse amener du nouveau ? Ni un autre onglet, ni le premier
 * affichage, ni une page ajoutée au bout par le défilement : celle-ci garde
 * les objets déjà là, aux mêmes places, quand un rechargement en crée de
 * nouveaux.
 */
function reloaded(prev: Seen | null, next: Seen): prev is Seen {
  if (!prev || prev.repoId !== next.repoId || prev.commits.length === 0) return false;
  const n = prev.commits.length;
  return !(
    next.commits.length >= n &&
    next.commits[0] === prev.commits[0] &&
    next.commits[n - 1] === prev.commits[n - 1]
  );
}

/** Un commit à faire apparaître. */
export interface Fresh {
  oid: string;
  /**
   * Le commit prend la place du cercle « modifications en cours » : même
   * rangée (la première), même colonne, et le cercle n'est plus là. C'est le
   * commit qu'on vient de faire — le cercle se remplit au lieu d'apparaître.
   */
  morph: boolean;
}

/**
 * Commits du nouvel affichage absents du précédent, de haut en bas.
 *
 * Rien à animer quand l'onglet a changé (c'est un autre historique, pas du
 * nouveau), au premier affichage, ni quand une page s'est ajoutée au bout :
 * le défilement infini garde les objets de la page déjà là, et c'est à ça
 * qu'on le reconnaît — le premier et le dernier commit connus sont les mêmes
 * objets, aux mêmes places. Un rechargement, lui, en crée de nouveaux.
 */
export function freshCommits(prev: Seen | null, next: Seen, layout: GraphLayout): Fresh[] {
  if (!reloaded(prev, next)) return [];
  const out: Fresh[] = [];
  layout.rows.forEach((row, index) => {
    if (row.kind !== "commit" || prev.oids.has(row.commit.oid)) return;
    const morph =
      index === 0 && next.wipLane === null && prev.wipLane !== null && prev.wipLane === row.lane;
    out.push({ oid: row.commit.oid, morph });
  });
  return out;
}

// ── Références distantes déplacées ───────────────────────────────────────────

/**
 * Une branche distante qui a changé de commit — un push l'amène sur le commit
 * local qu'on vient de publier, un fetch sur ce qu'il a téléchargé. `from` est
 * le commit d'où elle part, `null` quand elle n'existait pas (premier push) ou
 * que son ancien commit n'est plus affiché (push forcé) : elle apparaît alors
 * sur place au lieu de glisser.
 */
export interface RefMove {
  name: string;
  from: string | null;
  to: string;
}

function remoteRefs(commits: GraphCommit[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const c of commits) {
    for (const r of c.refs) if (r.kind === "remoteBranch") out.set(r.name, c.oid);
  }
  return out;
}

/** Branches distantes arrivées sur un autre commit depuis l'affichage précédent. */
export function movedRemoteRefs(prev: Seen | null, next: Seen): RefMove[] {
  if (!reloaded(prev, next)) return [];
  const before = remoteRefs(prev.commits);
  const out: RefMove[] = [];
  for (const [name, to] of remoteRefs(next.commits)) {
    const was = before.get(name);
    if (was === to) continue;
    const from = was !== undefined && next.oids.has(was) ? was : null;
    out.push({ name, from, to });
  }
  return out;
}

// ── Branches locales nouvelles ───────────────────────────────────────────────

/** Une branche locale qui n'existait pas, et le commit où elle naît. */
export interface NewBranch {
  name: string;
  at: string;
}

function localRefs(commits: GraphCommit[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const c of commits) {
    // La branche courante arrive en `head`, les autres en `localBranch`.
    for (const r of c.refs) if (r.kind === "localBranch" || r.kind === "head") out.set(r.name, c.oid);
  }
  return out;
}

/**
 * Branches locales apparues depuis l'affichage précédent : créées depuis
 * l'application (barre, menus, Git Flow, branche distante extraite) ou
 * depuis un terminal.
 */
export function newLocalBranches(prev: Seen | null, next: Seen): NewBranch[] {
  if (!reloaded(prev, next)) return [];
  const before = localRefs(prev.commits);
  const out: NewBranch[] = [];
  for (const [name, at] of localRefs(next.commits)) {
    if (!before.has(name)) out.push({ name, at });
  }
  return out;
}

// ── Lignes nouvelles ─────────────────────────────────────────────────────────

/**
 * Ligne qu'un commit nouveau tire vers l'un de ses parents. Les positions sont
 * en rangées, depuis le haut du graph : `r + 0.5` est le milieu de la rangée
 * `r`, là où est son point.
 */
export interface Trail {
  /** Commit d'où part la ligne, en haut. */
  child: string;
  /** Milieu de la rangée de `child`. */
  top: number;
  /**
   * Bas de la ligne : le milieu de la rangée du parent, ou le bas de la
   * rangée de `child` quand la ligne rejoint une colonne déjà tracée (un
   * autre enfant du même parent l'a ouverte avant lui), ou le bas de la
   * dernière rangée chargée quand le parent est au-delà.
   */
  bottom: number;
  /** Le parent, s'il est nouveau lui aussi : la ligne attend que son point soit là. */
  from: string | null;
}

export interface Trails {
  list: Trail[];
  /**
   * Segments appartenant à une ligne nouvelle : rangée (par l'oid de son
   * commit) → index du segment dans `edges` → index de la ligne dans `list`.
   * Par oid plutôt que par index de rangée : si l'affichage est recalculé en
   * pleine animation (la rangée WIP qui apparaît), les rangées se décalent
   * mais restent les mêmes.
   */
  byRow: Map<string, Map<number, number>>;
}

/**
 * Les lignes que tirent les commits `fresh`, segment par segment.
 *
 * Une ligne part du point du commit (son segment `out`) et suit la colonne
 * qu'il ouvre jusqu'au parent qui l'attend (son segment `in`). Elle s'arrête
 * tout de suite quand cette colonne était déjà tracée au-dessus de lui :
 * `layoutGraph` fait alors rejoindre au commit une colonne qui attendait déjà
 * le même parent, et ce qui est en dessous existait avant lui.
 */
export function trailsOf(layout: GraphLayout, fresh: Set<string>): Trails {
  const list: Trail[] = [];
  const byRow = new Map<string, Map<number, number>>();
  const mark = (row: number, edge: number, trail: number) => {
    const r = layout.rows[row];
    if (r.kind !== "commit") return;
    let edges = byRow.get(r.commit.oid);
    if (!edges) byRow.set(r.commit.oid, (edges = new Map()));
    edges.set(edge, trail);
  };

  layout.rows.forEach((row, r) => {
    if (row.kind !== "commit" || !fresh.has(row.commit.oid)) return;
    row.edges.forEach((edge, ei) => {
      if (edge.kind !== "out" || edge.fromLane !== row.lane) return;
      const lane = edge.toLane;
      const trail: Trail = { child: row.commit.oid, top: r + 0.5, bottom: r + 1, from: null };
      const index = list.push(trail) - 1;
      mark(r, ei, index);
      const joins =
        lane !== row.lane &&
        row.edges.some((e) => e.kind === "through" && e.fromLane === lane && !e.ghost);
      if (joins) return;
      for (let k = r + 1; k < layout.rows.length; k++) {
        const below = layout.rows[k];
        const i = below.edges.findIndex(
          (e) => (e.kind === "through" || e.kind === "in") && e.fromLane === lane && !e.ghost,
        );
        if (i === -1) return;
        mark(k, i, index);
        if (below.edges[i].kind === "in") {
          trail.bottom = k + 0.5;
          if (below.kind === "commit" && fresh.has(below.commit.oid)) trail.from = below.commit.oid;
          return;
        }
        trail.bottom = k + 1;
      }
    });
  });
  return { list, byRow };
}

// ── Minutage ─────────────────────────────────────────────────────────────────

/**
 * Une rangée de ligne qui monte, en ms. Linéaire : la ligne monte à vitesse
 * constante, sans à-coup d'une rangée à l'autre.
 */
export const LINE_MS = 180;
/**
 * Montée la plus longue tolérée : au-delà, toutes les lignes accélèrent
 * d'autant. Un gros fetch ne traîne pas, un petit garde sa vitesse.
 */
export const MAX_CLIMB_MS = 1400;
/** Le point grossit en se dévoilant, avec un rebond à peine visible. */
export const DOT_MS = 520;
/** Le cercle « modifications en cours » qui se remplit. */
export const MORPH_MS = 750;
/** Une branche distante qui glisse de son ancien commit vers le nouveau. */
export const SLIDE_MS = 650;
/** Son icône, ou sa pastille, qui se pose à l'arrivée. */
export const LAND_MS = 380;
/** La pastille d'une branche nouvelle qui monte à sa place. */
export const RISE_MS = 480;
/** L'onde qui part du point d'où naît une branche. */
export const PULSE_MS = 700;

/**
 * L'onde, `t` ms après son départ : `radius`, de combien elle s'est élargie
 * au-delà du point (0 → 1, à l'échelle de l'appelant) ; `alpha`, son
 * opacité, qui s'éteint en même temps.
 */
export function pulseProgress(t: number): { radius: number; alpha: number } {
  if (t < 0 || t >= PULSE_MS) return { radius: 0, alpha: 0 };
  const p = t / PULSE_MS;
  return { radius: easeOutCubic(p), alpha: 1 - p };
}
/**
 * La place des rangées nouvelles s'ouvre : ce qui est dessous glisse vers le
 * bas au lieu d'y sauter, et les lignes qui la traversent s'étirent.
 */
export const OPEN_MS = 380;
/**
 * Les lignes commencent à monter quand la place est presque ouverte (à ~97 %
 * de sa hauteur) : plus tôt, elles seraient dessinées dans une rangée encore
 * écrasée.
 */
export const OPEN_LEAD_MS = Math.round(OPEN_MS * 0.8);

export interface Climb {
  /** Arrivée des lignes sur le point de chaque commit, en ms depuis le début de la montée. */
  arrive: Map<string, number>;
  /** Durée d'une rangée de montée, accélérée au besoin. */
  msPerRow: number;
}

/**
 * Quand chaque commit nouveau voit ses lignes arriver : la plus longue de ses
 * montées, chacune partant du point de son parent — tout de suite s'il était
 * déjà là, à son arrivée s'il est nouveau aussi. Ses lignes partent ensuite
 * chacune à temps pour arriver ensemble, et son point apparaît à ce moment-là.
 */
export function climb(layout: GraphLayout, fresh: Set<string>, trails: Trails): Climb {
  const byChild = new Map<string, Trail[]>();
  for (const t of trails.list) {
    const own = byChild.get(t.child);
    if (own) own.push(t);
    else byChild.set(t.child, [t]);
  }
  const arrive = new Map<string, number>();
  // De bas en haut : un parent passe avant ses enfants.
  for (let r = layout.rows.length - 1; r >= 0; r--) {
    const row = layout.rows[r];
    if (row.kind !== "commit" || !fresh.has(row.commit.oid)) continue;
    let at = 0;
    for (const t of byChild.get(row.commit.oid) ?? []) {
      const ready = t.from !== null ? (arrive.get(t.from) ?? 0) : 0;
      at = Math.max(at, ready + (t.bottom - t.top) * LINE_MS);
    }
    arrive.set(row.commit.oid, at);
  }
  const longest = Math.max(0, ...arrive.values());
  const factor = longest > MAX_CLIMB_MS ? MAX_CLIMB_MS / longest : 1;
  if (factor < 1) for (const [oid, at] of arrive) arrive.set(oid, at * factor);
  return { arrive, msPerRow: LINE_MS * factor };
}

/**
 * Où est le bout d'une ligne qui monte, en rangées depuis le haut : `bottom`
 * avant son départ, `top` une fois arrivée. `elapsed` compte depuis l'arrivée
 * prévue sur le point du commit (négatif avant) : la ligne part à temps pour
 * y être, à `msPerRow` par rangée.
 */
export function trailFront(trail: Trail, elapsed: number, msPerRow: number): number {
  const length = trail.bottom - trail.top;
  const done = Math.min(length, Math.max(0, length + elapsed / msPerRow));
  return trail.bottom - done;
}

/** Durée d'une animation, depuis l'arrivée (ou le départ, pour le cercle WIP). */
export function durationOf(morph: boolean): number {
  return morph ? MORPH_MS : DOT_MS;
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
 * Point d'un commit, `t` ms après l'arrivée de ses lignes : `dot`, son échelle
 * (peut dépasser 1, c'est le rebond) ; `alpha`, son opacité. Il part d'un
 * tiers de sa taille — grossir depuis rien le faisait jaillir — et se dévoile
 * sur la première moitié de sa course.
 */
export function dotProgress(t: number): { dot: number; alpha: number } {
  if (t <= 0) return { dot: 0, alpha: 0 };
  return { dot: 0.35 + 0.65 * easeOutBack(t / DOT_MS), alpha: easeOutCubic((t / DOT_MS) * 2) };
}

/**
 * Le cercle WIP qui se remplit, `t` ms après le départ : `reveal`, la part du
 * trait plein qui a monté du parent ; `dot`, le disque qui grandit en suivant.
 */
export function morphProgress(t: number): { reveal: number; dot: number } {
  return {
    reveal: easeInOutCubic(t / (MORPH_MS * 0.6)),
    dot: easeInOutCubic((t - MORPH_MS * 0.3) / (MORPH_MS * 0.7)),
  };
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
