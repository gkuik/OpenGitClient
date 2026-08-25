// Construction d'arborescences à partir de chemins séparés par "/".
//
// Deux usages, volontairement distincts car leurs règles diffèrent :
//  - `buildTree`       : fichiers modifiés (dossiers d'abord, avec compteurs agrégés) ;
//  - `buildBranchTree` : branches (tri purement alphabétique, sans compteurs).

import type { BranchEntry, FileEntry, FileStatus } from "./types";

export interface TreeCounts {
  added: number;
  modified: number;
  deleted: number;
}

export interface TreeFileNode {
  type: "file";
  name: string;
  entry: FileEntry;
}

export interface TreeDirNode {
  type: "dir";
  name: string;
  /** Chemin complet du dossier (clé d'expansion). */
  path: string;
  children: TreeNode[];
  counts: TreeCounts;
}

export type TreeNode = TreeFileNode | TreeDirNode;

function emptyCounts(): TreeCounts {
  return { added: 0, modified: 0, deleted: 0 };
}

function bump(counts: TreeCounts, status: FileStatus) {
  if (status === "added" || status === "untracked") counts.added++;
  else if (status === "deleted") counts.deleted++;
  else counts.modified++; // modified, renamed, typechange, conflicted
}

/** Ordonne dossiers avant fichiers, puis alphabétiquement (asc/desc). */
function sortNodes(nodes: TreeNode[], asc: boolean) {
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    const cmp = a.name.localeCompare(b.name);
    return asc ? cmp : -cmp;
  });
  for (const n of nodes) if (n.type === "dir") sortNodes(n.children, asc);
}

/** Transforme une liste plate de fichiers en arborescence de dossiers. */
export function buildTree(entries: FileEntry[], asc = true): TreeNode[] {
  const root: TreeDirNode = {
    type: "dir",
    name: "",
    path: "",
    children: [],
    counts: emptyCounts(),
  };
  const dirs = new Map<string, TreeDirNode>([["", root]]);

  for (const entry of entries) {
    const parts = entry.path.split("/");
    let parent = root;
    let cur = "";
    bump(parent.counts, entry.status);

    for (let i = 0; i < parts.length - 1; i++) {
      cur = cur ? `${cur}/${parts[i]}` : parts[i];
      let dir = dirs.get(cur);
      if (!dir) {
        dir = {
          type: "dir",
          name: parts[i],
          path: cur,
          children: [],
          counts: emptyCounts(),
        };
        dirs.set(cur, dir);
        parent.children.push(dir);
      }
      bump(dir.counts, entry.status);
      parent = dir;
    }

    parent.children.push({
      type: "file",
      name: parts[parts.length - 1],
      entry,
    });
  }

  sortNodes(root.children, asc);
  return root.children;
}

// ── Arborescence de branches ────────────────────────────────────────────────

export interface BranchLeafNode {
  type: "branch";
  /** Dernier segment du nom, pour l'affichage. */
  name: string;
  branch: BranchEntry;
}

export interface BranchDirNode {
  type: "dir";
  name: string;
  /** Préfixe complet ("feature"), clé de pliage. */
  path: string;
  children: BranchTreeNode[];
}

export type BranchTreeNode = BranchLeafNode | BranchDirNode;

/**
 * Regroupe les branches par préfixe ("feature/x" → dossier "feature").
 *
 * Contrairement à l'arbre de fichiers, dossiers et branches sont triés
 * ensemble par ordre alphabétique (dev, feature/, fix/, main, master,
 * release/…), comme GitKraken.
 */
export function buildBranchTree(branches: BranchEntry[]): BranchTreeNode[] {
  const root: BranchDirNode = { type: "dir", name: "", path: "", children: [] };
  const dirs = new Map<string, BranchDirNode>([["", root]]);

  for (const branch of branches) {
    const parts = branch.name.split("/");
    let parent = root;
    let cur = "";

    for (let i = 0; i < parts.length - 1; i++) {
      cur = cur ? `${cur}/${parts[i]}` : parts[i];
      let dir = dirs.get(cur);
      if (!dir) {
        dir = { type: "dir", name: parts[i], path: cur, children: [] };
        dirs.set(cur, dir);
        parent.children.push(dir);
      }
      parent = dir;
    }

    parent.children.push({
      type: "branch",
      name: parts[parts.length - 1],
      branch,
    });
  }

  sortBranchNodes(root.children);
  return root.children;
}

function sortBranchNodes(nodes: BranchTreeNode[]) {
  nodes.sort((a, b) => a.name.localeCompare(b.name));
  for (const n of nodes) if (n.type === "dir") sortBranchNodes(n.children);
}

/** Tous les chemins de dossiers présents (pour « Tout déplier »). */
export function allDirPaths(entries: FileEntry[]): string[] {
  const set = new Set<string>();
  for (const e of entries) {
    const parts = e.path.split("/");
    let cur = "";
    for (let i = 0; i < parts.length - 1; i++) {
      cur = cur ? `${cur}/${parts[i]}` : parts[i];
      set.add(cur);
    }
  }
  return [...set];
}
