// Types TypeScript miroir des DTO Rust (voir `src-tauri/src/dto.rs`).
// Toute modification d'un côté doit être répercutée de l'autre.

export type FileStatus =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "typechange"
  | "conflicted"
  | "untracked";

export interface FileEntry {
  path: string;
  /** Ancien chemin en cas de renommage, sinon null. */
  oldPath: string | null;
  status: FileStatus;
}

export interface RepoStatus {
  staged: FileEntry[];
  unstaged: FileEntry[];
  untracked: FileEntry[];
}

export interface RepoInfo {
  /**
   * Chemin canonique du dépôt, qui sert aussi d'**identifiant d'onglet** :
   * c'est la valeur à repasser en `repoId` dans tous les autres appels.
   */
  path: string;
  name: string;
  branch: string | null;
  isDetached: boolean;
  head: string | null;
}

export type DiffLineKind = "context" | "addition" | "deletion";

export interface DiffLine {
  kind: DiffLineKind;
  content: string;
  oldLineno: number | null;
  newLineno: number | null;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface FileDiff {
  path: string;
  isBinary: boolean;
  hunks: DiffHunk[];
}

export interface CommitResult {
  oid: string;
  summary: string;
}

export interface RecentRepo {
  path: string;
  name: string;
}

/** Session à restaurer au lancement : onglets ouverts et onglet actif. */
export interface SessionInfo {
  /** Chemins canoniques des dépôts à rouvrir, dans l'ordre des onglets. */
  tabs: string[];
  active: string | null;
}

/** Branche locale. `name` est le nom complet ("fix/EDIAG6-811"). */
export interface BranchEntry {
  name: string;
  isHead: boolean;
  /** Commit de tête ; chaîne vide si la branche n'a pas encore de commit. */
  oid: string;
}

/**
 * Nature d'une référence pointant sur un commit du graph. Seuls HEAD et les
 * branches locales sont produits par le backend pour l'instant.
 */
export type GraphRefKind = "head" | "localBranch";

export interface GraphRef {
  name: string;
  kind: GraphRefKind;
}

/**
 * Commit tel que consommé par le graph. Les `parents` sont bruts : l'assignation
 * des lanes est faite côté frontend (voir `lib/graph/layout.ts`).
 */
export interface GraphCommit {
  oid: string;
  /** OID abrégé (7 caractères). */
  shortOid: string;
  summary: string;
  authorName: string;
  /** Date d'auteur, en secondes Unix UTC. */
  timestamp: number;
  parents: string[];
  refs: GraphRef[];
}

/** Page d'historique. `hasMore` signale qu'il reste des commits à charger. */
export interface CommitGraphPage {
  commits: GraphCommit[];
  hasMore: boolean;
}

/** Détail complet d'un commit, fichiers modifiés inclus (vs premier parent). */
export interface CommitDetails {
  oid: string;
  shortOid: string;
  summary: string;
  /** Corps du message, ou null s'il n'y en a pas. */
  body: string | null;
  authorName: string;
  authorEmail: string;
  timestamp: number;
  parents: string[];
  files: FileEntry[];
}

/** Entrée de la pile de stash (`stash@{index}`). */
export interface StashEntry {
  index: number;
  message: string;
  /** Branche d'origine, extraite du message côté backend. */
  branch: string | null;
  oid: string;
}

/** Forme sérialisée d'une erreur backend (`AppError`). */
export interface AppError {
  kind: string;
  message: string;
}
