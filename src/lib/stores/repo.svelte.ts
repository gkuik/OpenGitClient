import { SvelteSet } from "svelte/reactivity";
import { api, pickRepositoryFolder } from "../api";
import { allDirPaths } from "../tree";
import type {
  AppError,
  BranchEntry,
  CommitDetails,
  FileDiff,
  FileEntry,
  GraphCommit,
  RecentRepo,
  RepoInfo,
  RepoStatus,
  StashEntry,
} from "../types";

export type ViewMode = "tree" | "path";

/**
 * Ce que montre le visualiseur de diff : un fichier du working directory, ou un
 * fichier au sein d'un commit du graph. Un type discriminé unique évite que les
 * deux sources se contredisent.
 *
 * C'est aussi ce qui pilote la colonne centrale : `null` → le graph, sinon → le
 * diff. Il n'y a donc pas d'état d'onglet à maintenir en parallèle.
 */
export type DiffTarget =
  | { kind: "worktree"; path: string; staged: boolean }
  | { kind: "commit"; oid: string; path: string };

/** Taille d'une page d'historique (scroll infini). */
const GRAPH_PAGE_SIZE = 500;

/**
 * État applicatif central, en runes Svelte 5.
 *
 * On expose une instance unique (`repo`) importée par les composants. Toutes les
 * opérations Git passent par `api`, et l'état (statut, diff, erreur) est rafraîchi
 * de façon cohérente après chaque action mutante.
 */
class RepoStore {
  repoInfo = $state<RepoInfo | null>(null);
  status = $state<RepoStatus | null>(null);
  diff = $state<FileDiff | null>(null);
  recent = $state<RecentRepo[]>([]);
  error = $state<AppError | null>(null);
  busy = $state(false);
  committing = $state(false);

  // Ce qui est actuellement affiché dans le visualiseur de diff.
  diffTarget = $state<DiffTarget | null>(null);

  // Branches locales et stashes (sidebar de gauche).
  branches = $state<BranchEntry[]>([]);
  stashes = $state<StashEntry[]>([]);
  checkingOut = $state(false);

  // Graph : historique chargé et commit sélectionné (détail en colonne droite).
  graph = $state<GraphCommit[]>([]);
  graphHasMore = $state(false);
  graphLoading = $state(false);
  selectedCommitOid = $state<string | null>(null);
  commitDetails = $state<CommitDetails | null>(null);

  // Préférences d'affichage de la liste de fichiers.
  viewMode = $state<ViewMode>("tree");
  sortAsc = $state(true);
  /** Dossiers dépliés (vue Tree). Persiste entre les rafraîchissements. */
  private expandedDirs = new SvelteSet<string>();
  /**
   * Dossiers de branches *repliés*. On stocke l'inverse des fichiers car les
   * groupes de branches sont dépliés par défaut.
   */
  private collapsedBranchDirs = new SvelteSet<string>();

  // ── Dérivés ────────────────────────────────────────────────────────────────

  /** Chemin du fichier affiché dans le diff, quelle qu'en soit la source. */
  get selectedPath(): string | null {
    return this.diffTarget?.path ?? null;
  }

  /** Vrai uniquement pour un fichier *indexé* du working directory. */
  get selectedStaged(): boolean {
    return this.diffTarget?.kind === "worktree" && this.diffTarget.staged;
  }

  /** Fichiers non indexés = modifiés + non suivis, triés. */
  get unstagedEntries(): FileEntry[] {
    const list = [
      ...(this.status?.unstaged ?? []),
      ...(this.status?.untracked ?? []),
    ];
    return this.sortEntries(list);
  }

  /** Fichiers indexés, triés. */
  get stagedEntries(): FileEntry[] {
    return this.sortEntries(this.status?.staged ?? []);
  }

  /** Y a-t-il au moins un fichier indexé ? (active le bouton commit) */
  get hasStaged(): boolean {
    return (this.status?.staged.length ?? 0) > 0;
  }

  /** Nombre de fichiers distincts qui ont un changement (en-tête sidebar). */
  get changeCount(): number {
    const set = new Set<string>();
    for (const e of this.status?.staged ?? []) set.add(e.path);
    for (const e of this.status?.unstaged ?? []) set.add(e.path);
    for (const e of this.status?.untracked ?? []) set.add(e.path);
    return set.size;
  }

  /** Tous les dossiers sont-ils dépliés ? (label du lien Tout déplier/replier) */
  get allDirsExpanded(): boolean {
    const dirs = this.everyDirPath();
    return dirs.length > 0 && dirs.every((d) => this.expandedDirs.has(d));
  }

  // ── Préférences d'affichage ─────────────────────────────────────────────────

  setViewMode(mode: ViewMode) {
    this.viewMode = mode;
  }

  toggleSort() {
    this.sortAsc = !this.sortAsc;
  }

  isDirOpen(path: string): boolean {
    return this.expandedDirs.has(path);
  }

  toggleDir(path: string) {
    if (this.expandedDirs.has(path)) this.expandedDirs.delete(path);
    else this.expandedDirs.add(path);
  }

  /** Les groupes de branches sont dépliés par défaut. */
  isBranchDirOpen(path: string): boolean {
    return !this.collapsedBranchDirs.has(path);
  }

  toggleBranchDir(path: string) {
    if (this.collapsedBranchDirs.has(path)) this.collapsedBranchDirs.delete(path);
    else this.collapsedBranchDirs.add(path);
  }

  /** Déplie tout / replie tout selon l'état courant. */
  toggleExpandAll() {
    if (this.allDirsExpanded) {
      this.expandedDirs.clear();
    } else {
      for (const d of this.everyDirPath()) this.expandedDirs.add(d);
    }
  }

  clearError() {
    this.error = null;
  }

  // ── Cycle de vie / dépôt ────────────────────────────────────────────────────

  /** Charge la liste des dépôts récents au démarrage. */
  async init() {
    try {
      this.recent = await api.listRecent();
    } catch {
      this.recent = [];
    }
  }

  /** Ouvre le dialog natif puis charge le dépôt choisi. */
  async openFromDialog() {
    const path = await pickRepositoryFolder();
    if (path) await this.openRepo(path);
  }

  async openRepo(path: string) {
    this.busy = true;
    this.error = null;
    try {
      this.repoInfo = await api.openRepository(path);
      this.diffTarget = null;
      this.diff = null;
      this.clearCommitSelection();
      this.expandedDirs.clear();
      this.collapsedBranchDirs.clear();
      await this.refreshStatus();
      await this.loadBranches();
      await this.loadStashes();
      await this.loadGraph();
      this.recent = await api.listRecent();
    } catch (e) {
      this.error = e as AppError;
    } finally {
      this.busy = false;
    }
  }

  /** Recharge le statut et resynchronise le diff du fichier sélectionné. */
  async refreshStatus() {
    if (!this.repoInfo) return;
    try {
      this.status = await api.getStatus();
      this.resyncSelection();
      await this.loadDiff();
    } catch (e) {
      this.error = e as AppError;
    }
  }

  /** Ouvre le diff d'un fichier du working directory (colonne de droite). */
  async select(path: string, staged: boolean) {
    this.diffTarget = { kind: "worktree", path, staged };
    await this.loadDiff();
  }

  /** Ouvre le diff d'un fichier au sein d'un commit (détail du commit). */
  async selectCommitFile(oid: string, path: string) {
    this.diffTarget = { kind: "commit", oid, path };
    await this.loadDiff();
  }

  /**
   * Ferme le diff (croix de l'en-tête) : la colonne centrale revient au graph.
   * Le commit sélectionné, lui, reste affiché à droite pour enchaîner sur un
   * autre de ses fichiers.
   */
  clearSelection() {
    this.diffTarget = null;
    this.diff = null;
  }

  // ── Graph ───────────────────────────────────────────────────────────────────

  /**
   * Charge une page d'historique.
   *
   * `reset` repart de la première page (ouverture, commit, checkout) ; sinon on
   * concatène la suivante. Le backend reconstruit son parcours à chaque appel :
   * l'ordre n'est stable que tant que les références ne bougent pas, d'où le
   * rechargement complet après toute mutation du dépôt.
   */
  async loadGraph(reset = true) {
    if (!this.repoInfo || this.graphLoading) return;
    this.graphLoading = true;
    try {
      const page = await api.commitGraph(
        reset ? 0 : this.graph.length,
        GRAPH_PAGE_SIZE,
      );
      this.graph = reset ? page.commits : [...this.graph, ...page.commits];
      this.graphHasMore = page.hasMore;
    } catch (e) {
      this.error = e as AppError;
      if (reset) {
        this.graph = [];
        this.graphHasMore = false;
      }
    } finally {
      this.graphLoading = false;
    }
  }

  /** Page suivante, appelée par le scroll infini du graph. */
  async loadMoreGraph() {
    if (!this.graphHasMore || this.graphLoading) return;
    await this.loadGraph(false);
  }

  /**
   * Sélectionne un commit du graph et charge son détail (colonne de droite).
   * Recliquer le commit déjà sélectionné le referme, comme la croix du panneau.
   */
  async selectCommit(oid: string) {
    if (this.selectedCommitOid === oid) {
      this.clearCommitSelection();
      return;
    }
    this.selectedCommitOid = oid;
    this.commitDetails = null;
    try {
      const details = await api.commitDetails(oid);
      // Un clic plus récent a pu changer la cible pendant l'appel.
      if (this.selectedCommitOid === oid) this.commitDetails = details;
    } catch (e) {
      this.error = e as AppError;
    }
  }

  // ── Branches & stashes ──────────────────────────────────────────────────────

  async loadBranches() {
    if (!this.repoInfo) return;
    try {
      this.branches = await api.listBranches();
    } catch (e) {
      this.error = e as AppError;
    }
  }

  async loadStashes() {
    if (!this.repoInfo) return;
    try {
      this.stashes = await api.listStashes();
    } catch (e) {
      this.error = e as AppError;
    }
  }

  /**
   * Bascule sur une branche locale (double-clic dans la sidebar de gauche).
   * Le backend refuse le checkout si des modifications locales seraient
   * écrasées : l'erreur remonte alors telle quelle dans le bandeau.
   */
  async checkoutBranch(name: string) {
    if (this.checkingOut || this.busy) return;
    if (this.repoInfo?.branch === name) return; // déjà sur cette branche
    this.checkingOut = true;
    this.error = null;
    try {
      this.repoInfo = await api.checkoutBranch(name);
      // Le contenu change : la sélection courante n'a plus de sens.
      this.diffTarget = null;
      this.diff = null;
      await this.refreshStatus();
      await this.loadBranches();
      await this.loadStashes();
      // Les commits ne changent pas, mais les pastilles HEAD se déplacent.
      await this.loadGraph();
    } catch (e) {
      this.error = e as AppError;
    } finally {
      this.checkingOut = false;
    }
  }

  // ── Actions Git ─────────────────────────────────────────────────────────────

  async stage(path: string) {
    await this.run(() => api.stageFile(path));
  }

  async unstage(path: string) {
    await this.run(() => api.unstageFile(path));
  }

  async stageAll() {
    await this.run(() => api.stageAll());
  }

  async unstageAll() {
    await this.run(() => api.unstageAll());
  }

  async commit(summary: string, body: string | null, amend = false): Promise<boolean> {
    if (summary.trim().length === 0) return false;
    if (!amend && !this.hasStaged) return false;
    this.committing = true;
    this.error = null;
    try {
      const cleanBody = body && body.trim().length > 0 ? body.trim() : null;
      await api.commit(summary.trim(), cleanBody, amend);
      // Un amend remplace le commit HEAD : une sélection qui le visait est morte.
      if (amend) this.clearCommitSelection();
      await this.refreshStatus();
      await this.loadGraph();
      return true;
    } catch (e) {
      this.error = e as AppError;
      return false;
    } finally {
      this.committing = false;
    }
  }

  /**
   * Referme le détail de commit : la colonne de droite rend la main aux
   * changements en cours. Un diff issu de ce commit n'aurait plus de sélecteur
   * de fichiers, on le ferme aussi.
   */
  clearCommitSelection() {
    this.selectedCommitOid = null;
    this.commitDetails = null;
    if (this.diffTarget?.kind === "commit") {
      this.diffTarget = null;
      this.diff = null;
    }
  }

  // ── Interne ─────────────────────────────────────────────────────────────────

  private sortEntries(list: FileEntry[]): FileEntry[] {
    const sorted = [...list].sort((a, b) => a.path.localeCompare(b.path));
    return this.sortAsc ? sorted : sorted.reverse();
  }

  /** Tous les chemins de dossiers (sections indexée + non indexée confondues). */
  private everyDirPath(): string[] {
    const combined = [
      ...(this.status?.staged ?? []),
      ...(this.status?.unstaged ?? []),
      ...(this.status?.untracked ?? []),
    ];
    return allDirPaths(combined);
  }

  /** Exécute une action mutante puis rafraîchit le statut, erreurs capturées. */
  private async run(op: () => Promise<unknown>) {
    this.error = null;
    this.busy = true;
    try {
      await op();
      await this.refreshStatus();
    } catch (e) {
      this.error = e as AppError;
    } finally {
      this.busy = false;
    }
  }

  /**
   * Après un refresh, le fichier sélectionné a pu changer de section (ex. après
   * un stage). On le re-localise : s'il a disparu, on désélectionne ; sinon on
   * bascule la cible vers la section qui le contient encore.
   *
   * Un diff de commit est ignoré : il ne dépend pas du working directory.
   */
  private resyncSelection() {
    const target = this.diffTarget;
    if (target?.kind !== "worktree" || !this.status) return;

    const inStaged = this.status.staged.some((f) => f.path === target.path);
    const inWorking =
      this.status.unstaged.some((f) => f.path === target.path) ||
      this.status.untracked.some((f) => f.path === target.path);

    if (!inStaged && !inWorking) {
      this.diffTarget = null;
      this.diff = null;
      return;
    }
    if (target.staged && !inStaged) this.diffTarget = { ...target, staged: false };
    else if (!target.staged && !inWorking) this.diffTarget = { ...target, staged: true };
  }

  private async loadDiff() {
    const target = this.diffTarget;
    if (!target) {
      this.diff = null;
      return;
    }
    try {
      this.diff =
        target.kind === "worktree"
          ? await api.getFileDiff(target.path, target.staged)
          : await api.commitFileDiff(target.oid, target.path);
    } catch (e) {
      this.error = e as AppError;
      this.diff = null;
    }
  }
}

/** Instance unique partagée par toute l'application. */
export const repo = new RepoStore();
