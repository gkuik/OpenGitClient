import { SvelteSet } from "svelte/reactivity";
import { api, pickRepositoryFolder } from "../api";
import { allDirPaths } from "../tree";
import type {
  AppError,
  BranchEntry,
  CommitDetails,
  FetchEvent,
  FileDiff,
  FileEntry,
  GraphCommit,
  Identity,
  Profile,
  PullEvent,
  PullMode,
  PullReport,
  PushEvent,
  RecentRepo,
  RemoteBranchEntry,
  RemoteInfo,
  RepoInfo,
  RepoStatus,
  StashEntry,
  Upstream,
} from "../types";

export type ViewMode = "tree" | "path";

/** Opération distante ayant déclenché une demande d'identifiants. */
type RemoteOp = "fetch" | "push" | "pull";

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

/** Durée d'affichage du compte rendu d'un fetch ou d'un push, en millisecondes. */
const REMOTE_STATUS_MS = 6000;

/** Compte rendu d'un pull, en une ligne. */
function pullStatus(report: PullReport): string {
  const where = report.remotes.join(", ");
  const o = report.outcome;
  const n = (c: number) => `${c} commit${c > 1 ? "s" : ""}`;
  switch (o.kind) {
    case "fetchedOnly": {
      const refs = report.updated.length;
      return refs === 0
        ? `${where} : déjà à jour`
        : `${where} : ${refs} référence${refs > 1 ? "s" : ""} mise${refs > 1 ? "s" : ""} à jour`;
    }
    case "upToDate":
      return `${where} : déjà à jour`;
    case "fastForwarded":
      return `${where} : ${n(o.commits)} récupéré${o.commits > 1 ? "s" : ""} (avance rapide)`;
    case "merged":
      return `${where} : ${n(o.commits)} fusionné${o.commits > 1 ? "s" : ""}`;
    case "conflicted":
      return `Fusion en conflit : ${o.files.length} fichier${o.files.length > 1 ? "s" : ""} à résoudre`;
    case "diverged":
      return `Divergence : ${n(o.ahead)} en local, ${n(o.behind)} en face — fusion non demandée`;
  }
}

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

  // Fetch et push : la commande rend la main tout de suite, le backend
  // travaillant sur un thread dédié. Ces drapeaux couvrent donc l'aller *et*
  // l'attente du résultat. Deux drapeaux distincts, mais le backend n'en laisse
  // qu'un seul actif à la fois (réservation partagée côté `AppState`).
  fetching = $state(false);
  pushing = $state(false);
  pulling = $state(false);
  /**
   * Compte rendu de la dernière opération distante, affiché brièvement sous la
   * barre d'actions. Partagé par le fetch et le push : ils ne peuvent pas
   * tourner ensemble, donc deux lignes ne serviraient à rien.
   */
  remoteStatus = $state<string | null>(null);
  private remoteStatusTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Demande d'identifiants en cours. Non nul = le dialogue de saisie est ouvert.
   * `refused` distingue « on n'avait rien » de « ce qu'on avait a été refusé »,
   * qui n'appellent pas le même message. `op` retient laquelle des deux
   * opérations l'a provoquée, pour relancer la bonne une fois la saisie
   * enregistrée.
   */
  credentialsPrompt = $state<{
    remote: RemoteInfo;
    refused: boolean;
    op: RemoteOp;
  } | null>(null);
  savingCredentials = $state(false);

  /**
   * Identité sous laquelle ce dépôt commite. Elle n'est pas stockée par
   * l'application : elle vit dans la config Git du dépôt, donc on la relit
   * plutôt que de mémoriser un choix qui pourrait diverger.
   */
  identity = $state<Identity | null>(null);

  // Branches locales, distantes et stashes (sidebar de gauche).
  branches = $state<BranchEntry[]>([]);
  /**
   * Branches distantes telles qu'elles sont sur le disque. Elles ne bougent
   * qu'au fetch — ou sous un autre outil, d'où le rechargement à l'activation
   * de l'onglet, au même titre que les branches locales.
   */
  remoteBranches = $state<RemoteBranchEntry[]>([]);
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

  /**
   * Écart de la branche courante avec son amont — ce que Pull et Push
   * traiteraient. `null` en HEAD détaché, ou si la branche ne suit rien.
   */
  get currentGap(): Upstream | null {
    return this.branches.find((b) => b.isHead)?.upstream ?? null;
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
      await this.loadRemoteBranches();
      await this.loadStashes();
      await this.loadIdentity();
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
    await this.loadRemoteBranches();
    // La config du dépôt a pu changer sur le disque pendant qu'on était ailleurs.
    await this.loadIdentity();
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

  async loadRemoteBranches() {
    if (!this.repoInfo) return;
    try {
      this.remoteBranches = await api.listRemoteBranches(this.repoId);
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
    if (this.repoInfo?.branch === name) return; // déjà sur cette branche
    await this.runCheckout(() => api.checkoutBranch(this.repoId, name));
  }

  /**
   * Bascule sur une branche distante (double-clic sur une ligne de la section
   * REMOTE). Le backend crée la branche locale de suivi au passage, d'où
   * l'absence de garde « déjà sur cette branche » : c'est lui qui connaît le
   * nom local, et y rebasculer ne coûte rien.
   *
   * `refs/remotes/**` ne bouge pas ici — inutile de recharger la section REMOTE.
   */
  async checkoutRemoteBranch(name: string) {
    await this.runCheckout(() => api.checkoutRemoteBranch(this.repoId, name));
  }

  /**
   * Corps commun aux deux bascules : ce qu'un checkout invalide est le même,
   * qu'il vienne d'une branche locale ou distante.
   */
  private async runCheckout(call: () => Promise<RepoInfo>) {
    if (this.checkingOut || this.busy) return;
    this.checkingOut = true;
    this.error = null;
    try {
      this.repoInfo = await call();
      // Le contenu change : la sélection courante n'a plus de sens.
      this.diffTarget = null;
      this.diff = null;
      await this.refreshStatus();
      await this.loadBranches();
      await this.loadStashes();
      // Les commits ne changent pas, mais les pastilles se déplacent — et une
      // bascule distante en ajoute une, celle de la branche locale créée.
      await this.loadGraph();
    } catch (e) {
      this.error = e as AppError;
    } finally {
      this.checkingOut = false;
    }
  }

  // ── Profil d'auteur ─────────────────────────────────────────────────────────

  async loadIdentity() {
    if (!this.repoInfo) return;
    try {
      this.identity = await api.getIdentity(this.repoId);
    } catch {
      // Une identité illisible ne doit pas empêcher d'utiliser le dépôt.
      this.identity = null;
    }
  }

  /**
   * Le profil actif est **déduit** de l'identité du dépôt, pas mémorisé : deux
   * profils au même nom et même adresse sont de toute façon interchangeables, et
   * rien ne peut diverger de ce que Git utilisera réellement.
   */
  activeProfile(profiles: Profile[]): Profile | null {
    const id = this.identity;
    if (!id?.isLocal) return null;
    return (
      profiles.find((p) => p.name === id.name && p.email === id.email) ?? null
    );
  }

  /** Applique un profil au dépôt, ou revient à la config globale avec `null`. */
  async applyProfile(profile: Profile | null) {
    this.error = null;
    try {
      this.identity = profile
        ? await api.setIdentity(this.repoId, profile.name, profile.email)
        : await api.clearIdentity(this.repoId);
    } catch (e) {
      this.error = e as AppError;
    }
  }

  // ── Dépôt distant ───────────────────────────────────────────────────────────

  /**
   * Lance un fetch. Rien n'est attendu ici : le résultat revient par l'événement
   * `repo://fetched`, que `TabsStore` route vers `onFetched` ci-dessous.
   */
  async fetch() {
    if (this.busyRemote || !this.repoInfo) return;
    this.fetching = true;
    this.error = null;
    this.setRemoteStatus(null);
    try {
      await api.fetchRemote(this.repoId);
    } catch (e) {
      // Échec au *lancement* (onglet fermé, opération déjà en cours) : aucun
      // événement ne suivra, c'est donc ici qu'il faut relâcher l'état.
      this.fetching = false;
      this.error = e as AppError;
    }
  }

  /**
   * Publie la branche courante. Même fonctionnement que `fetch` : le résultat
   * revient par `repo://pushed`.
   */
  async push() {
    if (this.busyRemote || !this.repoInfo) return;
    this.pushing = true;
    this.error = null;
    this.setRemoteStatus(null);
    try {
      await api.pushBranch(this.repoId);
    } catch (e) {
      this.pushing = false;
      this.error = e as AppError;
    }
  }

  /** Une opération distante est en cours : la seconde attendrait de toute façon. */
  get busyRemote(): boolean {
    return this.fetching || this.pushing || this.pulling;
  }

  /** Fusion en cours : le bandeau de sortie de secours est affiché. */
  get merging(): boolean {
    return this.repoInfo?.merging ?? false;
  }

  /**
   * Récupère puis intègre, selon le mode passé (celui du bouton Pull). Comme
   * fetch et push : le résultat revient par `repo://pulled`.
   */
  async pull(mode: PullMode) {
    if (this.busyRemote || !this.repoInfo) return;
    this.pullMode = mode;
    this.pulling = true;
    this.error = null;
    this.setRemoteStatus(null);
    try {
      await api.pull(this.repoId, mode);
    } catch (e) {
      this.pulling = false;
      this.error = e as AppError;
    }
  }

  /**
   * Mode du dernier pull lancé, mémorisé pour pouvoir le relancer après une
   * saisie d'identifiants — le mode choisi entre-temps n'aurait pas de raison
   * de s'appliquer à une opération déjà décidée.
   */
  private pullMode: PullMode = "fastForwardOrMerge";

  /** Résultat d'un pull, reçu par événement. */
  onPulled(event: PullEvent) {
    this.pulling = false;
    if (event.error) {
      if (event.error.kind === "NoCredentials" || event.error.kind === "RemoteAuth") {
        void this.askCredentials(event.error.kind === "RemoteAuth", "pull");
        return;
      }
      this.error = event.error;
      return;
    }
    if (!event.report) return;

    this.setRemoteStatus(pullStatus(event.report));

    // Un pull touche à tout : références distantes, branche courante, working
    // directory, index. On recharge donc aussi le statut, contrairement au
    // fetch et au push — c'est là que les fichiers en conflit apparaissent.
    void this.reloadAfterPull();
  }

  private async reloadAfterPull() {
    // Les infos du dépôt d'abord : c'est `merging` qui décide du bandeau de
    // sortie de secours, et il doit apparaître avant tout le reste.
    try {
      this.repoInfo = await api.getRepoInfo(this.repoId);
    } catch (e) {
      this.error = e as AppError;
    }
    await this.refreshStatus();
    await this.reloadRemoteRefs();
  }

  /**
   * Abandonne la fusion en cours : les fichiers reviennent à HEAD. Irréversible
   * pour ce qui a été résolu, mais c'est la seule issue quand on ne veut pas
   * de la fusion.
   */
  async abortMerge() {
    await this.run(() => api.abortMerge(this.repoId).then((info) => {
      this.repoInfo = info;
    }));
    await this.loadBranches();
    await this.loadGraph();
  }

  /** Résultat d'un fetch, reçu par événement. */
  onFetched(event: FetchEvent) {
    this.fetching = false;
    if (event.error) {
      // Ces deux cas ne sont pas des échecs à afficher tels quels : ils appellent
      // une saisie. Le bandeau d'erreur ne servirait qu'à faire écran au dialogue.
      if (event.error.kind === "NoCredentials" || event.error.kind === "RemoteAuth") {
        void this.askCredentials(event.error.kind === "RemoteAuth", "fetch");
        return;
      }
      this.error = event.error;
      return;
    }
    if (!event.report) return;

    const { remote, updated } = event.report;
    const n = updated.length;
    this.setRemoteStatus(
      n === 0
        ? `${remote} : déjà à jour`
        : `${remote} : ${n} référence${n > 1 ? "s" : ""} mise${n > 1 ? "s" : ""} à jour`,
    );

    // Un fetch ne touche que `refs/remotes/**`, mais la sidebar comme le graph
    // en dépendent désormais. Rien à faire si rien n'a bougé.
    if (n > 0) void this.reloadRemoteRefs();
  }

  /** Résultat d'un push, reçu par événement. */
  onPushed(event: PushEvent) {
    this.pushing = false;
    if (event.error) {
      // Mêmes deux cas qu'au fetch : une saisie à demander, pas un échec à
      // afficher. Le reste — dont un rejet du distant — passe par le bandeau,
      // car il n'y a rien à ressaisir pour le résoudre.
      if (event.error.kind === "NoCredentials" || event.error.kind === "RemoteAuth") {
        void this.askCredentials(event.error.kind === "RemoteAuth", "push");
        return;
      }
      this.error = event.error;
      return;
    }
    if (!event.report) return;

    const { remote, branch, upstreamSet } = event.report;
    this.setRemoteStatus(
      upstreamSet
        ? `${remote} : ${branch} publiée, suivi configuré`
        : `${remote} : ${branch} publiée`,
    );

    // Le push a fait avancer `refs/remotes/**` (libgit2 met les tips à jour) :
    // c'est exactement ce que recharge le chemin du fetch, pastille `↑` de la
    // branche comprise — elle doit retomber à zéro.
    void this.reloadRemoteRefs();
  }

  /**
   * Rafraîchit ce qui dépend de `refs/remotes/**` après un fetch ou un push : la section
   * REMOTE, les branches **locales** — dont l'écart avec l'amont se mesure sur
   * ces références, c'est même tout ce qu'un fetch en change — puis le graph,
   * dont le parcours passe par elles : l'ordre des pages déjà chargées n'est
   * plus valable dès que l'une d'elles a bougé, d'où le rechargement complet.
   */
  private async reloadRemoteRefs() {
    await this.loadRemoteBranches();
    await this.loadBranches();
    await this.loadGraph();
  }

  /**
   * Ouvre le dialogue d'identifiants pour le distant de cet onglet. Le backend
   * est seul à savoir quel distant serait interrogé et sous quel hôte ranger la
   * saisie, d'où l'aller-retour avant d'afficher quoi que ce soit.
   */
  private async askCredentials(refused: boolean, op: RemoteOp) {
    try {
      const remote = await api.getRemoteInfo(this.repoId);
      if (!remote.host) {
        // Sans hôte (chemin local), aucun identifiant n'a de sens à enregistrer.
        this.error = {
          kind: "NoCredentials",
          message: `Aucun identifiant utilisable pour ${remote.url}`,
        };
        return;
      }
      if (!remote.usesHttp) {
        // SSH : le jeton du dialogue ne serait jamais utilisé, l'authentification
        // passant par une clé. Mieux vaut dire quoi faire.
        this.error = {
          kind: refused ? "RemoteAuth" : "NoCredentials",
          message: refused
            ? `Clé SSH refusée par ${remote.host}. Vérifie que la clé publique y est bien déclarée.`
            : `Aucune clé SSH utilisable pour ${remote.host} : charge-la dans ssh-agent, ou place-la dans ~/.ssh (id_ed25519, id_ecdsa, id_rsa).`,
        };
        return;
      }
      this.credentialsPrompt = { remote, refused, op };
    } catch (e) {
      this.error = e as AppError;
    }
  }

  /**
   * Enregistre la saisie puis relance aussitôt l'opération qui l'avait
   * provoquée — celle-là et pas l'autre : relancer un fetch après un push
   * refusé laisserait le travail non publié.
   */
  async saveCredentials(username: string, secret: string) {
    const prompt = this.credentialsPrompt;
    if (!prompt?.remote.host || this.savingCredentials) return;
    this.savingCredentials = true;
    try {
      await api.setCredentials(prompt.remote.host, username, secret);
      this.credentialsPrompt = null;
      await (prompt.op === "push"
        ? this.push()
        : prompt.op === "pull"
          ? this.pull(this.pullMode)
          : this.fetch());
    } catch (e) {
      this.error = e as AppError;
    } finally {
      this.savingCredentials = false;
    }
  }

  cancelCredentials() {
    this.credentialsPrompt = null;
  }

  /** Affiche un compte rendu qui s'efface tout seul. */
  private setRemoteStatus(message: string | null) {
    if (this.remoteStatusTimer !== null) clearTimeout(this.remoteStatusTimer);
    this.remoteStatus = message;
    this.remoteStatusTimer =
      message === null
        ? null
        : setTimeout(() => {
            this.remoteStatus = null;
            this.remoteStatusTimer = null;
          }, REMOTE_STATUS_MS);
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
      // Ce commit a pu clore une fusion (le backend appelle `cleanup_state()`
      // dans ce cas) : sans relire `repoInfo`, `merging` resterait bloqué à
      // `true` — `MergeBanner` continuerait d'afficher « fusion en cours »
      // alors qu'elle vient d'être refermée par ce commit même.
      this.repoInfo = await api.getRepoInfo(this.repoId);
      await this.refreshStatus();
      // La branche courante vient de prendre un commit d'avance sur son amont :
      // sans ce rechargement, le compteur resterait figé au moment même où on
      // le regarde.
      await this.loadBranches();
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
  /**
   * L'écran Paramètres occupe-t-il le corps de la fenêtre ?
   *
   * C'est bien ici que ça vit : `TabsStore` décide déjà de ce qu'affiche le
   * corps (`hasTabs` fait apparaître `WelcomeScreen`), et les paramètres sont
   * globaux — les rattacher à un onglet n'aurait aucun sens.
   */
  settingsOpen = $state(false);
  /** Profils d'auteur, partagés par tous les onglets. */
  profiles = $state<Profile[]>([]);
  /**
   * Mode exécuté par le bouton Pull. Préférence **globale** — elle ne dépend pas
   * du dépôt — persistée côté Rust comme les récents et les profils : rien n'est
   * stocké dans le webview dans ce projet.
   */
  pullMode = $state<PullMode>("fastForwardOrMerge");

  get active(): RepoStore | null {
    return this.tabs.find((t) => t.repoId === this.activeId) ?? null;
  }

  get hasTabs(): boolean {
    return this.tabs.length > 0;
  }

  /** Restaure la session persistée (onglets + onglet actif) au démarrage. */
  async init() {
    // Un fetch aboutit en tâche de fond : son résultat porte son `repoId` et doit
    // être routé vers l'onglet concerné, qui n'est pas forcément l'onglet actif.
    // L'abonnement dure toute la vie de l'application, d'où l'absence d'unlisten.
    api
      .onFetched((event) => {
        this.tabs.find((t) => t.repoId === event.repoId)?.onFetched(event);
      })
      .catch(() => {
        /* sans abonnement, le fetch reste lançable mais muet */
      });
    api
      .onPushed((event) => {
        this.tabs.find((t) => t.repoId === event.repoId)?.onPushed(event);
      })
      .catch(() => {
        /* idem pour le push */
      });
    api
      .onPulled((event) => {
        this.tabs.find((t) => t.repoId === event.repoId)?.onPulled(event);
      })
      .catch(() => {
        /* idem pour le pull */
      });

    try {
      this.recent = await api.listRecent();
    } catch {
      this.recent = [];
    }
    await this.loadProfiles();
    await this.loadPullMode();

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

  toggleSettings() {
    this.settingsOpen = !this.settingsOpen;
  }

  closeSettings() {
    this.settingsOpen = false;
  }

  async loadProfiles() {
    try {
      this.profiles = await api.listProfiles();
    } catch {
      this.profiles = [];
    }
  }

  async loadPullMode() {
    try {
      this.pullMode = await api.getPullMode();
    } catch {
      /* préférence illisible : on garde le défaut, ça n'empêche pas de puller */
    }
  }

  /**
   * Change le mode du bouton Pull. L'UI suit tout de suite ; un échec de
   * persistance ne coûte que la survie du choix au prochain démarrage, et
   * remonte dans l'onglet actif s'il y en a un.
   */
  async setPullMode(mode: PullMode) {
    this.pullMode = mode;
    try {
      await api.setPullMode(mode);
    } catch (e) {
      if (this.active) this.active.error = e as AppError;
    }
  }

  /** Ouvre le dialog natif puis ouvre le dépôt choisi dans un onglet. */
  async openFromDialog() {
    const path = await pickRepositoryFolder();
    if (path) await this.open(path);
  }

  /** Ouvre un dépôt (ou active son onglet s'il l'est déjà). */
  async open(path: string) {
    if (this.opening) return;
    // Ouvrir un dépôt, c'est vouloir le voir : les paramètres cèdent la place.
    this.settingsOpen = false;
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
