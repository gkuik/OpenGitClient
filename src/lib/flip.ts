// Lignes de fichiers qui glissent à leur nouvelle place — stage, unstage,
// « Stage all », un fichier qui apparaît ou disparaît du working directory.
//
// La technique est FLIP (*First, Last, Invert, Play*) : on mesure chaque ligne
// avant que le statut ne change, on laisse Svelte refaire la liste, puis on
// fait partir chaque ligne de sa place d'avant vers la nouvelle. Rien ne sait
// quelle action a eu lieu, comme pour le graph : on compare deux états, et
// ce qui a bougé glisse.
//
// Pas de `crossfade` de Svelte, et c'est délibéré : en vue Tree les lignes
// naissent d'une récursion (`TreeRow` autour de `FileItem`), où une transition
// locale ne joue pas, et sa ligne sortante garde sa place jusqu'à la fin —
// le trou se refermerait d'un coup. Ici, toute la colonne bouge d'un seul
// geste, voisines comprises.
//
// L'appariement est pur et testé ; la mesure et l'animation touchent le DOM.

/** Une ligne mesurée : son identité, sa section, sa place à l'écran. */
export interface RowBox {
  /** `f:<chemin>` pour un fichier, `d:<chemin>` pour un dossier (vue Tree). */
  key: string;
  /** `u` (non indexés) ou `s` (indexés). */
  section: string;
  left: number;
  top: number;
}

/** D'où part une ligne de l'affichage nouveau. */
export type RowMove =
  /** Elle était là : elle glisse depuis sa place d'avant. `crossed` : elle
   * vient de l'autre section — c'est le fichier qu'on vient d'indexer ou de
   * désindexer, il mérite d'être signalé à son arrivée. */
  | { kind: "move"; dx: number; dy: number; crossed: boolean }
  /** Elle n'était nulle part : elle apparaît en fondu. */
  | { kind: "enter" };

/**
 * Apparie les lignes d'après à celles d'avant, une à une et dans l'ordre :
 * d'abord **même chemin, même section** — un fichier peut être dans les deux
 * à la fois, en partie indexé, et chacune de ses lignes reste la sienne —, puis
 * même chemin dans l'autre section, ce qui n'a pas encore été pris. Un fichier
 * qui passe d'une section à l'autre est donc reconnu comme le même, et glisse
 * de l'une à l'autre.
 */
export function matchRows(before: RowBox[], after: RowBox[]): RowMove[] {
  const pool = new Map<string, RowBox[]>();
  for (const b of before) {
    const list = pool.get(b.key);
    if (list) list.push(b);
    else pool.set(b.key, [b]);
  }
  const take = (key: string, pick: (b: RowBox) => boolean): RowBox | null => {
    const list = pool.get(key);
    const i = list?.findIndex(pick) ?? -1;
    return i === -1 ? null : list!.splice(i, 1)[0];
  };

  // Premier passage : chacun retrouve sa propre ligne. Il doit être complet
  // avant le second, sinon une ligne restée dans sa section pourrait se voir
  // volée par la copie qui, elle, change de section.
  const same = after.map((a) => take(a.key, (b) => b.section === a.section));
  return after.map((a, i) => {
    const from = same[i] ?? take(a.key, () => true);
    if (!from) return { kind: "enter" };
    return {
      kind: "move",
      dx: from.left - a.left,
      dy: from.top - a.top,
      crossed: from.section !== a.section,
    };
  });
}

// ── DOM ─────────────────────────────────────────────────────────────────────

/** Les lignes portent `data-flip` (leur clé) et `data-flip-section`. */
const SELECTOR = "[data-flip]";

/** Au-delà, mesurer coûterait plus que l'effet ne rapporte : rien ne glisse. */
export const FLIP_MAX_ROWS = 400;
export const FLIP_MS = 220;
const ENTER_MS = 180;
const EASE = "cubic-bezier(0.2, 0, 0, 1)";

function rows(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(SELECTOR)];
}

function boxOf(el: HTMLElement): RowBox {
  const r = el.getBoundingClientRect();
  return {
    key: el.dataset.flip ?? "",
    section: el.dataset.flipSection ?? "",
    left: r.left,
    top: r.top,
  };
}

/** *First* : la place de chaque ligne, avant le changement. */
export function measureRows(root: HTMLElement): RowBox[] | null {
  const els = rows(root);
  return els.length > FLIP_MAX_ROWS ? null : els.map(boxOf);
}

/**
 * *Last, Invert, Play* : appelé une fois la liste refaite. Chaque ligne part
 * de sa place d'avant ; celle qui a changé de section reçoit en plus la classe
 * `flip-landed`, que la ligne anime elle-même (un fond qui s'éteint).
 */
export function playRows(root: HTMLElement, before: RowBox[]) {
  const els = rows(root);
  if (els.length > FLIP_MAX_ROWS) return;
  const moves = matchRows(before, els.map(boxOf));
  els.forEach((el, i) => {
    const m = moves[i];
    if (m.kind === "enter") {
      // Rien avant : tout un affichage neuf (première mesure vide) n'arrive
      // jamais ici, l'appelant ne joue que s'il avait des lignes.
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ENTER_MS, easing: "ease-out" });
      return;
    }
    if (Math.abs(m.dx) >= 0.5 || Math.abs(m.dy) >= 0.5) {
      el.animate(
        [{ transform: `translate(${m.dx}px, ${m.dy}px)` }, { transform: "none" }],
        { duration: FLIP_MS, easing: EASE },
      );
    }
    if (m.crossed) {
      el.classList.remove("flip-landed");
      // Relance l'animation CSS si la classe était encore là.
      void el.offsetWidth;
      el.classList.add("flip-landed");
      el.addEventListener("animationend", () => el.classList.remove("flip-landed"), {
        once: true,
      });
    }
  });
}
