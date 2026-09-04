// Largeurs des deux colonnes latérales : le choix de l'utilisateur, et sa mise
// à l'échelle.
//
// Même contrat que `font.svelte.ts` : le module n'écrit que deux variables CSS
// sur `<html>`, aucun composant n'a rien à lire ici. La grille de `App.svelte`
// s'en sert pour ses colonnes, les poignées pour se placer sur la frontière.
//
// Les largeurs sont en **rem**, pas en pixels, alors même que le geste qui les
// règle se mesure en pixels : toutes les longueurs de l'interface étant
// relatives à la racine, une largeur figée tronquerait les noms de branches dès
// qu'on grossit le texte. La conversion se fait ici, une fois, contre
// `font.rootPx`.

import { api } from "./api";
import { font } from "./font.svelte";

/** Largeur d'origine des deux colonnes — celle qui vit aussi dans `app.css`. */
export const SIDEBAR_W_DEFAULT = 18.9;
/** Bornes, en rem. Doivent rester celles de `SIDEBAR_W_MIN` / `_MAX`
 *  (`src-tauri/src/dto.rs`), qui ramènent de toute façon dans l'intervalle ce
 *  qui en sort. */
export const SIDEBAR_W_MIN = 12;
export const SIDEBAR_W_MAX = 40;

/**
 * Ce qu'on refuse de prendre au centre, en pixels. Les bornes en rem ne
 * suffisent pas : sur une fenêtre étroite, deux colonnes légitimes suffiraient
 * à écraser le graph et le diff, qui n'ont pas de largeur minimale à eux.
 */
const CENTER_MIN_PX = 320;

/** Délai avant écriture de `prefs.json` : un glissement émet un événement par
 *  image, on n'en persiste que le résultat. */
const SAVE_DELAY_MS = 300;

export type Side = "left" | "right";

class LayoutStore {
  /** Largeurs appliquées, en rem. */
  left = $state(SIDEBAR_W_DEFAULT);
  right = $state(SIDEBAR_W_DEFAULT);

  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Charge la préférence.
   *
   * Comme la taille du texte, rien n'est appliqué avant sa lecture : le défaut
   * vit déjà dans `app.css`, et l'écraser par la même valeur n'ajouterait qu'un
   * rendu. Une largeur autre que le défaut se met donc en place un aller-retour
   * après le premier rendu — et le navigateur, où il n'y a pas de backend pour
   * répondre, garde simplement celui de la feuille de style.
   */
  init() {
    api
      .getSidebarWidths()
      .then(({ left, right }) => {
        this.left = left;
        this.right = right;
        this.apply();
      })
      .catch(() => {
        /* préférence illisible : on reste sur le défaut de la feuille de style */
      });
  }

  /** Largeur courante d'un côté, en pixels — le repère du geste. */
  px(side: Side): number {
    return (side === "left" ? this.left : this.right) * font.rootPx;
  }

  /**
   * Pose une largeur mesurée en pixels. `availablePx` est la largeur du corps,
   * mesurée une fois au début du geste : c'est elle qui décide de ce qui reste
   * au centre.
   */
  setPx(side: Side, px: number, availablePx: number) {
    const root = font.rootPx;
    const min = SIDEBAR_W_MIN * root;
    const other = this.px(side === "left" ? "right" : "left");
    // `Math.max` garde la borne haute au-dessus de la basse : sur une fenêtre
    // trop étroite pour les trois colonnes, c'est le centre qui cède, pas le
    // réglage qui devient inopérant.
    const max = Math.max(min, Math.min(SIDEBAR_W_MAX * root, availablePx - other - CENTER_MIN_PX));
    this.set(side, Math.min(Math.max(px, min), max) / root);
  }

  /**
   * Décale une largeur de `deltaRem` (flèches du clavier), dans les mêmes
   * bornes que le glissement.
   */
  nudge(side: Side, deltaRem: number, availablePx: number) {
    this.setPx(side, this.px(side) + deltaRem * font.rootPx, availablePx);
  }

  private set(side: Side, rem: number) {
    if (side === "left") this.left = rem;
    else this.right = rem;
    this.apply();
    this.scheduleSave();
  }

  private apply() {
    const root = document.documentElement;
    root.style.setProperty("--sidebar-l-w", `${this.left}rem`);
    root.style.setProperty("--sidebar-r-w", `${this.right}rem`);
  }

  /**
   * L'interface suit tout de suite, la persistance ensuite : un échec
   * d'écriture ne coûte que la survie du réglage au prochain démarrage.
   */
  private scheduleSave() {
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      api
        .setSidebarWidths({ left: this.left, right: this.right })
        .catch(() => {
          /* préférence non enregistrée : les largeurs tiennent pour la session */
        });
    }, SAVE_DELAY_MS);
  }
}

export const layout = new LayoutStore();
