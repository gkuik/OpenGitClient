// Construction d'arborescences à partir de chemins séparés par "/".
//
// Deux usages, volontairement distincts car leurs règles diffèrent :
//  - `buildTree`       : fichiers modifiés (dossiers d'abord, avec compteurs agrégés) ;
//  - `buildBranchTree` : branches (tri purement alphabétique, sans compteurs) ;
//  - `buildRemoteTree` : branches distantes, regroupées par distant.

import type { BranchEntry, FileEntry, FileStatus, RemoteBranchEntry } from "./types";

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

// Le nœud feuille est générique sur l'entrée qu'il porte : locale ou distante.
// Les deux se découpent de la même façon sur "/", seuls leurs champs diffèrent —
// et `BranchRow` distingue les deux à l'affichage.
export interface BranchLeafNode<T = BranchEntry> {
  type: "branch";
  /** Dernier segment du nom, pour l'affichage. */
  name: string;
  branch: T;
}

export interface BranchDirNode<T = BranchEntry> {
  type: "dir";
  name: string;
  /** Préfixe complet ("feature"), clé de pliage. */
  path: string;
  children: BranchTreeNode<T>[];
}

export type BranchTreeNode<T = BranchEntry> = BranchLeafNode<T> | BranchDirNode<T>;

/**
 * Regroupe les branches par préfixe ("feature/x" → dossier "feature").
 *
 * Contrairement à l'arbre de fichiers, dossiers et branches sont triés
 * ensemble par ordre alphabétique (dev, feature/, fix/, main, master,
 * release/…), comme GitKraken.
 */
export function buildBranchTree<T extends { name: string }>(
  branches: T[],
): BranchTreeNode<T>[] {
  const root: BranchDirNode<T> = { type: "dir", name: "", path: "", children: [] };
  const dirs = new Map<string, BranchDirNode<T>>([["", root]]);

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

function sortBranchNodes<T>(nodes: BranchTreeNode<T>[]) {
  nodes.sort((a, b) => a.name.localeCompare(b.name));
  for (const n of nodes) if (n.type === "dir") sortBranchNodes(n.children);
}

// ── Branches distantes ──────────────────────────────────────────────────────

/** Un distant et l'arborescence de ses branches. */
export interface RemoteGroup {
  /** Nom du distant ("origin"), tel que renvoyé par le backend. */
  remote: string;
  branches: RemoteBranchEntry[];
  /** Arborescence des branches, **sans** le préfixe du distant en tête. */
  nodes: BranchTreeNode<RemoteBranchEntry>[];
}

/**
 * Regroupe les branches distantes par distant, chacun avec son arborescence.
 *
 * Le regroupement suit le champ `remote` du backend plutôt qu'un découpage du
 * nom : un nom de distant peut contenir un "/". L'arbre, lui, est bâti sur le
 * nom **complet** puis on descend sous le nœud du distant — ainsi les chemins de
 * pliage gardent leur préfixe ("origin/feature") et ne peuvent pas entrer en
 * collision avec ceux de la section LOCAL, qui partagent le même jeu de clés.
 */
export function buildRemoteTree(branches: RemoteBranchEntry[]): RemoteGroup[] {
  const byRemote = new Map<string, RemoteBranchEntry[]>();
  for (const branch of branches) {
    const list = byRemote.get(branch.remote);
    if (list) list.push(branch);
    else byRemote.set(branch.remote, [branch]);
  }

  return [...byRemote.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([remote, list]) => ({
      remote,
      branches: list,
      nodes: underRemote(buildBranchTree(list), remote),
    }));
}

/**
 * Descend sous le(s) nœud(s) formé(s) par le nom du distant : ils sont déjà
 * portés par l'en-tête du groupe. Toutes les branches du groupe partageant ce
 * préfixe, chaque niveau traversé n'a qu'un seul enfant, et c'est un dossier.
 */
function underRemote(
  nodes: BranchTreeNode<RemoteBranchEntry>[],
  remote: string,
): BranchTreeNode<RemoteBranchEntry>[] {
  let current = nodes;
  for (let i = 0; i < remote.split("/").length; i++) {
    const [only] = current;
    if (current.length !== 1 || only?.type !== "dir") break;
    current = only.children;
  }
  return current;
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
