/**
 * Menu contextuel d'un fichier ou d'un dossier du working directory — la
 * demande, pas le menu.
 *
 * **L'état vit dans un module, pas dans un composant**, pour la raison qui a
 * sorti la fusion de branches de `BranchRow` : les lignes de fichiers naissent
 * d'une récursion (`TreeRow` s'appelle lui-même autour de `FileItem`), et le
 * menu est rendu une fois pour la colonne, dans `StatusPanel`. Une prop
 * descendrait tout l'arbre pour une valeur dont une seule ligne se sert à la
 * fois. Il n'a pas sa place dans `RepoStore` non plus : un menu ouvert n'est
 * pas un état du dépôt, et il ne survit pas au clic qui le ferme.
 */

import type { FileEntry } from "./types";

/** Menu demandé sur une ligne : non nul = le menu est ouvert. */
export interface FileMenuRequest {
  /**
   * Ce sur quoi le menu porte : un fichier, ou tous ceux d'un dossier de
   * l'arbre — ceux que sa ligne compte, donc ceux de sa section.
   */
  entries: FileEntry[];
  /** Section d'origine de la ligne, ce qui distingue deux entrées d'un même chemin. */
  staged: boolean;
  /** Où ouvrir le menu, en coordonnées fenêtre. */
  x: number;
  y: number;
}

class FileMenu {
  request = $state<FileMenuRequest | null>(null);

  ask(entries: FileEntry[], staged: boolean, x: number, y: number) {
    if (entries.length === 0) return;
    this.request = { entries, staged, x, y };
  }

  close() {
    this.request = null;
  }
}

export const fileMenu = new FileMenu();
