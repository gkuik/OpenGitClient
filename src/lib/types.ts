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
  /**
   * Fusion en cours (conflits à résoudre, ou commit de fusion à créer). Pilote
   * le bandeau qui offre l'abandon : sans lui, un conflit n'aurait aucune issue
   * depuis l'application.
   */
  merging: boolean;
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
  /**
   * Branche amont et écart avec elle. `null` quand la branche n'en suit
   * aucune — « rien à comparer » n'est pas « à jour », d'où l'absence de
   * compteur dans ce cas plutôt qu'un zéro.
   */
  upstream: Upstream | null;
}

/**
 * Écart d'une branche locale avec son amont. Les deux compteurs comparent des
 * références **locales** : ils datent du dernier fetch, pas de l'état courant
 * du serveur.
 */
export interface Upstream {
  /** Nom de la branche amont ("origin/main"). */
  name: string;
  /** Commits à pousser. */
  ahead: number;
  /** Commits à récupérer. */
  behind: number;
}

/**
 * Branche distante. `name` est le nom complet, distant inclus
 * ("origin/feature/x") : il commence toujours par `remote` suivi d'un "/".
 * Pas de `isHead` — HEAD ne pointe jamais sur une branche distante.
 */
export interface RemoteBranchEntry {
  name: string;
  /** Distant auquel elle appartient ("origin"). */
  remote: string;
  /** Commit de tête. */
  oid: string;
}

/**
 * Nature d'une référence pointant sur un commit du graph. Les tags ne sont pas
 * encore lus par le backend ; branches locales et distantes le sont.
 */
export type GraphRefKind = "head" | "localBranch" | "remoteBranch";

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

/** Référence distante déplacée par un fetch. */
export interface FetchedRef {
  /** Nom complet ("refs/remotes/origin/main"). */
  name: string;
  /** OID avant le fetch ; null si la référence vient d'apparaître. */
  oldOid: string | null;
  newOid: string;
}

/** Résultat d'un fetch. `updated` vide = le distant n'a pas bougé. */
export interface FetchReport {
  /** Distant réellement interrogé (résolu par le backend si non précisé). */
  remote: string;
  updated: FetchedRef[];
}

/**
 * Charge utile de l'événement `repo://fetched`. Le fetch tournant sur un thread
 * dédié, son résultat n'est pas la valeur de retour de la commande : il arrive
 * par cet événement. Exactement l'un de `report` / `error` est renseigné.
 */
export interface FetchEvent {
  repoId: string;
  report: FetchReport | null;
  error: AppError | null;
}

/**
 * Ce que le bouton Pull exécute, choisi dans son menu et persisté côté Rust.
 *
 * Pas de `"rebase"` : l'entrée existe dans le menu mais désactivée, faute
 * d'implémentation. Le type ne décrit que ce qui marche.
 */
export type PullMode = "fetchAll" | "fastForwardOnly" | "fastForwardOrMerge";

/**
 * Thème de l'interface, choisi dans les paramètres et persisté côté Rust.
 *
 * `"system"` n'est pas une palette : c'est l'absence de choix, résolue en clair
 * ou sombre par `theme.svelte.ts` (et par la fenêtre native de son côté).
 */
export type ThemeMode = "system" | "light" | "dark";

/**
 * Largeurs des deux colonnes latérales, en **rem** — l'unité de toutes les
 * longueurs de l'interface, donc solidaires de la taille du texte. Le
 * glissement se mesure en pixels : c'est `layout.svelte.ts` qui convertit.
 */
export interface SidebarWidths {
  left: number;
  right: number;
}

/**
 * Ce qu'un pull a fait localement. Une divergence et un conflit ne sont pas des
 * erreurs : le fetch qui précède a réussi et déplacé des références.
 */
export type PullOutcome =
  | { kind: "fetchedOnly" }
  | { kind: "upToDate" }
  | { kind: "fastForwarded"; commits: number }
  | { kind: "merged"; commits: number }
  | { kind: "conflicted"; files: string[] }
  | { kind: "diverged"; ahead: number; behind: number };

export interface PullReport {
  /** Distants interrogés — un seul, sauf en « Fetch All ». */
  remotes: string[];
  updated: FetchedRef[];
  outcome: PullOutcome;
}

/**
 * Ce que le menu de fusion propose. Pas une préférence persistée, contrairement à
 * `PullMode` : le choix se fait au coup par coup, parce qu'il ne veut pas dire la
 * même chose selon la branche qu'on fusionne.
 */
export type MergeMode = "fastForwardOrMerge" | "noFastForward";

/**
 * Ce qu'une fusion de branche à branche a fait de la cible (glisser-déposer et
 * menu contextuel de la section LOCAL). Un conflit n'est pas une erreur : le
 * dépôt est en fusion, les fichiers à résoudre sont dans le working directory.
 */
export type MergeOutcome =
  | { kind: "upToDate" }
  | { kind: "fastForwarded"; commits: number }
  | { kind: "merged"; commits: number }
  | { kind: "conflicted"; files: string[] };

export interface MergeReport {
  /** Branche fusionnée : celle qu'on a déposée, ou la branche courante. */
  source: string;
  /** Branche qui reçoit la fusion : celle sur laquelle on a déposé. */
  target: string;
  /**
   * HEAD a-t-il changé de branche ? Une avance rapide sur une branche inactive
   * ne déplace qu'une référence ; une vraie fusion, elle, bascule sur la cible
   * et y reste. Le frontend ne peut pas le deviner.
   */
  switched: boolean;
  outcome: MergeOutcome;
}

/** Charge utile de `repo://pulled`, jumelle de `FetchEvent`. */
export interface PullEvent {
  repoId: string;
  report: PullReport | null;
  error: AppError | null;
}

/**
 * Résultat d'un push. Pas de compteur de commits envoyés : c'est la pastille
 * `↑` de la branche qui le disait, et elle retombe à zéro au rechargement.
 */
export interface PushReport {
  remote: string;
  /** Branche poussée — toujours la branche courante. */
  branch: string;
  /** Le suivi vient d'être posé (premier push de la branche). */
  upstreamSet: boolean;
}

/** Charge utile de `repo://pushed`, jumelle de `FetchEvent`. */
export interface PushEvent {
  repoId: string;
  report: PushReport | null;
  error: AppError | null;
}

/**
 * Charge utile de `repo://changed` : le dépôt a bougé sur le disque sous
 * l'effet d'un autre outil (éditeur, terminal, autre client Git). Rien n'a été
 * récupéré du réseau — il n'y a que de la relecture locale à faire.
 *
 * Deux drapeaux et non une portée unique : les deux recharges n'ont pas le même
 * prix, et un même lot peut concerner les deux (un `git checkout` change les
 * références *et* les fichiers).
 */
export interface RepoChangedEvent {
  repoId: string;
  /** Working directory ou index modifiés → statut à relire. */
  worktree: boolean;
  /** Références déplacées (`HEAD`, `refs/**`, fusion) → branches et graph. */
  refs: boolean;
}

/**
 * Dépôt distant d'un onglet. `host` est la clé sous laquelle les identifiants
 * sont rangés — null si l'URL n'expose pas d'hôte (chemin local).
 */
export interface RemoteInfo {
  name: string;
  url: string;
  host: string | null;
  hasCredentials: boolean;
  /**
   * Distant joint en HTTP(S) ? Seuls ceux-là utilisent un jeton stocké : en SSH
   * l'authentification passe par une clé, et saisir un mot de passe n'aurait
   * aucun effet.
   */
  usesHttp: boolean;
}

/** Profil d'auteur, réutilisable d'un dépôt à l'autre. */
export interface Profile {
  /** Identifiant stable ; le libellé, lui, peut être renommé. */
  id: string;
  label: string;
  name: string;
  email: string;
}

/** Identité sous laquelle un dépôt commite. */
export interface Identity {
  name: string | null;
  email: string | null;
  /**
   * Définie dans le dépôt lui-même plutôt qu'héritée de la config globale —
   * c'est ce qui distingue un profil choisi d'une valeur par défaut.
   */
  isLocal: boolean;
}

/** Forme sérialisée d'une erreur backend (`AppError`). */
export interface AppError {
  kind: string;
  message: string;
}
