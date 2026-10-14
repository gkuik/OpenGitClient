// Barre du dépôt personnalisable : l'état, sa persistance, et le glissement de
// l'écran de personnalisation.
//
// Préférence globale, persistée dans `prefs.json` comme la disposition du
// graph. Tout ce qui se calcule est dans `toolbar.ts`, pur et testé.
//
// Le glissement vit ici, en rune de module, pour la raison de
// `branchMerge.svelte.ts` : le geste traverse deux composants — il part de la
// palette (`ToolbarCustomizer`) ou de la barre (`RepoBar`) et se termine sur la
// barre —, et rien de ce qu'il porte ne survit au relâchement du bouton.

import { api } from "./api";
import { t } from "./i18n.svelte";
import {
  DEFAULT_TOOLBAR,
  insertItem,
  insertionIndex,
  moveItem,
  normalizeToolbar,
  removeAt,
  type ToolbarItem,
} from "./toolbar";

/** Libellé d'un élément : celui de son bouton, ou le nom de l'élément de mise en page. */
export function itemLabel(item: ToolbarItem): string {
  switch (item) {
    case "pull":
      return t("toolbar.pull");
    case "push":
      return t("toolbar.push");
    case "fetch":
      return t("toolbar.fetch");
    case "branch":
      return t("toolbar.branch");
    case "stash":
      return t("toolbar.stash");
    case "pop":
      return t("toolbar.pop");
    case "tag":
      return t("toolbar.tag");
    case "stage-all":
      return t("toolbar.stageAll");
    case "unstage-all":
      return t("toolbar.unstageAll");
    case "discard-all":
      return t("toolbar.discardAll");
    case "forge":
      return t("toolbar.forge");
    case "finder":
      return t("toolbar.finder");
    case "terminal":
      return t("toolbar.terminal");
    case "editor":
      return t("toolbar.editor");
    case "gitflow":
      return t("flow.menu");
    case "separator":
      return t("toolbar.separator");
    case "space":
      return t("toolbar.space");
  }
}

/** D'où part un glissement. */
export type DragSource =
  | { kind: "palette"; item: ToolbarItem }
  | { kind: "bar"; index: number }
  /** La barre par défaut, tirée d'un bloc : elle remplace la barre entière. */
  | { kind: "default" };

/** Distance avant qu'un appui devienne un glissement — celle des branches. */
const DRAG_THRESHOLD = 4;
/**
 * Marge verticale autour de la barre où le curseur compte encore comme « dans
 * la barre ». Sans elle, un dépôt lâché un peu trop bas — la palette est juste
 * dessous — passerait pour un retrait.
 */
const BAR_SLACK = 14;

/** Glissement affiché : l'étiquette qui suit le curseur et la marque de dépôt. */
export type ToolbarDrag = {
  source: DragSource;
  /** Coin haut-gauche de l'étiquette, en coordonnées fenêtre. */
  x: number;
  y: number;
  /** Le curseur est-il sur la barre ? Sinon, lâcher retire (ou ne fait rien). */
  over: boolean;
  /** Abscisse de la marque d'insertion, relative à la barre ; `null` : aucune. */
  marker: number | null;
};

class ToolbarStore {
  items = $state<ToolbarItem[]>([...DEFAULT_TOOLBAR]);
  /** L'écran de personnalisation est-il ouvert ? */
  editing = $state(false);
  /** Glissement en cours, une fois le seuil franchi. */
  drag = $state<ToolbarDrag | null>(null);

  /**
   * Geste en cours, avant et après le seuil. La géométrie est mesurée une fois,
   * au `pointerdown` — la règle de la barre d'onglets : rien ne bouge pendant
   * le glissement, la relire à chaque mouvement ne servirait qu'à forcer un
   * recalcul de mise en page par image.
   */
  private gesture: {
    source: DragSource;
    node: HTMLElement;
    pointerId: number;
    x0: number;
    y0: number;
    /** Point saisi dans l'élément, pour que l'étiquette ne saute pas sous le curseur. */
    offX: number;
    offY: number;
    bar: DOMRect;
    /** Milieux des éléments de la barre, et les bords qui placent la marque. */
    mids: number[];
    slots: DOMRect[];
    /** Zone des actions : là où va la marque quand la barre est vide. */
    zone: DOMRect | null;
    index: number;
  } | null = null;

  /** Un vrai glissement vient de finir : le `click` qui suit n'en est pas un. */
  private dropped = false;

  /** Charge la préférence ; jusque-là, la barre par défaut. */
  init() {
    api
      .getToolbar()
      .then((raw) => {
        this.items = normalizeToolbar(raw);
      })
      .catch(() => {
        /* préférence illisible : barre par défaut */
      });
  }

  startEditing() {
    this.editing = true;
  }

  stopEditing() {
    this.stopDrag();
    this.editing = false;
  }

  /** Ajoute en fin de barre — le clic (ou Entrée) sur un élément de la palette. */
  append(item: ToolbarItem) {
    this.save(insertItem(this.items, item, this.items.length));
  }

  remove(index: number) {
    this.save(removeAt(this.items, index));
  }

  /** Remet la barre par défaut — et l'oubli de la personnalisation avec. */
  reset() {
    this.items = [...DEFAULT_TOOLBAR];
    api.setToolbar(null).catch(() => {
      /* non enregistré : la barre tient pour la session */
    });
  }

  /**
   * Le glissement vient-il de se terminer ? Répond une fois : le drapeau est
   * consommé, pour qu'un clic ultérieur ne soit pas avalé à son tour.
   */
  consumeClick(): boolean {
    const dropped = this.dropped;
    this.dropped = false;
    return dropped;
  }

  /**
   * Prend un élément — de la palette, de la barre, ou la barre par défaut. Le
   * bouton principal seulement. Rien n'est `preventDefault` : tout ce qui se
   * glisse est déjà en `user-select: none`, et l'élément garde son focus.
   */
  startDrag(e: PointerEvent, source: DragSource, bar: HTMLElement | null) {
    if (e.button !== 0 || !bar) return;
    this.dropped = false;
    const node = e.currentTarget as HTMLElement;
    const rect = node.getBoundingClientRect();
    const slots = [...bar.querySelectorAll<HTMLElement>("[data-tb-index]")].map((el) =>
      el.getBoundingClientRect(),
    );
    this.gesture = {
      source,
      node,
      pointerId: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      offX: e.clientX - rect.left,
      offY: e.clientY - rect.top,
      bar: bar.getBoundingClientRect(),
      mids: slots.map((r) => r.left + r.width / 2),
      slots,
      zone: bar.querySelector(".actions")?.getBoundingClientRect() ?? null,
      index: 0,
    };
    // La capture garantit `pointerup` sur cet élément, y compris relâché hors
    // de la fenêtre — c'est elle qui permet de « jeter » un élément au loin.
    node.setPointerCapture(e.pointerId);
    node.addEventListener("pointermove", this.onMove);
    node.addEventListener("pointerup", this.onUp);
    node.addEventListener("pointercancel", this.onCancel);
    window.addEventListener("keydown", this.onKey);
  }

  private onMove = (e: PointerEvent) => {
    const g = this.gesture;
    if (!g || e.pointerId !== g.pointerId) return;
    if (!this.drag) {
      const far =
        Math.abs(e.clientX - g.x0) > DRAG_THRESHOLD ||
        Math.abs(e.clientY - g.y0) > DRAG_THRESHOLD;
      if (!far) return;
    }
    const over = e.clientY >= g.bar.top - BAR_SLACK && e.clientY <= g.bar.bottom + BAR_SLACK;
    g.index = insertionIndex(g.mids, e.clientX);
    this.drag = {
      source: g.source,
      x: e.clientX - g.offX,
      y: e.clientY - g.offY,
      over,
      marker: over ? this.markerAt(g.index) : null,
    };
  };

  /**
   * Où tracer la marque d'insertion, relativement à la barre. Aucune pour la
   * barre par défaut — elle remplace tout, c'est la zone entière qui s'allume —
   * ni pour un élément qui retomberait à sa place.
   */
  private markerAt(index: number): number | null {
    const g = this.gesture;
    if (!g || g.source.kind === "default") return null;
    if (g.source.kind === "bar" && (index === g.source.index || index === g.source.index + 1)) {
      return null;
    }
    const { slots, bar } = g;
    if (slots.length === 0) return g.zone ? g.zone.left + g.zone.width / 2 - bar.left : null;
    const x =
      index === 0
        ? slots[0].left - 3
        : index === slots.length
          ? slots[slots.length - 1].right + 3
          : (slots[index - 1].right + slots[index].left) / 2;
    return x - bar.left;
  }

  private onUp = (e: PointerEvent) => {
    const g = this.gesture;
    if (!g || e.pointerId !== g.pointerId) return;
    const drag = this.drag;
    this.dropped = drag !== null;
    this.stopDrag();
    if (!drag) return;

    const { source } = g;
    if (!drag.over) {
      // Hors de la barre : un élément de la barre en est retiré ; ce qui venait
      // de la palette n'y était pas, il n'y a rien à faire.
      if (source.kind === "bar") this.remove(source.index);
      return;
    }
    if (source.kind === "default") this.reset();
    else if (source.kind === "palette") this.save(insertItem(this.items, source.item, g.index));
    else this.save(moveItem(this.items, source.index, g.index));
  };

  private onCancel = (e: PointerEvent) => {
    if (this.gesture && e.pointerId !== this.gesture.pointerId) return;
    this.dropped = this.drag !== null;
    this.stopDrag();
  };

  /** Échap abandonne le glissement en cours sans rien changer. */
  private onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    this.dropped = this.drag !== null;
    this.stopDrag();
  };

  /** Rend la capture et remet le geste à zéro. */
  private stopDrag() {
    const g = this.gesture;
    this.gesture = null;
    this.drag = null;
    window.removeEventListener("keydown", this.onKey);
    if (!g) return;
    g.node.removeEventListener("pointermove", this.onMove);
    g.node.removeEventListener("pointerup", this.onUp);
    g.node.removeEventListener("pointercancel", this.onCancel);
    if (g.node.hasPointerCapture(g.pointerId)) g.node.releasePointerCapture(g.pointerId);
  }

  /** Applique et persiste. Pas de différé : un dépôt est un geste, pas un flot. */
  private save(next: ToolbarItem[]) {
    this.items = next;
    api.setToolbar(next).catch(() => {
      /* non enregistré : la barre tient pour la session */
    });
  }
}

export const toolbar = new ToolbarStore();
