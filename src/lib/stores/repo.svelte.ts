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
 * État d'**un** dépôt ouvert, en runes Svelte 5 — soit un onglet.
 *
 * Il y a une instance par onglet ; `TabsStore` gère la collection et `repo`
 * (plus bas) donne accès à l'onglet actif. Toutes les opérations Git passent par
 * `api` en fournissant `repoId`, et l'état (statut, diff, erreur) est rafraîchi
 * de façon cohérente après chaque action mutante.
 */
export class RepoStore {
  /** Identifiant d'onglet = chemin canonique du dépôt (voir `RepoInfo.path`). */
  readonly repoId: string;

  repoInfo = $state<RepoInfo | null>(null);
  status = $state<RepoStatus | null>(null);
  diff = $state<FileDiff | null>(null);
  error = $state<AppError | null>(null);
  busy = $state(false);
  committing = $state(false);
  /** Vrai tant que le premier chargement du dépôt n'est pas terminé. */
  loaded = $state(false);

  constructor(repoId: string, info: RepoInfo | null = null) {
    this.repoId = repoId;
    this.repoInfo = info;
  }

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
  /**
   * Position de scroll du graph. Elle vit ici et non dans le DOM : tous les
   * onglets partagent le même `GraphView`, donc sans ça le défilement d'un onglet
   * serait perdu (voire écrasé) en basculant vers un autre.
   */
  graphScrollTop = $state(0);
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

  // ── Cycle de vie de l'onglet ────────────────────────────────────────────────

  /** Chargement initial du dépôt (statut, branches, stashes, graph). */
  async load() {
    this.busy = true;
    this.error = null;
    try {
      if (!this.repoInfo) this.repoInfo = await api.getRepoInfo(this.repoId);
      await this.refreshStatus();
      await this.loadBranches();
      await this.loadStashes();
      await this.loadGraph();
      this.loaded = true;
    } catch (e) {
      this.error = e as AppError;
    } finally {
      this.busy = false;
    }
  }

  /**
   * Appelé au retour sur l'onglet. L'état (graph, sélection, scroll) est conservé
   * en mémoire pour un retour instantané, mais le working directory a pu changer
   * sur le disque pendant qu'on était ailleurs : on resynchronise le statut, et
   * les branches dont les pastilles du graph dépendent.
   */
  async activate() {
    if (!this.loaded) {
      await this.load();
      return;
    }
    await this.refreshStatus();
    await this.loadBranches();
  }

  /** Recharge le statut et resynchronise le diff du fichier sélectionné. */
  async refreshStatus() {
    if (!this.repoInfo) return;
    try {
      this.status = await api.getStatus(this.repoId);
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
      const page = await api.commitGraph(this.repoId, 
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
      const details = await api.commitDetails(this.repoId, oid);
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
      this.branches = await api.listBranches(this.repoId);
    } catch (e) {
      this.error = e as AppError;
    }
  }

  async loadStashes() {
    if (!this.repoInfo) return;
    try {
      this.stashes = await api.listStashes(this.repoId);
    } catch (e) {
      this.error = e as AppError;
    }
  }

  /**
   * Applique un stash (menu contextuel de la section STASHES). `pop` le retire
   * ensuite de la pile. Le working directory change → on rafraîchit le statut ;
   * les index de stash bougent → on recharge la liste. Un conflit remonte dans
   * le bandeau et laisse le stash en place.
   */
  async applyStash(index: number, pop: boolean) {
    await this.run(() => (pop ? api.stashPop(this.repoId, index) : api.stashApply(this.repoId, index)));
    await this.loadStashes();
  }

  /** Retire un stash sans l'appliquer (action irréversible du menu contextuel). */
  async dropStash(index: number) {
    await this.run(() => api.stashDrop(this.repoId, index));
    await this.loadStashes();
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
      this.repoInfo = await api.checkoutBranch(this.repoId, name);
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
    await this.run(() => api.stageFile(this.repoId, path));
  }

  async unstage(path: string) {
    await this.run(() => api.unstageFile(this.repoId, path));
  }

  async stageAll() {
    await this.run(() => api.stageAll(this.repoId));
  }

  async unstageAll() {
    await this.run(() => api.unstageAll(this.repoId));
  }

  async commit(summary: string, body: string | null, amend = false): Promise<boolean> {
    if (summary.trim().length === 0) return false;
    if (!amend && !this.hasStaged) return false;
    this.committing = true;
    this.error = null;
    try {
      const cleanBody = body && body.trim().length > 0 ? body.trim() : null;
      await api.commit(this.repoId, summary.trim(), cleanBody, amend);
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
          ? await api.getFileDiff(this.repoId, target.path, target.staged)
          : await api.commitFileDiff(this.repoId, target.oid, target.path);
    } catch (e) {
      this.error = e as AppError;
      this.diff = null;
    }
  }
}

/**
 * Collection des dépôts ouverts — un onglet chacun.
 *
 * Chaque onglet conserve son `RepoStore` en mémoire tant qu'il est ouvert : y
 * revenir est instantané (graph, sélection et scroll intacts), seul le statut du
 * working directory est resynchronisé (voir `RepoStore.activate`).
 */
class TabsStore {
  /** Onglets dans l'ordre d'affichage. */
  tabs = $state<RepoStore[]>([]);
  activeId = $state<string | null>(null);
  recent = $state<RecentRepo[]>([]);
  /** Vrai pendant l'ouverture d'un dépôt (dialog ou restauration de session). */
  opening = $state(false);
  /** Erreur d'ouverture — celles propres à un dépôt vivent dans son onglet. */
  openError = $state<AppError | null>(null);

  get active(): RepoStore | null {
    return this.tabs.find((t) => t.repoId === this.activeId) ?? null;
  }

  get hasTabs(): boolean {
    return this.tabs.length > 0;
  }

  /** Restaure la session persistée (onglets + onglet actif) au démarrage. */
  async init() {
    try {
      this.recent = await api.listRecent();
    } catch {
      this.recent = [];
    }

    let session;
    try {
      session = await api.getSession();
    } catch {
      return;
    }

    // Un dépôt supprimé ou déplacé depuis la dernière session ne doit pas
    // empêcher les autres de s'ouvrir : chaque échec est simplement ignoré.
    for (const path of session.tabs) {
      try {
        await this.openTab(path, { activate: false });
      } catch {
        /* onglet abandonné */
      }
    }

    const restored = session.active && this.tabs.some((t) => t.repoId === session.active);
    await this.activate(restored ? session.active! : (this.tabs[0]?.repoId ?? null));
  }

  /** Ouvre le dialog natif puis ouvre le dépôt choisi dans un onglet. */
  async openFromDialog() {
    const path = await pickRepositoryFolder();
    if (path) await this.open(path);
  }

  /** Ouvre un dépôt (ou active son onglet s'il l'est déjà). */
  async open(path: string) {
    if (this.opening) return;
    this.opening = true;
    this.openError = null;
    try {
      const id = await this.openTab(path, { activate: true });
      if (id) this.recent = await api.listRecent();
    } catch (e) {
      this.openError = e as AppError;
    } finally {
      this.opening = false;
    }
  }

  /** Bascule sur un onglet et resynchronise son statut. */
  async activate(id: string | null) {
    if (id === null) {
      this.activeId = null;
      return;
    }
    const tab = this.tabs.find((t) => t.repoId === id);
    if (!tab) return;

    // L'onglet est affiché immédiatement ; le rafraîchissement suit.
    this.activeId = id;
    api.setActiveRepo(id).catch(() => {
      /* la persistance de la session ne doit jamais bloquer la navigation */
    });
    await tab.activate();
  }

  /**
   * Déplace un onglet dans la barre.
   *
   * `toIndex` est un index d'**insertion dans la liste courante**, où l'onglet
   * déplacé compte encore : c'est ce que calcule la barre à partir des milieux
   * d'onglets, et le retrait décale ensuite d'un cran tout ce qui suit.
   */
  move(id: string, toIndex: number) {
    const from = this.tabs.findIndex((t) => t.repoId === id);
    if (from === -1) return;
    const to = toIndex > from ? toIndex - 1 : toIndex;
    if (to === from) return;

    const next = [...this.tabs];
    const [tab] = next.splice(from, 1);
    next.splice(to, 0, tab);
    this.tabs = next;

    // Le backend ne garde l'ordre que pour restaurer la session : un échec de
    // persistance ne doit pas annuler le déplacement déjà fait à l'écran.
    api.setTabOrder(next.map((t) => t.repoId)).catch(() => {
      /* l'ordre reste correct pour cette session */
    });
  }

  /** Ferme un onglet et bascule sur son voisin. */
  async close(id: string) {
    const index = this.tabs.findIndex((t) => t.repoId === id);
    if (index === -1) return;

    this.tabs = this.tabs.filter((t) => t.repoId !== id);
    try {
      await api.closeRepository(id);
    } catch {
      /* l'onglet est retiré de l'UI quoi qu'il arrive */
    }

    if (this.activeId === id) {
      // Voisin de droite, sinon celui de gauche — comme un navigateur.
      const next = this.tabs[index] ?? this.tabs[index - 1] ?? null;
      await this.activate(next?.repoId ?? null);
    }
  }

  /**
   * Ouvre le dépôt côté backend et crée l'onglet s'il n'existe pas encore.
   * Renvoie l'identifiant d'onglet.
   */
  private async openTab(
    path: string,
    { activate }: { activate: boolean },
  ): Promise<string> {
    const info = await api.openRepository(path);
    const id = info.path;

    let tab = this.tabs.find((t) => t.repoId === id);
    if (!tab) {
      tab = new RepoStore(id, info);
      this.tabs = [...this.tabs, tab];
    } else {
      tab.repoInfo = info;
    }

    if (activate) await this.activate(id);
    return id;
  }
}

/** Collection d'onglets partagée par toute l'application. */
export const tabs = new TabsStore();

/**
 * Onglet vide, utilisé quand aucun dépôt n'est ouvert : les composants peuvent
 * lire `repo.*` sans se garder contre `null`.
 */
const EMPTY_TAB = new RepoStore("");

/**
 * Vue sur l'onglet **actif**.
 *
 * Les composants continuent d'importer `repo` et ignorent l'existence des
 * onglets : chaque accès est redirigé vers l'onglet courant. Comme la lecture de
 * `tabs.activeId` fait partie de l'accès, changer d'onglet invalide naturellement
 * tout ce qui lit `repo` — c'est ce qui évite de propager un `repoId` dans les
 * douze composants qui s'en servent.
 */
export const repo: RepoStore = new Proxy(EMPTY_TAB, {
  get(_target, prop, _receiver) {
    const target = tabs.active ?? EMPTY_TAB;
    const value = Reflect.get(target, prop, target);
    // Les méthodes doivent rester liées à l'onglet, pas au proxy.
    return typeof value === "function" ? value.bind(target) : value;
  },
  set(_target, prop, value) {
    const target = tabs.active ?? EMPTY_TAB;
    return Reflect.set(target, prop, value, target);
  },
  has(_target, prop) {
    return Reflect.has(tabs.active ?? EMPTY_TAB, prop);
  },
});
