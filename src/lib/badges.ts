// Badges de statut de fichier, partagés par le panneau de statut (working
// directory) et le détail de commit : la même information doit avoir partout la
// même lettre et la même couleur.

import type { FileStatus } from "./types";

export interface StatusBadge {
  label: string;
  /** Classe CSS de couleur, définie par le composant qui affiche le badge. */
  cls: string;
}

export const STATUS_BADGES: Record<FileStatus, StatusBadge> = {
  modified: { label: "M", cls: "mod" },
  added: { label: "A", cls: "add" },
  deleted: { label: "D", cls: "del" },
  renamed: { label: "R", cls: "ren" },
  typechange: { label: "T", cls: "mod" },
  conflicted: { label: "C", cls: "del" },
  // Un fichier non suivi est un fichier neuf, comme un fichier ajouté à
  // l'index : même lettre, même vert — les compteurs de dossiers les comptent
  // déjà ensemble sous « + ». Le « ? » de `git status` ne disait rien de plus
  // que l'absence du fichier dans l'index, ce que la section indique déjà.
  untracked: { label: "A", cls: "add" },
};
