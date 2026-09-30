import { SvelteSet } from "svelte/reactivity";
import { api, pickRepositoryFolder } from "../api";
import { t } from "../i18n.svelte";
import { countStatuses, type TreeCounts } from "../tree";
import type {
  AppError,
  BranchEntry,
  CommitDetails,
  FetchEvent,
  FileContent,
  FileDiff,
  FileEntry,
  FileSource,
  FileStatus,
  GraphCommit,
  Identity,
  MergeMode,
  MergeReport,
  Profile,
  PullEvent,
  PullMode,
  PushMode,
  PullReport,
  PullRequestEntry,
  PullRequestEvent,
  PushEvent,
  RecentRepo,
  RemoteBranchEntry,
  RemoteInfo,
  RepoChangedEvent,
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

/** Durée d'affichage du compte rendu d'une opération, en millisecondes. */
const OP_STATUS_MS = 6000;

/**
 * Délai avant de réessayer d'appliquer un changement détecté sur le disque
 * pendant qu'une opération de l'application tourne encore.
 *
 * Court : ce qui bloque (un stage, un commit, un pull) se termine, et le
 * changement attend simplement son tour au lieu d'écraser un état en cours de
 * construction.
 */
const CHANGE_RETRY_MS = 400;

/** Compte rendu d'un pull, en une ligne. */
function pullStatus(report: PullReport): string {
  const where = report.remotes.join(", ");
  const o = report.outcome;
  // Une branche tirée sans être la courante est nommée : le compte rendu doit
  // dire *où* les commits sont allés, puisque ce n'est pas sous les pieds.
  const branch = report.branch ?? "";
  switch (o.kind) {
    case "fetchedOnly": {
      const refs = report.updated.length;
      return refs === 0
        ? t("op.fetch.upToDate", { where })
        : t("op.fetch.updated", { where, n: refs });
    }
    case "upToDate":
      return t("op.fetch.upToDate", { where });
    case "fastForwarded":
      return report.switched || !report.branch
        ? t("op.pull.fastForwarded", { where, n: o.commits })
        : t("op.pull.fastForwarded.branch", { where, branch, n: o.commits });
    case "merged":
      return report.switched
        ? t("op.pull.merged.switched", { where, branch, n: o.commits })
        : t("op.pull.merged", { where, n: o.commits });
    case "conflicted":
      return t("op.pull.conflicted", { n: o.files.length });
    case "diverged":
      return t("op.pull.diverged", { ahead: o.ahead, behind: o.behind });
  }
}

/** Compte rendu d'une fusion de branche à branche, en une ligne. */
function mergeStatus(report: MergeReport): string {
  const { source, target } = report;
  const o = report.outcome;
  switch (o.kind) {
    case "upToDate":
      return t("op.merge.upToDate", { source, target });
    case "fastForwarded":
      return t("op.merge.fastForwarded", { source, target, n: o.commits });
    case "merged":
      return t("op.merge.merged", { source, target, n: o.commits });
    case "conflicted":
      return t("op.pull.conflicted", { n: o.files.length });
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
  /**
   * Sorte d'onglet — discriminant du type `Tab`. La barre en accueille trois :
   * un dépôt ouvert, la page « Nouvel onglet » (voir `NewTab`) et les
   * paramètres (voir `SettingsTab`).
   */
  readonly kind = "repo" as const;

  /** Identifiant d'onglet = chemin canonique du dépôt (voir `RepoInfo.path`). */
  readonly repoId: string;

  /** Identifiant d'onglet, commun aux deux sortes : ici le chemin du dépôt. */
  get id(): string {
    return this.repoId;
  }

  repoInfo = $state<RepoInfo | null>(null);
  status = $state<RepoStatus | null>(null);
  diff = $state<FileDiff | null>(null);
  error = $state<AppError | null>(null);
  busy = $state(false);
  committing = $state(false);
  stashing = $state(false);
  /** Vrai tant que le premier chargement du dépôt n'est pas terminé. */
  loaded = $state(false);

  /**
   * Dernier changement détecté sur le disque et pas encore appliqué (voir
   * `noteExternalChange`). Pas de rune : rien ne l'affiche, c'est une file
   * d'attente d'un seul élément — les drapeaux des lots successifs se cumulent
   * jusqu'à ce qu'un rafraîchissement les consomme.
   */
  private pendingChange: { worktree: boolean; refs: boolean } | null = null;
  /** Un rafraîchissement automatique est en cours (réentrance interdite). */
  private applyingChange = false;
  private changeRetry: ReturnType<typeof setTimeout> | null = null;

  constructor(repoId: string, info: RepoInfo | null = null) {
    this.repoId = repoId;
    this.repoInfo = info;
  }

  // Ce qui est actuellement affiché dans le visualiseur de diff.
  diffTarget = $state<DiffTarget | null>(null);

  /**
   * Un Markdown se lit aussi rendu : le choix Code | Preview du visualiseur.
   * Il survit d'un fichier à l'autre — qui lit un README rendu veut lire le
   * suivant de même — mais reste propre à l'onglet, comme la sélection.
   * Sans effet sur un fichier qui n'est pas du Markdown, où seul le code a un
   * sens.
   */
  renderMarkdown = $state(false);
  /**
   * Contenu du fichier affiché, pour l'aperçu. Chargé seulement quand l'aperçu
   * est demandé et que le fichier est du Markdown : le diff, lui, est toujours
   * là — c'est lui qu'on ferme, pas l'aperçu.
   */
  preview = $state<FileContent | null>(null);

  // Fetch et push : la commande rend la main tout de suite, le backend
  // travaillant sur un thread dédié. Ces drapeaux couvrent donc l'aller *et*
  // l'attente du résultat. Deux drapeaux distincts, mais le backend n'en laisse
  // qu'un seul actif à la fois (réservation partagée côté `AppState`).
  fetching = $state(false);
  pushing = $state(false);
  pulling = $state(false);
  /**
   * Question posée avant le premier push d'une branche — GitKraken : « What
   * remote/branch should X push to and pull from? ». Non nul = la barre est
   * affichée, au-dessus des trois colonnes, et rien n'a encore été envoyé. Le
   * mode retenu est celui du geste qui a ouvert la barre (un force sans
   * upstream n'a guère de sens, mais il n'est pas perdu en route).
   */
  upstreamPrompt = $state<{ branch: string; remotes: string[]; mode: PushMode } | null>(
    null,
  );
  /**
   * Compte rendu de la dernière opération, affiché brièvement sous la barre
   * d'actions : fetch, push, pull et fusion de branches. Une seule ligne pour
   * tous, parce qu'on ne lit jamais que le résultat du dernier geste — et parce
   * qu'une fusion, elle, ne se voit pas forcément ailleurs : une avance rapide
   * sur une branche inactive ne déplace qu'une pastille dans le graph.
   */
  opStatus = $state<string | null>(null);
  private opStatusTimer: ReturnType<typeof setTimeout> | null = null;
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
  /**
   * Fusion de branche à branche en cours. Distinct de `checkingOut` : elle en
   * fait peut-être une (une vraie fusion bascule sur la cible), mais elle écrit
   * aussi l'index et le working directory, et peut laisser le dépôt en conflit.
   */
  mergingBranches = $state(false);

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

  /**
   * Brouillon du prochain commit — résumé et description.
   *
   * Il vit ici, et pas dans `CommitBox`, pour deux raisons. La boîte de commit
   * n'est montée qu'une fois pour tous les onglets : un brouillon local
   * suivrait l'utilisateur d'un dépôt à l'autre. Et la rangée « modifications
   * en cours » du graph édite ce **même** résumé — deux champs sur une seule
   * valeur, donc une valeur qui n'appartient à aucun des deux.
   */
  commitSummary = $state("");
  commitBody = $state("");

  /**
   * Brouillon de la prochaine remise, distinct de celui du commit.
   *
   * Deux brouillons plutôt qu'un : le résumé de commit est déjà édité par la
   * rangée « modifications en cours » du graph, où un nom de remise n'a rien à
   * faire, et passer d'un onglet à l'autre écraserait le message en cours de
   * rédaction de l'autre.
   */
  stashSummary = $state("");
  stashBody = $state("");

  // ── Pull requests ───────────────────────────────────────────────────────────
  // Elles ne viennent pas du dépôt mais de l'API d'une forge : rien ici n'est
  // relu du disque, et rien n'est rechargé tout seul — voir `loadPullRequests`.
  pullRequests = $state<PullRequestEntry[]>([]);
  prLoading = $state(false);
  /** Un chargement s'est terminé, avec ou sans succès. */
  prLoaded = $state(false);
  /**
   * Dernière erreur de chargement. Elle vit ici et **pas** dans `error` : la
   * section a de quoi l'afficher chez elle, avec ce qu'il faut faire (saisir un
   * jeton), là où le bandeau global ferait écran au reste de l'application pour
   * une fonctionnalité qui n'a rien empêché.
   */
  prError = $state<AppError | null>(null);
  /** Groupes repliés (les trois sont dépliés par défaut, comme les dossiers). */
  private collapsedPrGroups = new SvelteSet<string>();

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

  /** Le fichier affiché est du Markdown : la bascule Code | Preview a un sens. */
  get selectedIsMarkdown(): boolean {
    const path = this.selectedPath?.toLowerCase() ?? "";
    return path.endsWith(".md") || path.endsWith(".markdown");
  }

  /** L'aperçu est ce qui s'affiche au centre : demandé, et applicable. */
  get showPreview(): boolean {
    return this.renderMarkdown && this.selectedIsMarkdown;
  }

  setRenderMarkdown(on: boolean) {
    this.renderMarkdown = on;
    if (on) void this.loadPreview();
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
    return this.changedPaths.size;
  }

  /**
   * Répartition des changements en cours (✎ modifiés / + ajoutés / − supprimés),
   * pour la pastille de la rangée WIP du graph. Même vocabulaire que les
   * compteurs de dossiers de l'arbre de fichiers, d'où le passage par
   * `countStatuses`.
   *
   * Le total est exactement `changeCount` : un fichier à la fois indexé et
   * modifié dans le working directory n'est compté qu'une fois, avec le statut
   * de l'index — c'est celui qui est calculé par rapport à HEAD, donc celui que
   * la rangée WIP compare.
   */
  get changeCounts(): TreeCounts {
    return countStatuses(this.changedPaths.values());
  }

  /**
   * La section PULL REQUESTS a-t-elle lieu d'exister pour ce dépôt ?
   *
   * Deux échecs seulement la font disparaître, et ce sont les deux qui ne
   * demandent rien à personne : pas de distant du tout, ou un hôte dont on ne
   * sait pas lire les PR. Tout le reste — jeton absent, jeton refusé, réseau
   * coupé — laisse la section en place avec son message : il y a bien des PR,
   * c'est nous qui n'y arrivons pas.
   */
  get prSupported(): boolean {
    const kind = this.prError?.kind;
    return kind !== "ForgeUnsupported" && kind !== "NoRemote";
  }

  isPrGroupOpen(id: string): boolean {
    return !this.collapsedPrGroups.has(id);
  }

  togglePrGroup(id: string) {
    if (this.collapsedPrGroups.has(id)) this.collapsedPrGroups.delete(id);
    else this.collapsedPrGroups.add(id);
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
      // Sans `await` : la forge est au bout du réseau, et l'onglet n'a pas à
      // l'attendre pour être utilisable.
      void this.loadPullRequests();
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
    // Un changement détecté pendant que l'onglet était caché n'a pas été
    // appliqué : seul l'onglet visible se rafraîchit tout seul. Le statut et les
    // branches sont relus de toute façon ci-dessous ; il ne reste à traiter que
    // ce qu'un mouvement de références impose en plus.
    const stale = this.takePendingChange();

    await this.refreshStatus();
    await this.loadBranches();
    await this.loadRemoteBranches();
    // La config du dépôt a pu changer sur le disque pendant qu'on était ailleurs.
    await this.loadIdentity();

    if (stale?.refs) {
      await this.reloadAfterRefs();
    }
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

  // ── Changements venus du disque ─────────────────────────────────────────────

  /**
   * Enregistre un changement détecté sur le disque (`repo://changed`) sans
   * l'appliquer : un éditeur qui enregistre, un `git` lancé au terminal, un
   * autre client. Rien n'a été récupéré du réseau — il n'y a que de la relecture
   * locale à faire.
   *
   * Les lots se **cumulent** au lieu de se remplacer : deux événements séparés
   * peuvent porter l'un le working directory, l'autre les références, et perdre
   * le premier laisserait la moitié de l'interface périmée.
   */
  noteExternalChange(event: RepoChangedEvent) {
    // Avant le premier chargement il n'y a rien à rafraîchir, et `load()` va de
    // toute façon tout lire.
    if (!this.loaded) return;
    this.pendingChange = {
      worktree: (this.pendingChange?.worktree ?? false) || event.worktree,
      refs: (this.pendingChange?.refs ?? false) || event.refs,
    };
  }

  /**
   * Applique le changement en attente. Appelé pour le seul onglet **affiché** —
   * les autres le gardent pour leur activation, qui resynchronise déjà tout.
   *
   * Deux garde-fous, qui sont l'essentiel :
   *
   * - **Rien pendant qu'une opération de l'application tourne.** Un pull écrit
   *   lui-même le working directory : ses propres événements se superposeraient
   *   à son rechargement, et un rafraîchissement au milieu d'un commit lirait un
   *   état à moitié écrit. On repasse un peu plus tard, le changement attendant
   *   son tour.
   * - **La boucle relit `pendingChange` à chaque tour** : un lot arrivé pendant
   *   les `await` est traité au tour suivant plutôt que perdu.
   */
  async applyExternalChange() {
    if (this.applyingChange || !this.pendingChange) return;
    if (this.refreshBlocked) {
      this.retryExternalChange();
      return;
    }

    this.applyingChange = true;
    try {
      let change = this.takePendingChange();
      while (change) {
        // Les infos du dépôt d'abord : c'est `head` et `merging` qui décident de
        // l'en-tête et du bandeau de fusion, et une bascule de branche faite
        // ailleurs ne se voit que là.
        if (change.refs) {
          try {
            this.repoInfo = await api.getRepoInfo(this.repoId);
          } catch (e) {
            this.error = e as AppError;
          }
        }
        if (change.worktree) await this.refreshStatus();
        if (change.refs) await this.reloadAfterRefs();
        change = this.takePendingChange();
      }
    } finally {
      this.applyingChange = false;
    }
  }

  /**
   * Ce qu'un mouvement de références impose de relire : les deux listes de
   * branches — dont les pastilles d'écart se mesurent sur `refs/remotes/**` —,
   * les stashes (`refs/stash` en est une) et le graph, dont la pagination n'est
   * stable que tant que les références ne bougent pas, d'où le retour page 0.
   */
  private async reloadAfterRefs() {
    await this.loadBranches();
    await this.loadRemoteBranches();
    await this.loadStashes();
    await this.loadGraph();
  }

  /** Consomme le changement en attente, `null` s'il n'y en a pas. */
  private takePendingChange(): { worktree: boolean; refs: boolean } | null {
    const change = this.pendingChange;
    this.pendingChange = null;
    return change;
  }

  /**
   * Une opération de l'application est-elle en cours ? Un rafraîchissement
   * automatique attendrait plutôt que de lui passer dessus.
   */
  private get refreshBlocked(): boolean {
    return (
      this.busy ||
      this.committing ||
      this.stashing ||
      this.checkingOut ||
      this.mergingBranches ||
      this.fetching ||
      this.pushing ||
      this.pulling ||
      // Une page d'historique en vol : un retour page 0 au milieu du scroll
      // infini jetterait ce qu'il vient de charger.
      this.graphLoading
    );
  }

  /** Repasse plus tard, sans empiler les minuteries. */
  private retryExternalChange() {
    if (this.changeRetry !== null) return;
    this.changeRetry = setTimeout(() => {
      this.changeRetry = null;
      void this.applyExternalChange();
    }, CHANGE_RETRY_MS);
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
    this.preview = null;
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
   * Sélectionne la rangée « modifications en cours » du graph : la colonne de
   * droite revient au working directory. C'est mot pour mot ce que fait la
   * fermeture du détail de commit — de là que cette sélection n'a pas d'état
   * propre : `GraphView` surligne la rangée quand aucun commit n'est
   * sélectionné, ce qui est exactement la même chose.
   */
  selectWip() {
    this.clearCommitSelection();
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
   * Remise le brouillon (`stashSummary` / `stashBody`) et le vide en cas de
   * succès. Renvoie `false` sans rien tenter si le nom est vide ou s'il n'y a
   * aucune modification — les deux cas que le bouton grise déjà.
   *
   * Le backend remise les fichiers non suivis aussi : le working directory
   * ressort propre, donc `refreshStatus` referme au passage un diff dont le
   * fichier vient de disparaître (`resyncSelection`). L'historique, lui, ne
   * bouge pas — `refs/stash` n'est pas parcouru par le graph — d'où l'absence
   * de rechargement de celui-ci.
   */
  async stash(): Promise<boolean> {
    const summary = this.stashSummary.trim();
    if (summary.length === 0 || this.changeCount === 0) return false;
    this.stashing = true;
    this.error = null;
    try {
      const body = this.stashBody.trim();
      await api.stashSave(this.repoId, summary, body.length > 0 ? body : null);
      this.stashSummary = "";
      this.stashBody = "";
      await this.refreshStatus();
      await this.loadStashes();
      return true;
    } catch (e) {
      this.error = e as AppError;
      return false;
    } finally {
      this.stashing = false;
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
    this.setOpStatus(null);
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
  /**
   * Publie la branche courante.
   *
   * Le mode est un argument, jamais un état : rien ici ne retient qu'un force a
   * eu lieu, et le prochain appel repart de `"normal"`. C'est ce qui empêche le
   * bouton de devenir un force push par inadvertance.
   */
  async push(mode: PushMode = "normal") {
    if (this.busyRemote || !this.repoInfo) return;

    // Premier push d'une branche : rien n'est envoyé avant que la barre
    // d'upstream ait eu sa réponse — vers quel distant, sous quel nom. C'est
    // le suivi qui se décide là (push *et* pull), pas seulement la cible d'un
    // envoi, d'où la question plutôt qu'un choix silencieux. Sans distant du
    // tout, la barre n'aurait rien à proposer : le push part et rapporte
    // `NoRemote`, comme avant.
    const head = this.branches.find((b) => b.isHead);
    if (head && head.upstream === null && this.upstreamPrompt === null) {
      let remotes: string[] = [];
      try {
        remotes = await api.listRemotes(this.repoId);
      } catch {
        /* le push dira ce qui manque */
      }
      if (remotes.length > 0) {
        this.upstreamPrompt = { branch: head.name, remotes, mode };
        return;
      }
    }
    await this.runPush(mode);
  }

  /**
   * Réponse de la barre d'upstream : ce distant, ce nom-là. La barre se ferme
   * avant l'envoi, et le mode choisi au moment du clic sur Push est repris.
   */
  async confirmUpstream(remote: string, target: string) {
    const prompt = this.upstreamPrompt;
    if (!prompt) return;
    this.upstreamPrompt = null;
    await this.runPush(prompt.mode, remote, target.trim());
  }

  cancelUpstream() {
    this.upstreamPrompt = null;
  }

  private async runPush(mode: PushMode, remote?: string, target?: string) {
    if (this.busyRemote || !this.repoInfo) return;
    this.pushing = true;
    this.error = null;
    this.setOpStatus(null);
    try {
      await api.pushBranch(this.repoId, mode, remote, target);
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
  async pull(mode: PullMode, branch?: string) {
    if (this.busyRemote || !this.repoInfo) return;
    this.pullMode = mode;
    this.pullBranch = branch;
    this.pulling = true;
    this.error = null;
    this.setOpStatus(null);
    try {
      await api.pull(this.repoId, mode, branch);
    } catch (e) {
      this.pulling = false;
      this.error = e as AppError;
    }
  }

  /**
   * Mode et branche du dernier pull lancé, mémorisés pour pouvoir le relancer
   * après une saisie d'identifiants — le mode choisi entre-temps n'aurait pas
   * de raison de s'appliquer à une opération déjà décidée.
   */
  private pullMode: PullMode = "fastForwardOrMerge";
  private pullBranch: string | undefined;

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

    this.setOpStatus(pullStatus(event.report));

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

  /**
   * Fusionne une branche locale dans une autre : dépôt d'une branche sur une
   * autre, ou menu contextuel de la section LOCAL. La **cible** reçoit la
   * fusion, qu'elle soit ou non la branche courante — c'est le sens du geste.
   *
   * Aucun réseau ici, contrairement au pull : le rapport revient directement.
   *
   * `mode` vient du menu et n'est pas mémorisé : en `noFastForward`, la fusion
   * est toujours matérialisée par un commit, donc toujours précédée d'une bascule
   * sur la cible.
   *
   * Le rechargement vaut aussi pour un échec, et ce n'est pas une précaution de
   * style : une vraie fusion bascule sur la cible **avant** d'écrire, donc HEAD
   * a pu bouger alors même que l'erreur remonte.
   */
  async mergeBranches(source: string, target: string, mode: MergeMode) {
    if (source === target || this.mergingBranches || this.checkingOut || this.busy) return;
    this.mergingBranches = true;
    this.error = null;
    this.setOpStatus(null);
    try {
      const report = await api.mergeBranches(this.repoId, source, target, mode);
      this.setOpStatus(mergeStatus(report));
      // Le working directory a changé sous la sélection dès que HEAD a bougé ou
      // que des conflits sont apparus : le fichier ouvert n'est plus celui-là.
      if (report.switched || report.outcome.kind === "conflicted") {
        this.diffTarget = null;
        this.diff = null;
      }
    } catch (e) {
      this.error = e as AppError;
    } finally {
      await this.reloadAfterMerge();
      this.mergingBranches = false;
    }
  }

  /**
   * Ce qu'une fusion invalide. Les infos du dépôt d'abord : c'est `merging` qui
   * décide du bandeau de sortie de secours, et `branch` a pu changer. Puis le
   * statut — c'est là qu'apparaissent les fichiers en conflit —, les branches
   * locales (la cible a avancé, son écart avec l'amont aussi) et le graph, dont
   * la pagination n'est plus valable dès qu'une référence a bougé.
   *
   * `refs/remotes/**` et `refs/stash` ne sont pas touchés : rien à recharger de
   * ce côté, contrairement à un pull.
   */
  private async reloadAfterMerge() {
    try {
      this.repoInfo = await api.getRepoInfo(this.repoId);
    } catch (e) {
      this.error = e as AppError;
    }
    await this.refreshStatus();
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
    this.setOpStatus(
      n === 0
        ? t("op.fetch.upToDate", { where: remote })
        : t("op.fetch.updated", { where: remote, n }),
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

    const { remote, branch, target, upstreamSet, forced } = event.report;
    // Une réécriture ne se raconte pas comme une publication : c'est le seul
    // geste de l'application qui puisse retirer des commits d'un serveur. Et
    // une branche publiée sous un autre nom dit lequel — c'est le seul cas où
    // « publiée » ne suffit pas à dire où.
    this.setOpStatus(
      forced
        ? t("op.push.forced", { remote, branch })
        : target !== branch
          ? t("op.push.published.as", { remote, branch, target })
          : upstreamSet
            ? t("op.push.published.upstream", { remote, branch })
            : t("op.push.published", { remote, branch }),
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
    // Une PR a pu être ouverte ou fusionnée entre-temps. C'est le seul moment
    // où on la redemande sans que personne ne l'ait cliqué : quelqu'un vient
    // justement de demander des nouvelles du distant.
    void this.loadPullRequests();
  }

  // ── Pull requests ───────────────────────────────────────────────────────────

  /**
   * Charge les pull requests de la forge. Comme le fetch, le résultat revient
   * par un événement (`repo://pull-requests`) : l'appel réseau tourne sur un
   * thread du backend.
   *
   * **Rien ne l'appelle en boucle** : ouverture de l'onglet, fetch ou push
   * terminé, bouton ↻ de la section, changement du filtre « fermées ». Aucun
   * sondage — une PR n'apparaît pas sur le disque, donc le surveillant de
   * fichiers n'a rien à en dire, et interroger l'API à intervalle régulier
   * grillerait le quota du jeton pour une colonne que personne ne regarde
   * forcément.
   */
  async loadPullRequests() {
    if (this.prLoading || !this.repoInfo) return;
    this.prLoading = true;
    this.prError = null;
    try {
      await api.loadPullRequests(this.repoId);
    } catch (e) {
      // Échec au *lancement* (aucun distant configuré, onglet fermé) : aucun
      // événement ne suivra, c'est donc ici qu'il faut relâcher l'état.
      this.prLoading = false;
      this.prLoaded = true;
      this.prError = e as AppError;
    }
  }

  /** Résultat d'un chargement de pull requests, reçu par événement. */
  onPullRequests(event: PullRequestEvent) {
    this.prLoading = false;
    this.prLoaded = true;
    if (event.error) {
      this.prError = event.error;
      this.pullRequests = [];
      return;
    }
    if (!event.report) return;
    this.pullRequests = event.report.pullRequests;
  }

  /**
   * Clic sur une pull request : sélectionne la tête de sa branche source dans
   * le graph — la branche locale si elle existe, sinon celle du distant.
   *
   * C'est tout ce qu'un clic fait : rien n'est basculé, rien n'est fusionné.
   * Une PR ouverte depuis une machine qu'on n'a pas fetchée n'a aucune
   * référence ici ; le dire vaut mieux que de ne rien faire du tout.
   */
  selectPullRequest(pr: PullRequestEntry) {
    const local = this.branches.find((b) => b.name === pr.sourceBranch);
    const remote =
      local ?? this.remoteBranches.find((b) => b.name.endsWith(`/${pr.sourceBranch}`));
    if (remote?.oid) {
      void this.selectCommit(remote.oid);
      return;
    }
    this.setOpStatus(t("pr.branchMissing", { branch: pr.sourceBranch }));
  }

  /** Ouvre la page web de la PR dans le navigateur du système. */
  async openPullRequest(pr: PullRequestEntry) {
    try {
      await api.openPullRequest(pr.url);
    } catch (e) {
      this.error = e as AppError;
    }
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
          message: t("credentials.none", { url: remote.url }),
          localized: true,
        };
        return;
      }
      if (!remote.usesHttp) {
        // SSH : le jeton du dialogue ne serait jamais utilisé, l'authentification
        // passant par une clé. Mieux vaut dire quoi faire.
        this.error = {
          kind: refused ? "RemoteAuth" : "NoCredentials",
          message: refused
            ? t("credentials.ssh.refused", { host: remote.host })
            : t("credentials.ssh.none", { host: remote.host }),
          // Plus précis que l'entrée du catalogue pour ce `kind` : elle parle du
          // dépôt distant en général, celui-ci dit quoi faire d'une clé SSH.
          localized: true,
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
          ? this.pull(this.pullMode, this.pullBranch)
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

  /** Affiche un compte rendu qui s'efface tout seul (voir `opStatus`). */
  private setOpStatus(message: string | null) {
    if (this.opStatusTimer !== null) clearTimeout(this.opStatusTimer);
    this.opStatus = message;
    this.opStatusTimer =
      message === null
        ? null
        : setTimeout(() => {
            this.opStatus = null;
            this.opStatusTimer = null;
          }, OP_STATUS_MS);
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

  /**
   * Abandonne tous les changements en cours : les fichiers suivis reviennent à
   * HEAD, les non suivis sont supprimés. **Irréversible** — la confirmation est
   * demandée par l'en-tête de la colonne, seul endroit d'où l'action part.
   *
   * La garde est `changeCount`, exactement ce que le bouton affiche et grise :
   * elle couvre les non suivis, que le backend efface aussi.
   *
   * L'historique ne bouge pas (aucun commit créé ni déplacé), donc ni le graph
   * ni les branches ne sont rechargés — mais `repoInfo` l'est, parce qu'une
   * fusion en cours vient d'être refermée et que `merging` décide du bandeau.
   */
  async discardAll() {
    if (this.changeCount === 0) return;
    await this.run(() =>
      api.discardAll(this.repoId).then((info) => {
        this.repoInfo = info;
      }),
    );
  }

  /**
   * Abandonne les changements d'un fichier, ou de tous ceux d'un dossier de
   * l'arbre — le `discardAll` d'une liste de chemins, depuis le menu contextuel
   * de la ligne, seul endroit d'où l'action part. **Irréversible**, confirmé
   * dans le menu même.
   *
   * Prend les entrées et non les chemins : un renommage indexé est *deux*
   * chemins, l'ancien (dans HEAD, à restaurer) et le nouveau (absent de HEAD, à
   * supprimer). Le backend ne connaît que des chemins ; c'est ici que la ligne
   * « R » redevient un seul geste. Un seul appel pour tout le lot, donc un
   * seul refresh.
   *
   * Rien de plus à recharger que le status : aucune fusion n'est refermée par
   * un fichier, `repoInfo` n'a donc pas bougé. Si le fichier du diff est du
   * lot, `resyncSelection` referme la vue en constatant sa disparition.
   */
  async discardFiles(entries: FileEntry[]) {
    const paths = entries.flatMap((e) => (e.oldPath ? [e.path, e.oldPath] : [e.path]));
    if (paths.length === 0) return;
    await this.run(() => api.discardPaths(this.repoId, paths));
  }

  /**
   * Committe le brouillon (`commitSummary` / `commitBody`) et vide celui-ci en
   * cas de succès. Renvoie `false` sans rien tenter si le résumé est vide ou si
   * rien n'est indexé — les deux cas que le bouton grise déjà.
   *
   * `amend` n'a pas d'interface : il reste câblé jusqu'au backend, testé, mais
   * jamais appelé autrement qu'avec la valeur par défaut.
   */
  async commit(amend = false): Promise<boolean> {
    const summary = this.commitSummary.trim();
    if (summary.length === 0) return false;
    if (!amend && !this.hasStaged) return false;
    this.committing = true;
    this.error = null;
    try {
      const body = this.commitBody.trim();
      await api.commit(this.repoId, summary, body.length > 0 ? body : null, amend);
      // Le brouillon est consommé : il est vidé ici, et pas dans la boîte de
      // commit, parce que deux champs l'éditent (elle et la rangée du graph).
      this.commitSummary = "";
      this.commitBody = "";
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

  /**
   * Chemins ayant un changement, avec leur statut — un fichier peut être à la
   * fois indexé et modifié dans le working directory, il ne compte alors qu'une
   * fois. L'index est écrit en dernier et l'emporte : son statut est celui
   * calculé par rapport à HEAD (un fichier neuf indexé puis rouvert est
   * « ajouté », pas « modifié »).
   */
  private get changedPaths(): Map<string, FileStatus> {
    const byPath = new Map<string, FileStatus>();
    for (const e of this.status?.unstaged ?? []) byPath.set(e.path, e.status);
    for (const e of this.status?.untracked ?? []) byPath.set(e.path, e.status);
    for (const e of this.status?.staged ?? []) byPath.set(e.path, e.status);
    return byPath;
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
      this.preview = null;
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
    // L'aperçu suit le diff : même fichier, même source, rechargé avec lui
    // — un refresh du status peut avoir changé le contenu sur le disque.
    await this.loadPreview();
  }

  /**
   * Charge le contenu à rendre, si l'aperçu est demandé et que le fichier est
   * du Markdown ; sinon le vide. La source est celle du diff : l'index pour un
   * fichier indexé, le disque sinon, le commit pour un fichier de commit — un
   * aperçu qui montrerait le disque en regardant l'index mentirait.
   */
  private async loadPreview() {
    const target = this.diffTarget;
    if (!target || !this.showPreview) {
      this.preview = null;
      return;
    }
    const source: FileSource =
      target.kind === "commit"
        ? { kind: "commit", oid: target.oid }
        : target.staged
          ? { kind: "index" }
          : { kind: "worktree" };
    try {
      const content = await api.fileContent(this.repoId, target.path, source);
      // La sélection a pu changer pendant l'aller-retour : ne pas afficher le
      // contenu d'un fichier sous le nom d'un autre.
      if (this.diffTarget === target) this.preview = content;
    } catch (e) {
      this.error = e as AppError;
      this.preview = null;
    }
  }
}

/**
 * Onglet « Nouvel onglet » : la page d'accueil d'un onglet qui n'a pas encore
 * de dépôt derrière lui — ouvrir, cloner, créer, ou reprendre un récent.
 *
 * Il n'existe **que côté frontend**, et c'est délibéré : l'identifiant d'un
 * onglet est le chemin canonique de son dépôt — c'est la clé de `AppState`,
 * celle de `session.json`, et ce que porte `RepoInfo.path`. Sans dépôt il n'y a
 * pas de chemin, donc pas d'identité à faire connaître au backend : son `id`
 * est un simple compteur, jamais envoyé, et il ne survit pas au redémarrage —
 * une page d'accueil n'a rien à restaurer.
 */
export class NewTab {
  readonly kind = "new" as const;
  readonly id: string;

  constructor(id: string) {
    this.id = id;
  }
}

/**
 * Onglet des paramètres. Frontend seul, pour la même raison que `NewTab` : il
 * n'a pas de dépôt, donc pas de chemin à faire connaître au backend, et il n'est
 * pas restauré au lancement.
 *
 * **Un seul à la fois** — d'où un `id` fixe plutôt qu'un compteur : la roue
 * dentée active celui qui existe au lieu d'en ouvrir un second, comme ouvrir un
 * dépôt déjà ouvert active son onglet.
 */
export class SettingsTab {
  readonly kind = "settings" as const;
  readonly id = "settings";
}

/** Ce que la barre affiche : un dépôt ouvert, une page d'accueil, les paramètres. */
export type Tab = RepoStore | NewTab | SettingsTab;

/**
 * Collection des dépôts ouverts — un onglet chacun.
 *
 * Chaque onglet conserve son `RepoStore` en mémoire tant qu'il est ouvert : y
 * revenir est instantané (graph, sélection et scroll intacts), seul le statut du
 * working directory est resynchronisé (voir `RepoStore.activate`).
 */
class TabsStore {
  /** Onglets dans l'ordre d'affichage, dépôts et pages d'accueil mêlés. */
  tabs = $state<Tab[]>([]);
  activeId = $state<string | null>(null);
  /** Compteur des pages « Nouvel onglet » : leur identité s'arrête au webview. */
  private nextNewTabId = 1;
  recent = $state<RecentRepo[]>([]);
  /** Vrai pendant l'ouverture d'un dépôt (dialog ou restauration de session). */
  opening = $state(false);
  /** Erreur d'ouverture — celles propres à un dépôt vivent dans son onglet. */
  openError = $state<AppError | null>(null);
  /** Profils d'auteur, partagés par tous les onglets. */
  profiles = $state<Profile[]>([]);
  /**
   * Mode exécuté par le bouton Pull. Préférence **globale** — elle ne dépend pas
   * du dépôt — persistée côté Rust comme les récents et les profils : rien n'est
   * stocké dans le webview dans ce projet.
   */
  pullMode = $state<PullMode>("fastForwardOrMerge");

  /** Onglets de dépôt seuls — les seuls que le backend connaisse. */
  get repoTabs(): RepoStore[] {
    return this.tabs.filter((t): t is RepoStore => t.kind === "repo");
  }

  /** Onglet affiché, quelle que soit sa sorte. */
  get activeTab(): Tab | null {
    return this.tabs.find((t) => t.id === this.activeId) ?? null;
  }

  /**
   * Dépôt affiché, ou `null` — y compris quand l'onglet courant est une page
   * « Nouvel onglet », qui n'en a pas : le proxy `repo` retombe alors sur
   * `EMPTY_TAB`, et les composants continuent de lire `repo.*` sans garde.
   */
  get active(): RepoStore | null {
    const tab = this.activeTab;
    return tab?.kind === "repo" ? tab : null;
  }

  /** Le corps de la fenêtre affiche-t-il la page « Nouvel onglet » ? */
  get activeIsNew(): boolean {
    return this.activeTab?.kind === "new";
  }

  /** Le corps de la fenêtre affiche-t-il les paramètres ? */
  get activeIsSettings(): boolean {
    return this.activeTab?.kind === "settings";
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
        this.repoTabs.find((t) => t.repoId === event.repoId)?.onFetched(event);
      })
      .catch(() => {
        /* sans abonnement, le fetch reste lançable mais muet */
      });
    api
      .onPushed((event) => {
        this.repoTabs.find((t) => t.repoId === event.repoId)?.onPushed(event);
      })
      .catch(() => {
        /* idem pour le push */
      });
    api
      .onPulled((event) => {
        this.repoTabs.find((t) => t.repoId === event.repoId)?.onPulled(event);
      })
      .catch(() => {
        /* idem pour le pull */
      });
    api
      .onPullRequests((event) => {
        this.repoTabs.find((t) => t.repoId === event.repoId)?.onPullRequests(event);
      })
      .catch(() => {
        /* sans abonnement, la section reste sur « Chargement… » */
      });
    // Changements du disque : personne ne les a demandés, et ils peuvent viser
    // un onglet caché. Seul l'onglet affiché se rafraîchit tout de suite ; les
    // autres gardent la note pour leur activation, qui resynchronise déjà tout
    // — dix dépôts ouverts n'ont pas à relire leur statut à chaque frappe dans
    // un éditeur.
    api
      .onRepoChanged((event) => {
        const tab = this.repoTabs.find((t) => t.repoId === event.repoId);
        if (!tab) return;
        tab.noteExternalChange(event);
        if (this.activeId === event.repoId) void tab.applyExternalChange();
      })
      .catch(() => {
        /* sans abonnement, l'interface se rafraîchit comme avant : à l'activation */
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

    const restored =
      session.active && this.repoTabs.some((t) => t.repoId === session.active);
    await this.activate(restored ? session.active! : (this.tabs[0]?.id ?? null));
  }

  /**
   * Active l'onglet des paramètres, en l'ouvrant en fin de barre s'il n'existe
   * pas encore. Jamais de second exemplaire : voir `SettingsTab`.
   */
  openSettings() {
    const existing = this.tabs.find((t) => t.kind === "settings");
    if (!existing) this.tabs = [...this.tabs, new SettingsTab()];
    void this.activate(existing?.id ?? "settings");
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

  /**
   * Ouvre une page « Nouvel onglet » et bascule dessus. Chaque appui sur « + »
   * en crée une, comme dans un navigateur : elle se ferme, se déplace et
   * s'active comme n'importe quel onglet.
   */
  newTab() {
    const tab = new NewTab(`new:${this.nextNewTabId++}`);
    this.tabs = [...this.tabs, tab];
    void this.activate(tab.id);
  }

  /** Ouvre le dialog natif puis ouvre le dépôt choisi dans un onglet. */
  async openFromDialog() {
    const path = await pickRepositoryFolder();
    if (path) await this.open(path);
  }

  /** Ouvre un dépôt (ou active son onglet s'il l'est déjà). */
  async open(path: string) {
    if (this.opening) return;
    // Ouvert depuis une page « Nouvel onglet » : le dépôt prend sa place au lieu
    // de s'ajouter au bout, et la page disparaît — elle a fait son office.
    const active = this.activeTab;
    const replace = active?.kind === "new" ? active.id : null;
    this.opening = true;
    this.openError = null;
    try {
      const id = await this.openTab(path, { activate: true, replace });
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
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;

    // L'onglet est affiché immédiatement ; le rafraîchissement suit.
    this.activeId = id;
    // Une page d'accueil ou les paramètres n'ont ni statut à resynchroniser ni
    // dépôt à annoncer : la session garde le dernier dépôt actif, qui est bien
    // celui à rouvrir.
    if (tab.kind !== "repo") return;
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
    const from = this.tabs.findIndex((t) => t.id === id);
    if (from === -1) return;
    const to = toIndex > from ? toIndex - 1 : toIndex;
    if (to === from) return;

    const next = [...this.tabs];
    const [tab] = next.splice(from, 1);
    next.splice(to, 0, tab);
    this.tabs = next;

    // Le backend ne garde l'ordre que pour restaurer la session : un échec de
    // persistance ne doit pas annuler le déplacement déjà fait à l'écran. Il ne
    // connaît que les dépôts, donc les autres onglets sont filtrés — l'ordre
    // relatif des autres suffit à le renseigner.
    api.setTabOrder(this.repoTabs.map((t) => t.repoId)).catch(() => {
      /* l'ordre reste correct pour cette session */
    });
  }

  /** Ferme un onglet et bascule sur son voisin. */
  async close(id: string) {
    const index = this.tabs.findIndex((t) => t.id === id);
    if (index === -1) return;
    const tab = this.tabs[index];

    this.tabs = this.tabs.filter((t) => t.id !== id);
    // Une page « Nouvel onglet » ou les paramètres n'existent que dans le
    // webview : rien à fermer en face.
    if (tab.kind === "repo") {
      try {
        await api.closeRepository(id);
      } catch {
        /* l'onglet est retiré de l'UI quoi qu'il arrive */
      }
    }

    if (this.activeId === id) {
      // Voisin de droite, sinon celui de gauche — comme un navigateur.
      const next = this.tabs[index] ?? this.tabs[index - 1] ?? null;
      await this.activate(next?.id ?? null);
    }
  }

  /**
   * Ouvre le dépôt côté backend et crée l'onglet s'il n'existe pas encore.
   * Renvoie l'identifiant d'onglet.
   */
  private async openTab(
    path: string,
    { activate, replace = null }: { activate: boolean; replace?: string | null },
  ): Promise<string> {
    const info = await api.openRepository(path);
    const id = info.path;

    // Emplacement de la page d'accueil qui a demandé l'ouverture, s'il y en a
    // une : le dépôt s'y installe, elle n'a plus lieu d'être.
    const slot =
      replace === null
        ? -1
        : this.tabs.findIndex((t) => t.kind === "new" && t.id === replace);

    const existing = this.repoTabs.find((t) => t.repoId === id);
    if (existing) {
      existing.repoInfo = info;
      // Déjà ouvert ailleurs : on bascule sur cet onglet-là et la page se
      // retire, plutôt que de laisser un doublon derrière soi.
      if (slot !== -1) {
        const next = [...this.tabs];
        next.splice(slot, 1);
        this.tabs = next;
      }
    } else {
      const tab = new RepoStore(id, info);
      if (slot === -1) {
        this.tabs = [...this.tabs, tab];
      } else {
        const next = [...this.tabs];
        next.splice(slot, 1, tab);
        this.tabs = next;
        // Le backend vient d'ajouter le dépôt en fin d'ordre : il ne pouvait pas
        // deviner qu'il s'insérait au milieu de la barre.
        api.setTabOrder(this.repoTabs.map((t) => t.repoId)).catch(() => {
          /* l'ordre reste correct pour cette session */
        });
      }
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
