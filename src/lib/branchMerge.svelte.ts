/**
 * Glisser-déposer d'une branche locale sur une autre, et la demande de fusion
 * qui en sort — le clic droit sur une branche alimente la même demande.
 *
 * **L'état vit dans un module, pas dans un composant**, parce que le geste
 * concerne *deux* lignes à la fois — celle qu'on tient, celle qu'on survole — et
 * que ces lignes naissent d'une récursion (`BranchRow` s'appelle lui-même) : le
 * passer en props le ferait descendre tout l'arbre pour deux valeurs dont une
 * seule ligne se sert à un instant donné. Il n'a pas sa place dans `RepoStore`
 * non plus : rien là-dedans n'est un état du dépôt, et le geste ne survit pas au
 * relâchement du bouton.
 *
 * **Pointer events, comme la barre d'onglets**, et pour les mêmes raisons :
 * aucune image fantôme imposée par le navigateur, aucun `DataTransfer` à nourrir
 * pour un déplacement purement interne, et la capture garantit le relâchement
 * même en dehors de la fenêtre.
 */

/** Fusion demandée, en attente de confirmation dans le menu contextuel. */
export interface MergeRequest {
  /** Branche fusionnée : celle qu'on a déposée, ou la branche courante. */
  source: string;
  /** Branche qui reçoit : celle sur laquelle on a déposé, ou celle cliquée. */
  target: string;
  /** Où ouvrir le menu, en coordonnées fenêtre. */
  x: number;
  y: number;
  /**
   * Née d'un dépôt plutôt que d'un clic droit. Le menu ne propose alors que
   * la fusion : un dépôt est un geste de fusion, là où le clic droit est le
   * menu de la branche, qui porte aussi son pull.
   */
  fromDrop: boolean;
}

/**
 * Distance à parcourir avant qu'un appui devienne un glissement. Sans ce seuil,
 * le moindre tremblement de main transformerait un clic — qui sélectionne le
 * dernier commit de la branche — en dépôt sur la ligne du dessous.
 */
const DRAG_THRESHOLD = 4;

class BranchMerge {
  /** Branche tenue par le curseur, une fois le seuil franchi. */
  dragging = $state<string | null>(null);
  /** Branche survolée et déposable ; jamais la branche tenue. */
  over = $state<string | null>(null);
  /** Position du curseur, pour l'étiquette qui le suit. */
  x = $state(0);
  y = $state(0);
  /** Fusion demandée : non nul = le menu est ouvert. */
  request = $state<MergeRequest | null>(null);

  /** Geste en cours, avant et après le seuil. Pas de rune : rien ne l'affiche. */
  private gesture: {
    source: string;
    node: HTMLElement;
    pointerId: number;
    x0: number;
    y0: number;
  } | null = null;

  /**
   * Un vrai glissement vient de se terminer. Le `click` qui suit le
   * relâchement viserait la ligne de départ et sélectionnerait son commit :
   * `BranchRow` le consomme au lieu de le traiter.
   */
  private dropped = false;

  /**
   * Prend une branche locale. Le bouton principal seulement : le clic droit
   * ouvre le menu, et les boutons du milieu n'ont rien à faire ici.
   */
  startDrag(source: string, e: PointerEvent) {
    if (e.button !== 0) return;
    this.dropped = false;
    const node = e.currentTarget as HTMLElement;
    this.gesture = { source, node, pointerId: e.pointerId, x0: e.clientX, y0: e.clientY };

    // La capture garantit `pointermove`/`pointerup` sur cette ligne, y compris
    // hors de la fenêtre. Rien n'est `preventDefault` : la section porte déjà
    // `user-select: none`, donc il n'y a pas de sélection de texte à tuer, et le
    // focus natif de la ligne est préservé.
    node.setPointerCapture(e.pointerId);
    node.addEventListener("pointermove", this.onMove);
    node.addEventListener("pointerup", this.onUp);
    node.addEventListener("pointercancel", this.onCancel);
    window.addEventListener("keydown", this.onKey);
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
   * Ouvre le menu d'une branche à cet endroit : dépôt d'une branche sur une
   * autre, ou clic droit. Une branche déposée sur elle-même n'a rien à
   * demander ; un clic droit sur la branche courante, si — son pull, la
   * fusion étant alors retirée du menu.
   */
  ask(source: string, target: string, x: number, y: number, fromDrop = false) {
    if (fromDrop && source === target) return;
    this.request = { source, target, x, y, fromDrop };
  }

  /** Ferme le menu sans rien fusionner. */
  close() {
    this.request = null;
  }

  private onMove = (e: PointerEvent) => {
    const g = this.gesture;
    if (!g || e.pointerId !== g.pointerId) return;
    this.x = e.clientX;
    this.y = e.clientY;

    if (!this.dragging) {
      const far =
        Math.abs(e.clientX - g.x0) > DRAG_THRESHOLD ||
        Math.abs(e.clientY - g.y0) > DRAG_THRESHOLD;
      if (!far) return;
      this.dragging = g.source;
    }
    this.over = this.targetAt(e.clientX, e.clientY, g.source);
  };

  private onUp = (e: PointerEvent) => {
    const g = this.gesture;
    if (!g || e.pointerId !== g.pointerId) return;
    const source = g.source;
    const target = this.dragging ? this.targetAt(e.clientX, e.clientY, source) : null;
    // Un vrai glissement, même sans cible : le clic qui suit n'en est pas un.
    this.dropped = this.dragging !== null;
    this.stop();
    if (target) this.ask(source, target, e.clientX, e.clientY, true);
  };

  private onCancel = (e: PointerEvent) => {
    if (this.gesture && e.pointerId !== this.gesture.pointerId) return;
    this.dropped = this.dragging !== null;
    this.stop();
  };

  /** Échap abandonne le glissement en cours, sans rien demander. */
  private onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    this.dropped = this.dragging !== null;
    this.stop();
  };

  /** Rend la capture et remet le geste à zéro. */
  private stop() {
    const g = this.gesture;
    this.gesture = null;
    this.dragging = null;
    this.over = null;
    window.removeEventListener("keydown", this.onKey);
    if (!g) return;
    g.node.removeEventListener("pointermove", this.onMove);
    g.node.removeEventListener("pointerup", this.onUp);
    g.node.removeEventListener("pointercancel", this.onCancel);
    if (g.node.hasPointerCapture(g.pointerId)) g.node.releasePointerCapture(g.pointerId);
  }

  /**
   * Branche déposable sous le curseur. Le point est interrogé au DOM plutôt que
   * comparé à des rectangles mesurés d'avance : la liste défile, se plie et se
   * déplie, et `data-branch` est le seul repère qui suit ces mouvements sans
   * qu'on ait à les observer. L'étiquette qui suit le curseur est
   * `pointer-events: none`, sinon elle se ferait interroger à la place.
   */
  private targetAt(x: number, y: number, source: string): string | null {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-branch]");
    const name = el?.dataset.branch;
    return name && name !== source ? name : null;
  }
}

export const branchMerge = new BranchMerge();
