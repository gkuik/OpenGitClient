import { SvelteSet } from "svelte/reactivity";
import { api, pickRepositoryFolder } from "../api";
import { autoFetchPause, isAutoFetchDue, type AutoFetchPause } from "../autoFetch";
import { autoFetch as autoFetchPref } from "../autoFetch.svelte";
import { t } from "../i18n.svelte";
import { countStatuses, type TreeCounts } from "../tree";
import {
  defaultFlowConfig,
  defaultTag,
  flowBase,
  flowBranchName,
  flowKindOf,
  flowTagged,
  flowTargets,
  resolveTip,
  type FlowKind,
} from "../gitflow";
import type {
  AppError,
  AutoFetchEvent,
  ExternalAppKind,
  BranchEntry,
  CommitDetails,
  FetchEvent,
  FileContent,
  FileDiff,
  FileEntry,
  FileSource,
  FileStatus,
  GitFlowConfig,
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
  RemoteEntry,
  RemoteInfo,
  RepoChangedEvent,
  RepoInfo,
  RepoStatus,
  StashEntry,
  TagEntry,
  TagPushEvent,
  Upstream,
} from "../types";

export type ViewMode = "tree" | "path";

/** Opération distante — celle en cours, ou celle qui a demandé des identifiants. */
export type RemoteOp = "fetch" | "push" | "pull" | "tag";

/**
 * Teneur d'un compte rendu, qui en décide la couleur : `ok` quand quelque
 * chose a bougé comme prévu, `neutral` quand il n'y avait rien à faire,
 * `warn` quand l'opération a abouti mais demande de l'attention (conflit,
 * divergence, identifiants à saisir). Les échecs, eux, vont au bandeau
 * d'erreur ; ils n'ont une teneur que pour l'éclair du bouton et l'onglet.
 */
export type OpTone = "ok" | "neutral" | "warn";
export type Outcome = OpTone | "danger";

/** Un compte rendu, et la couleur qui va avec. */
interface OpReport {
  text: string;
  tone: OpTone;
}

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
 * Durée minimale pendant laquelle la barre montre un auto-fetch : un tour
 * complet de l'icône. Plus court, l'aller-retour d'un fetch sans nouveauté ne
 * serait qu'un clignotement.
 */
const AUTO_FETCH_SHOWN_MS = 1000;

/**
 * Durée de l'éclair ✓ / ! / ✗ sur le bouton qui a lancé l'opération. Court :
 * il dit « c'est fini, et voilà comment », le compte rendu dit le reste.
 */
const FLASH_MS = 1500;

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
function pullStatus(report: PullReport): OpReport {
  return { text: pullText(report), tone: pullTone(report) };
}

/** Rien n'a bougé : neutre ; conflit ou divergence : à regarder. */
function pullTone(report: PullReport): OpTone {
  switch (report.outcome.kind) {
    case "fetchedOnly":
      return report.updated.length === 0 ? "neutral" : "ok";
    case "upToDate":
      return "neutral";
    case "conflicted":
    case "diverged":
      return "warn";
    default:
      return "ok";
  }
}

function pullText(report: PullReport): string {
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
/** Une étape d'un « Finish » Git Flow. */
type FinishStep =
  | { kind: "merge"; target: string }
  | { kind: "tag"; name: string; message: string; on: string }
  | { kind: "delete"; into: string };

/** Erreur construite ici, déjà dans la langue de l'interface. */
function localizedError(message: string): AppError {
  return { kind: "Git", message, localized: true };
}

function mergeStatus(report: MergeReport): OpReport {
  const { source, target } = report;
  const o = report.outcome;
  switch (o.kind) {
    case "upToDate":
      return { text: t("op.merge.upToDate", { source, target }), tone: "neutral" };
    case "fastForwarded":
      return {
        text: t("op.merge.fastForwarded", { source, target, n: o.commits }),
        tone: "ok",
      };
    case "merged":
      return { text: t("op.merge.merged", { source, target, n: o.commits }), tone: "ok" };
    case "conflicted":
      return { text: t("op.pull.conflicted", { n: o.files.length }), tone: "warn" };
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

  /**
   * Nom d'affichage choisi dans les paramètres du dépôt, `null` sans. Connu de
   * l'application seule (`projects.json`) : le dossier n'est pas renommé.
   * Écrit par `TabsStore`, qui détient la table des noms.
   */
  alias = $state<string | null>(null);

  /** Ce que l'onglet et la barre du dépôt affichent : le nom choisi, sinon celui du dossier. */
  get displayName(): string | null {
    return this.alias ?? this.repoInfo?.name ?? null;
  }

  /**
   * Les paramètres du dépôt sont-ils affichés à la place des trois colonnes ?
   * État de l'onglet, comme la sélection : on y revient en revenant sur lui.
   */
  settingsOpen = $state(false);
  /**
   * Distants déclarés, avec leurs URL. `null` tant que les paramètres n'ont pas
   * été ouverts : rien d'autre ne les lit, inutile de les charger avant.
   */
  remoteEntries = $state<RemoteEntry[] | null>(null);

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
   * Auto-fetch en vol (voir *Auto-fetch* plus bas). Hors de `busyRemote`, et
   * c'est délibéré : aucun bouton ne se grise pour lui, personne ne l'a
   * demandé. Un geste distant qui tombe pendant qu'il tourne l'attend.
   */
  autoFetching = $state(false);
  /**
   * Ce que la barre montre de l'auto-fetch : vrai depuis son départ, et au
   * moins `AUTO_FETCH_SHOWN_MS` — un fetch sans rien à ramener répond en
   * quelques centaines de millisecondes, et l'icône qui tourne puis le
   * « Auto-fetching… » ne seraient qu'un clignotement illisible.
   */
  autoFetchShown = $state(false);
  private autoFetchStartedAt = 0;
  private autoFetchShownTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Dernier passage sur le réseau, auto *ou* manuel (ms) : c'est de là que
   * l'échéance se compte, et c'est ce que l'infobulle de Fetch date. `0` tant
   * qu'il n'y en a pas eu — un dépôt qu'on vient d'ouvrir est récupéré au
   * premier tour.
   */
  lastFetchAt = $state(0);
  /**
   * Auto-fetch suspendu pour ce dépôt, et pourquoi : identifiants manquants ou
   * refusés, ou aucun distant. Rien ne se résout tout seul dans ces cas-là ; un
   * fetch ou un pull réussi à la main, une saisie d'identifiants ou un
   * changement des distants le relance. L'infobulle de Fetch le dit.
   */
  autoFetchPause = $state<AutoFetchPause | null>(null);
  /** Se résout à la fin de l'auto-fetch en vol, `null` s'il n'y en a pas. */
  private autoFetchDone: Promise<void> | null = null;
  private autoFetchSettle: (() => void) | null = null;
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
  /** Couleur du compte rendu affiché. */
  opTone = $state<OpTone>("neutral");
  private opStatusTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Éclair de fin sur le bouton qui a lancé l'opération (Pull, Push ou Fetch) :
   * une coche, un point d'exclamation ou une croix, le temps de `FLASH_MS`.
   * Sans lui, un fetch qui ne ramène rien se terminait sans aucun signe.
   */
  flash = $state<{ op: RemoteOp; outcome: Outcome } | null>(null);
  private flashTimer: ReturnType<typeof setTimeout> | null = null;
  /** Issue de la dernière opération distante — ce que l'onglet retient. */
  private lastOutcome: Outcome | null = null;
  /**
   * Une opération distante s'est terminée pendant que l'onglet était caché :
   * sa pastille le dit, dans la couleur de l'issue, jusqu'à ce qu'on y revienne.
   * Les événements sont routés vers leur onglet quel qu'il soit, et sans cette
   * marque un fetch lancé avant de changer d'onglet aboutissait en silence.
   */
  unseenOutcome = $state<Outcome | null>(null);
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
  /**
   * Tags du dépôt (section TAGS). Comme les branches, ils ne bougent que par
   * un geste d'ici, un fetch — qui en ramène — ou un autre outil.
   */
  tags = $state<TagEntry[]>([]);
  /**
   * Création d'un tag demandée depuis le graph : non nul = le dialogue est
   * ouvert sur ce commit. Le résumé n'est là que pour que le dialogue dise
   * *quel* commit reçoit le tag.
   */
  tagPrompt = $state<{ oid: string; shortOid: string; summary: string } | null>(null);
  creatingTag = $state(false);
  /**
   * Publication ou suppression distante d'un tag en cours. Comme fetch, push
   * et pull, le résultat revient par un événement ; la réservation réseau du
   * backend est la même pour les quatre, d'où sa place dans `busyRemote`.
   */
  pushingTag = $state(false);
  /**
   * Création d'une branche demandée : non nul = la barre de saisie recouvre
   * la barre du dépôt. `oid` nul = HEAD (le bouton Branch) ; sinon le commit
   * ou la tête de branche d'où partir (menus du graph et des branches).
   * `from` est ce que la barre affiche pour dire d'où part la branche.
   */
  /**
   * Barre de création d'une branche. `flow` en fait une branche Git Flow : le
   * préfixe est imposé, et seul le nom se tape.
   */
  branchPrompt = $state<{ oid: string | null; from: string; flow?: FlowKind } | null>(null);
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
      await this.loadTags();
      await this.loadStashes();
      await this.loadIdentity();
      // Avant le graph : c'est elle qui décide de la disposition des colonnes,
      // et le graph ne doit pas se dessiner deux fois.
      await this.loadGitFlow();
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
    // On y est : ce qui s'est terminé en notre absence est vu.
    this.unseenOutcome = null;
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
    await this.loadTags();
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
   * les tags, les stashes (`refs/stash` en est une) et le graph, dont la
   * pagination n'est stable que tant que les références ne bougent pas, d'où le
   * retour page 0.
   */
  private async reloadAfterRefs() {
    await this.loadBranches();
    await this.loadRemoteBranches();
    await this.loadTags();
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
      this.creatingTag ||
      this.pushingTag ||
      this.checkingOut ||
      this.mergingBranches ||
      this.flowRunning ||
      this.fetching ||
      this.pushing ||
      this.pulling ||
      // Il écrit `refs/remotes/**` : relire pendant ce temps lirait un état à
      // moitié écrit, et son propre résultat demande de toute façon la relecture.
      this.autoFetching ||
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
  async stash(fallback = ""): Promise<boolean> {
    const summary = this.stashSummary.trim() || fallback;
    if (summary.length === 0 || this.changeCount === 0) return false;
    this.stashing = true;
    this.error = null;
    try {
      const body = this.stashBody.trim();
      await api.stashSave(this.repoId, summary, body.length > 0 ? body : null);
      this.stashSummary = "";
      this.stashBody = "";
      this.setOpStatus(t("op.stash.saved", { name: summary }), "ok");
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
   * Bouton Stash de la barre du dépôt : remise **tout de suite**, sans rien
   * demander, comme chez GitKraken. Le nom est celui en cours de rédaction dans
   * l'onglet Stash de la boîte de commit s'il y en a un — qui l'a tapé puis
   * clique ici veut ce nom-là —, sinon celui que Git donnerait lui-même,
   * « WIP on <branche> ».
   */
  async quickStash() {
    if (this.stashing || this.changeCount === 0) return;
    await this.stash(t("stash.default", { branch: this.repoInfo?.branch ?? "HEAD" }));
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
  private async runCheckout(call: () => Promise<RepoInfo>): Promise<boolean> {
    if (this.checkingOut || this.busy) return false;
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
      return true;
    } catch (e) {
      this.error = e as AppError;
      return false;
    } finally {
      this.checkingOut = false;
    }
  }

  // ── Création de branche ─────────────────────────────────────────────────────

  /**
   * Ouvre la barre de création d'une branche. Sans argument, elle part de
   * HEAD — le bouton Branch de la barre du dépôt ; les menus du graph et des
   * branches passent le commit d'où partir et le nom à afficher.
   *
   * Elle occupe la place de la barre d'upstream : les deux ne peuvent pas être
   * ouvertes ensemble.
   */
  askBranch(start?: { oid: string; from: string; flow?: FlowKind }) {
    this.upstreamPrompt = null;
    this.finishPrompt = null;
    this.branchPrompt = start ?? {
      oid: null,
      from: this.repoInfo?.branch ?? "HEAD",
    };
  }

  cancelBranch() {
    this.branchPrompt = null;
  }

  /**
   * Crée la branche et bascule dessus. Même rechargement qu'une bascule, d'où
   * `runCheckout`. En cas d'échec — nom pris, nom invalide, modifications qui
   * seraient écrasées — la barre reste ouverte : le nom se corrige sur place,
   * et le bandeau dit pourquoi.
   */
  async createBranch(name: string) {
    const prompt = this.branchPrompt;
    if (!prompt) return;
    const branch = prompt.flow ? flowBranchName(prompt.flow, name) : name.trim();
    const ok = await this.runCheckout(() =>
      api.createBranch(this.repoId, branch, prompt.oid),
    );
    if (!ok) return;
    this.branchPrompt = null;
    this.setOpStatus(t("op.branch.created", { branch }), "ok");
  }

  // ── Tags ────────────────────────────────────────────────────────────────────

  async loadTags() {
    if (!this.repoInfo) return;
    try {
      this.tags = await api.listTags(this.repoId);
    } catch (e) {
      this.error = e as AppError;
    }
  }

  /**
   * Ouvre le dialogue de création d'un tag sur ce commit — l'entrée du menu
   * contextuel d'une rangée du graph, seul endroit d'où l'action part.
   */
  askTag(commit: GraphCommit) {
    this.tagPrompt = {
      oid: commit.oid,
      shortOid: commit.shortOid,
      summary: commit.summary,
    };
  }

  /**
   * Même dialogue, sur HEAD — le bouton Tag de la barre. Le résumé vient du
   * graph quand HEAD y est déjà chargé ; sinon le dialogue montre l'oid seul,
   * ce qui suffit à dire où le tag va se poser.
   */
  askTagAtHead() {
    const oid = this.repoInfo?.head;
    if (!oid) return;
    const commit = this.graph.find((c) => c.oid === oid);
    this.tagPrompt = {
      oid,
      shortOid: commit?.shortOid ?? oid.slice(0, 7),
      summary: commit?.summary ?? "",
    };
  }

  /** Montre le dossier du dépôt dans le Finder (bouton de la barre). */
  async revealInFinder() {
    try {
      await api.revealRepository(this.repoId);
    } catch (e) {
      this.error = e as AppError;
    }
  }

  /** Ouvre le dossier du dépôt dans l'éditeur ou le terminal choisi. */
  async openIn(kind: ExternalAppKind) {
    try {
      await api.openRepositoryIn(this.repoId, kind);
    } catch (e) {
      this.error = e as AppError;
    }
  }

  /** Ouvre la page du dépôt sur sa forge (bouton de la barre). */
  async openOnForge() {
    try {
      await api.openRepositoryPage(this.repoId);
    } catch (e) {
      this.error = e as AppError;
    }
  }

  cancelTag() {
    this.tagPrompt = null;
  }

  /**
   * Crée le tag demandé par le dialogue : annoté si un message est donné, léger
   * sinon. Renvoie `false` en cas d'échec, le dialogue restant alors ouvert —
   * un nom déjà pris se corrige sur place, sans tout ressaisir.
   *
   * Aucun commit ne bouge : seuls la liste des tags et les pastilles du graph
   * sont à relire, et le graph repart de la page 0 comme après tout mouvement
   * de références.
   */
  async createTag(name: string, message: string): Promise<boolean> {
    const prompt = this.tagPrompt;
    if (!prompt || this.creatingTag) return false;
    this.creatingTag = true;
    this.error = null;
    try {
      const text = message.trim();
      await api.createTag(this.repoId, name.trim(), prompt.oid, text.length > 0 ? text : null);
      this.tagPrompt = null;
      await this.loadTags();
      await this.loadGraph();
      return true;
    } catch (e) {
      this.error = e as AppError;
      return false;
    } finally {
      this.creatingTag = false;
    }
  }

  /** Supprime un tag **local** (menu contextuel, confirmé dans le menu même). */
  async deleteTag(name: string) {
    await this.run(() => api.deleteTag(this.repoId, name));
    await this.loadTags();
    await this.loadGraph();
  }

  /**
   * Bascule sur le commit d'un tag, HEAD détaché (double-clic dans la section
   * TAGS). Ce qu'un checkout invalide ne dépend pas de ce qui l'a demandé :
   * même corps que pour une branche.
   */
  async checkoutTag(name: string) {
    await this.runCheckout(() => api.checkoutTag(this.repoId, name));
  }

  /**
   * Tag en cours de publication ou de suppression distante, retenu pour le
   * relancer après une saisie d'identifiants — comme le mode d'un pull.
   */
  private tagPush: { name: string; remove: boolean } | null = null;

  /**
   * Publie un tag sur le distant, ou l'en supprime (`remove`). Le résultat
   * revient par `repo://tag-pushed`, comme celui d'un push.
   */
  async pushTag(name: string, remove = false) {
    if (this.busyRemote || !this.repoInfo) return;
    this.tagPush = { name, remove };
    this.pushingTag = true;
    this.error = null;
    this.setOpStatus(null);
    try {
      await this.waitAutoFetch();
      await api.pushTag(this.repoId, name, remove);
    } catch (e) {
      this.pushingTag = false;
      this.error = e as AppError;
      this.finish("tag", "danger");
    }
  }

  /**
   * Résultat d'un push de tag, reçu par événement. Rien à recharger : aucune
   * référence locale n'a bougé, le tag local est tel qu'il était.
   */
  onTagPushed(event: TagPushEvent) {
    this.pushingTag = false;
    if (event.error) {
      if (event.error.kind === "NoCredentials" || event.error.kind === "RemoteAuth") {
        void this.askCredentials(event.error.kind === "RemoteAuth", "tag");
        // Pas un échec, mais pas un succès : une saisie attend.
        this.finish("tag", "warn");
        return;
      }
      this.error = event.error;
      this.finish("tag", "danger");
      return;
    }
    if (!event.report) return;
    const { remote, tag, deleted } = event.report;
    this.setOpStatus(
      deleted ? t("op.tag.deleted", { remote, tag }) : t("op.tag.pushed", { remote, tag }),
      "ok",
    );
    this.finish("tag", "ok");
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

  /**
   * Écrit une identité saisie à la main dans la config locale du dépôt — celle
   * d'aucun profil. Renvoie l'erreur plutôt que de la poser dans le bandeau :
   * le formulaire qui l'a demandée reste ouvert et l'affiche lui-même.
   */
  async setCustomIdentity(name: string, email: string): Promise<AppError | null> {
    try {
      this.identity = await api.setIdentity(this.repoId, name.trim(), email.trim());
      return null;
    } catch (e) {
      return e as AppError;
    }
  }

  // ── Git Flow ────────────────────────────────────────────────────────────────

  /**
   * Réglages Git Flow enregistrés, `null` s'il n'y en a jamais eu. Propres à
   * l'application (`projects.json`), comme le nom d'affichage.
   */
  gitFlow = $state<GitFlowConfig | null>(null);

  /**
   * Réglages en vigueur : ceux enregistrés, sinon ceux qu'on proposerait —
   * déduits des branches locales, et désactivés.
   */
  get flowConfig(): GitFlowConfig {
    return this.gitFlow ?? defaultFlowConfig(this.branches.map((b) => b.name));
  }

  get flowEnabled(): boolean {
    return this.gitFlow?.enabled === true;
  }

  /** Sorte de la branche courante (`feature/x` → feature), Git Flow actif ou non. */
  get currentFlowKind(): FlowKind | null {
    return flowKindOf(this.repoInfo?.branch);
  }

  async loadGitFlow() {
    try {
      this.gitFlow = await api.getGitFlow(this.repoId);
    } catch {
      /* réglages illisibles : Git Flow reste éteint, le graph comme avant */
    }
  }

  /** Enregistre les réglages ; l'erreur revient au formulaire, comme ailleurs. */
  async saveGitFlow(config: GitFlowConfig): Promise<AppError | null> {
    try {
      this.gitFlow = await api.setGitFlow(this.repoId, config);
      return null;
    } catch (e) {
      return e as AppError;
    }
  }

  /**
   * Ouvre la barre de création d'une branche de travail, au départ de sa
   * branche pérenne (`develop`, ou `main` pour un hotfix) — jamais de HEAD :
   * c'est la règle de Git Flow. La locale si elle existe, la distante sinon.
   */
  askFlowBranch(kind: FlowKind) {
    const base = flowBase(kind, this.flowConfig);
    const tip = resolveTip(base, this.branches, this.remoteBranches);
    if (!tip) {
      this.error = localizedError(t("flow.noBase", { branch: base }));
      return;
    }
    this.askBranch({ oid: tip.oid, from: tip.from, flow: kind });
  }

  /**
   * Barre de fin d'une branche de travail : ce qui va se passer, et le tag
   * pour une release ou un hotfix. Rien n'est fait avant sa validation.
   */
  finishPrompt = $state<{ kind: FlowKind; branch: string; targets: string[]; tag: string | null } | null>(
    null,
  );

  /**
   * « Finish » en cours : la branche, et les étapes qui restent. Il survit à
   * un conflit — la fusion s'arrête, on résout, on committe, et `commit()`
   * relance la suite. Abandonner la fusion l'abandonne aussi.
   */
  flowFinish = $state<{ kind: FlowKind; branch: string; steps: FinishStep[] } | null>(null);
  /** Une étape du « Finish » s'exécute. */
  flowRunning = $state(false);

  askFinish() {
    const branch = this.repoInfo?.branch;
    const kind = flowKindOf(branch);
    if (!branch || !kind) return;
    this.upstreamPrompt = null;
    this.branchPrompt = null;
    this.finishPrompt = {
      kind,
      branch,
      targets: flowTargets(kind, this.flowConfig),
      tag: flowTagged(kind) ? defaultTag(branch) : null,
    };
  }

  cancelFinish() {
    this.finishPrompt = null;
  }

  /**
   * Termine la branche de travail courante, comme `git flow <sorte> finish` :
   * fusion `--no-ff` dans chaque cible (production d'abord pour une release ou
   * un hotfix, tag posé là), puis suppression de la branche locale. Chaque
   * fusion bascule sur sa cible ; on finit donc sur `develop`.
   *
   * Le tag est facultatif : un champ vidé n'en pose pas.
   */
  async finishFlow(tag: string | null, message: string) {
    const prompt = this.finishPrompt;
    if (!prompt || this.flowRunning) return;
    this.finishPrompt = null;
    const steps: FinishStep[] = [];
    prompt.targets.forEach((target, i) => {
      steps.push({ kind: "merge", target });
      if (i === 0 && tag?.trim()) {
        steps.push({ kind: "tag", name: tag.trim(), message: message.trim(), on: target });
      }
    });
    steps.push({ kind: "delete", into: prompt.targets[prompt.targets.length - 1] });
    this.flowFinish = { kind: prompt.kind, branch: prompt.branch, steps };
    await this.runFinish();
  }

  /**
   * Exécute les étapes restantes du « Finish ». Chacune est sans effet si elle
   * a déjà eu lieu — une fusion déjà faite rend « à jour », un tag identique
   * est sauté —, ce qui permet de relancer un « Finish » interrompu par une
   * erreur depuis la branche, sans rien refaire en double.
   */
  private async runFinish() {
    const finish = this.flowFinish;
    if (!finish || this.flowRunning) return;
    this.flowRunning = true;
    this.error = null;
    this.setOpStatus(null);
    const { branch } = finish;
    try {
      while (finish.steps.length > 0) {
        const step = finish.steps[0];
        if (step.kind === "merge") {
          const report = await api.mergeBranches(this.repoId, branch, step.target, "noFastForward");
          finish.steps.shift();
          if (report.outcome.kind === "conflicted") {
            // La suite attend le commit de résolution (voir `commit()`).
            this.diffTarget = null;
            this.diff = null;
            this.setOpStatus(
              t("flow.finish.conflict", { target: step.target, n: report.outcome.files.length }),
              "warn",
            );
            return;
          }
        } else if (step.kind === "tag") {
          const target = (await api.listBranches(this.repoId)).find((b) => b.name === step.on);
          if (!target?.oid) throw localizedError(t("flow.noBase", { branch: step.on }));
          const existing = (await api.listTags(this.repoId)).find((tg) => tg.name === step.name);
          // Déjà posé au bon endroit : un « Finish » relancé ne le refait pas.
          if (!existing || existing.oid !== target.oid) {
            await api.createTag(this.repoId, step.name, target.oid, step.message || null);
          }
          finish.steps.shift();
        } else {
          // Une fusion « à jour » ne bascule pas : on peut être resté sur la
          // branche, qu'on ne peut pas supprimer sous ses propres pieds.
          const info = await api.getRepoInfo(this.repoId);
          if (info.branch === branch) await api.checkoutBranch(this.repoId, step.into);
          await api.deleteBranch(this.repoId, branch, step.into);
          finish.steps.shift();
        }
      }
      this.flowFinish = null;
      this.setOpStatus(t(`flow.finished.${finish.kind}`, { branch }), "ok");
    } catch (e) {
      // Interrompu : rien n'est perdu, chaque étape faite l'est pour de bon,
      // et un nouveau « Finish » depuis la branche reprendrait sans doublon.
      this.flowFinish = null;
      this.error = e as AppError;
    } finally {
      this.flowRunning = false;
      await this.reloadAfterMerge();
      await this.loadTags();
    }
  }

  // ── Paramètres du dépôt ─────────────────────────────────────────────────────

  /** Affiche les paramètres du dépôt et relit ce qu'ils montrent. */
  openSettings() {
    this.settingsOpen = true;
    // La config a pu être changée par un autre outil depuis la dernière fois :
    // le surveillant de fichiers ne regarde pas `.git/config`.
    void this.loadRemoteEntries();
    void this.loadIdentity();
  }

  closeSettings() {
    this.settingsOpen = false;
  }

  async loadRemoteEntries() {
    if (!this.repoInfo) return;
    try {
      this.remoteEntries = await api.listRemoteEntries(this.repoId);
    } catch (e) {
      this.error = e as AppError;
    }
  }

  /**
   * Déclare un distant. Comme toutes les écritures de cette section, renvoie
   * l'erreur au formulaire plutôt qu'au bandeau : il reste ouvert pour qu'on
   * corrige un nom pris sur place.
   */
  async addRemote(name: string, url: string): Promise<AppError | null> {
    return this.writeRemotes(() => api.addRemote(this.repoId, name, url));
  }

  /**
   * Renomme un distant et/ou change son URL. Le renommage d'abord : l'URL est
   * ensuite écrite sous le nouveau nom.
   */
  async editRemote(name: string, newName: string, url: string): Promise<AppError | null> {
    const current = this.remoteEntries?.find((r) => r.name === name);
    return this.writeRemotes(async () => {
      let entries: RemoteEntry[] | null = null;
      const target = newName.trim();
      if (target !== name) entries = await api.renameRemote(this.repoId, name, target);
      if (url.trim() !== current?.url) {
        entries = await api.setRemoteUrl(this.repoId, target, url);
      }
      return entries ?? this.remoteEntries ?? [];
    });
  }

  async deleteRemote(name: string): Promise<AppError | null> {
    return this.writeRemotes(() => api.deleteRemote(this.repoId, name));
  }

  /**
   * Écriture dans les distants, puis ce qu'elle invalide. Renommer ou retirer
   * un distant déplace `refs/remotes/**` et l'amont des branches locales ; en
   * ajouter un change la forge derrière les pull requests. C'est exactement ce
   * que recharge un fetch qui a fait bouger quelque chose.
   */
  private async writeRemotes(write: () => Promise<RemoteEntry[]>): Promise<AppError | null> {
    let error: AppError | null = null;
    // Renommer ou retirer un distant est refusé pendant une opération réseau :
    // un auto-fetch qui tourne n'a pas à faire échouer le formulaire.
    await this.waitAutoFetch();
    // Un distant ajouté, renommé ou corrigé : ce qui suspendait l'auto-fetch
    // (aucun distant, une URL qui demandait des identifiants) a pu changer.
    this.autoFetchPause = null;
    try {
      this.remoteEntries = await write();
    } catch (e) {
      error = e as AppError;
      // Un renommage réussi suivi d'une URL refusée a tout de même changé la
      // liste : on la relit plutôt que de garder une version périmée.
      await this.loadRemoteEntries();
    }
    await this.reloadRemoteRefs();
    return error;
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
      await this.waitAutoFetch();
      await api.fetchRemote(this.repoId);
    } catch (e) {
      // Échec au *lancement* (onglet fermé, opération déjà en cours) : aucun
      // événement ne suivra, c'est donc ici qu'il faut relâcher l'état.
      this.fetching = false;
      this.error = e as AppError;
      this.finish("fetch", "danger");
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
        this.branchPrompt = null;
        this.finishPrompt = null;
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
      await this.waitAutoFetch();
      await api.pushBranch(this.repoId, mode, remote, target);
    } catch (e) {
      this.pushing = false;
      this.error = e as AppError;
      this.finish("push", "danger");
    }
  }

  /** Une opération distante est en cours : la seconde attendrait de toute façon. */
  get busyRemote(): boolean {
    return this.fetching || this.pushing || this.pulling || this.pushingTag;
  }

  /**
   * L'opération distante qui tourne, s'il y en a une. Le backend n'en laisse
   * passer qu'une à la fois par dépôt : c'est ce qui permet de n'animer que le
   * bouton qui l'a lancée, les deux autres se grisant simplement.
   */
  get runningOp(): RemoteOp | null {
    if (this.fetching) return "fetch";
    if (this.pushing) return "push";
    if (this.pulling) return "pull";
    if (this.pushingTag) return "tag";
    return null;
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
      await this.waitAutoFetch();
      await api.pull(this.repoId, mode, branch);
    } catch (e) {
      this.pulling = false;
      this.error = e as AppError;
      this.finish("pull", "danger");
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
    // Tout pull commence par un fetch : l'auto-fetch repart de là.
    this.lastFetchAt = Date.now();
    if (event.error) {
      if (event.error.kind === "NoCredentials" || event.error.kind === "RemoteAuth") {
        void this.askCredentials(event.error.kind === "RemoteAuth", "pull");
        // Pas un échec, mais pas un succès : une saisie attend.
        this.finish("pull", "warn");
        return;
      }
      this.error = event.error;
      this.finish("pull", "danger");
      return;
    }
    if (!event.report) return;
    this.autoFetchPause = null;

    const report = pullStatus(event.report);
    this.setOpStatus(report.text, report.tone);
    this.finish("pull", report.tone);

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
    // Abandonner la fusion abandonne le « Finish » qui l'avait lancée : ce qui
    // restait à faire n'a plus de sens sans elle.
    if (this.flowFinish) {
      this.flowFinish = null;
      this.setOpStatus(t("flow.finish.aborted"), "warn");
    }
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
      const status = mergeStatus(report);
      this.setOpStatus(status.text, status.tone);
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
    this.lastFetchAt = Date.now();
    if (event.error) {
      // Ces deux cas ne sont pas des échecs à afficher tels quels : ils appellent
      // une saisie. Le bandeau d'erreur ne servirait qu'à faire écran au dialogue.
      if (event.error.kind === "NoCredentials" || event.error.kind === "RemoteAuth") {
        void this.askCredentials(event.error.kind === "RemoteAuth", "fetch");
        // Pas un échec, mais pas un succès : une saisie attend.
        this.finish("fetch", "warn");
        return;
      }
      this.error = event.error;
      this.finish("fetch", "danger");
      return;
    }
    if (!event.report) return;
    this.autoFetchPause = null;

    const { remote, updated } = event.report;
    const n = updated.length;
    const tone: OpTone = n === 0 ? "neutral" : "ok";
    this.setOpStatus(
      n === 0
        ? t("op.fetch.upToDate", { where: remote })
        : t("op.fetch.updated", { where: remote, n }),
      tone,
    );
    this.finish("fetch", tone);

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
        // Pas un échec, mais pas un succès : une saisie attend.
        this.finish("push", "warn");
        return;
      }
      this.error = event.error;
      this.finish("push", "danger");
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
      "ok",
    );
    this.finish("push", "ok");

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
    // Un fetch ramène aussi les tags qui désignent des commits récupérés.
    await this.loadTags();
    await this.loadGraph();
    // Une PR a pu être ouverte ou fusionnée entre-temps. C'est le seul moment
    // où on la redemande sans que personne ne l'ait cliqué : quelqu'un vient
    // justement de demander des nouvelles du distant.
    void this.loadPullRequests();
  }

  // ── Auto-fetch ──────────────────────────────────────────────────────────────

  /**
   * L'auto-fetch de ce dépôt est-il dû ? `TabsStore` le demande à chaque tour
   * de sa minuterie, pour l'onglet affiché seulement.
   *
   * Jamais par-dessus une opération de l'application — distante ou non : un
   * commit, une fusion, une page d'historique en vol (`refreshBlocked`) —, ni
   * sous le dialogue d'identifiants, ni une fois suspendu. Le tour suivant
   * repassera : rien n'est perdu à attendre quelques secondes.
   */
  autoFetchDue(minutes: number, now: number): boolean {
    return (
      this.loaded &&
      this.repoInfo !== null &&
      this.autoFetchPause === null &&
      !this.busyRemote &&
      !this.refreshBlocked &&
      this.credentialsPrompt === null &&
      isAutoFetchDue(this.lastFetchAt, now, minutes)
    );
  }

  /**
   * Lance l'auto-fetch : tous les distants, en tâche de fond. Rien ne se grise
   * ni ne s'allume — personne n'a cliqué —, seule l'icône de Fetch tourne
   * (`autoFetchShown`). Le résultat revient par `repo://auto-fetched`.
   */
  async autoFetch() {
    this.autoFetching = true;
    this.autoFetchStartedAt = Date.now();
    if (this.autoFetchShownTimer !== null) clearTimeout(this.autoFetchShownTimer);
    this.autoFetchShownTimer = null;
    this.autoFetchShown = true;
    // L'échéance se compte depuis le départ : un serveur lent ne doit pas
    // décaler l'intervalle, ni un échec le faire réessayer en boucle.
    this.lastFetchAt = Date.now();
    this.autoFetchDone = new Promise((resolve) => (this.autoFetchSettle = resolve));
    try {
      await api.autoFetch(this.repoId);
    } catch {
      // Échec au lancement (une opération réseau partie entre-temps, onglet
      // fermé) : aucun événement ne suivra. On réessaiera à l'échéance.
      this.endAutoFetch();
    }
  }

  /**
   * Résultat d'un auto-fetch. Ne montre que ce qui a bougé — l'éclair de Fetch
   * et un compte rendu —, jamais « rien de neuf », qui reviendrait chaque
   * minute. Une erreur qui ne passera pas toute seule suspend l'auto-fetch du
   * dépôt, et se dit une fois si elle attend l'utilisateur ; les autres sont
   * oubliées jusqu'à la prochaine échéance. Renvoie `true` si des références ont bougé — c'est
   * `TabsStore` qui sait si l'onglet est affiché, donc s'il faut relire tout de
   * suite.
   */
  onAutoFetched(event: AutoFetchEvent): boolean {
    this.endAutoFetch();
    const error = event.error ?? event.report?.error ?? null;
    const pause = error ? autoFetchPause(error.kind) : null;
    if (pause) {
      // Dit une fois, au moment où il s'arrête — pas à chaque échéance, il n'y
      // en a plus. Un dépôt sans distant, lui, n'a rien à se faire reprocher.
      if (pause === "credentials" && this.autoFetchPause === null && !this.busyRemote) {
        this.setOpStatus(t("op.autoFetch.paused"), "warn");
      }
      this.autoFetchPause = pause;
    }

    const updated = event.report?.updated ?? [];
    if (updated.length === 0) return false;

    // Le seul cas qui se montre : quelque chose a bougé sur un distant. Pas
    // quand un geste de l'utilisateur tourne — c'est son bouton qui parle, et
    // son compte rendu arrivera juste après.
    if (!this.busyRemote) {
      const remotes = event.report!.remotes;
      const moved = remotes.filter((r) => updated.some((u) => u.name.startsWith(`refs/remotes/${r}/`)));
      // Des tags seuls ne disent pas de quel distant ils viennent : tous.
      const where = (moved.length > 0 ? moved : remotes).join(", ");
      this.setOpStatus(t("op.autoFetch.updated", { where, n: updated.length }), "ok");
      this.finish("fetch", "ok");
    }

    // Le chemin des changements venus du disque, pas celui du Fetch : c'est
    // lui qui sait attendre qu'une opération en cours se termine, qui ne relit
    // l'onglet que s'il est affiché, et qui fusionne cette relecture avec celle
    // que le watcher demandera pour les mêmes `refs/remotes/**`.
    this.noteExternalChange({ repoId: this.repoId, worktree: false, refs: true });
    // Une PR a pu s'ouvrir ou se fermer : la branche qui vient de bouger en est
    // souvent la raison. Rien de redemandé quand rien n'a bougé.
    void this.loadPullRequests();
    return true;
  }

  private endAutoFetch() {
    this.autoFetching = false;
    this.autoFetchSettle?.();
    this.autoFetchSettle = null;
    this.autoFetchDone = null;
    const left = AUTO_FETCH_SHOWN_MS - (Date.now() - this.autoFetchStartedAt);
    if (left <= 0) {
      this.autoFetchShown = false;
      return;
    }
    this.autoFetchShownTimer = setTimeout(() => {
      this.autoFetchShownTimer = null;
      this.autoFetchShown = false;
    }, left);
  }

  /**
   * Un geste distant tombé pendant un auto-fetch l'attend plutôt que d'échouer
   * en `NetworkBusy` : le backend n'en laisse passer qu'un par dépôt, et un
   * clic sur Pull ne doit pas se solder par une erreur pour une opération que
   * personne n'a vue partir. Le bouton, lui, s'allume dès le clic.
   */
  private async waitAutoFetch() {
    if (this.autoFetchDone) await this.autoFetchDone;
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
    this.setOpStatus(t("pr.branchMissing", { branch: pr.sourceBranch }), "warn");
  }

  /** Ouvre la page web de la PR dans le navigateur du système. */
  async openPullRequest(pr: PullRequestEntry) {
    try {
      await api.openForgePage(pr.url);
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
      this.autoFetchPause = null;
      await (prompt.op === "push"
        ? this.push()
        : prompt.op === "pull"
          ? this.pull(this.pullMode, this.pullBranch)
          : prompt.op === "tag" && this.tagPush
            ? this.pushTag(this.tagPush.name, this.tagPush.remove)
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
  private setOpStatus(message: string | null, tone: OpTone = "neutral") {
    if (this.opStatusTimer !== null) clearTimeout(this.opStatusTimer);
    this.opStatus = message;
    this.opTone = tone;
    this.opStatusTimer =
      message === null
        ? null
        : setTimeout(() => {
            this.opStatus = null;
            this.opStatusTimer = null;
          }, OP_STATUS_MS);
  }

  /**
   * Fin d'une opération distante : l'éclair sur son bouton, et l'issue que
   * l'onglet retiendra s'il n'est pas affiché (voir `markUnseen`).
   */
  private finish(op: RemoteOp, outcome: Outcome) {
    this.lastOutcome = outcome;
    if (this.flashTimer !== null) clearTimeout(this.flashTimer);
    this.flash = { op, outcome };
    this.flashTimer = setTimeout(() => {
      this.flash = null;
      this.flashTimer = null;
    }, FLASH_MS);
  }

  /**
   * Appelé par `TabsStore` quand le résultat d'une opération distante arrive
   * sur un onglet caché : la pastille de l'onglet reprend son issue.
   */
  markUnseen() {
    if (this.lastOutcome !== null) this.unseenOutcome = this.lastOutcome;
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
      // Ce commit résolvait le conflit d'un « Finish » Git Flow : il reprend
      // où il s'était arrêté. Sans `await` : `committing` doit retomber
      // d'abord, sinon la suite se croirait bloquée par lui.
      if (this.flowFinish && !this.repoInfo?.merging) void this.runFinish();
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
/**
 * Pas de la minuterie de l'auto-fetch. Elle ne lance rien à ce rythme : elle
 * demande seulement à l'onglet affiché si son échéance est passée. Un tour
 * court, c'est ce qui fait qu'un intervalle raccourci, un retour sur un onglet
 * ou la fin d'une opération qui le retenait se rattrapent en quelques secondes.
 */
const AUTO_FETCH_TICK_MS = 5_000;

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
  /**
   * Noms d'affichage des dépôts, par chemin canonique. Chargés une fois au
   * démarrage, avant la restauration des onglets, pour qu'aucun n'apparaisse
   * d'abord sous le nom de son dossier.
   */
  private aliases: Record<string, string> = {};
  /**
   * Faux si l'abonnement à `repo://auto-fetched` a échoué : sans lui, un
   * auto-fetch lancé ne se terminerait jamais côté frontend, et chaque geste
   * distant l'attendrait indéfiniment.
   */
  private autoFetchListening = true;

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
        const tab = this.repoTabs.find((t) => t.repoId === event.repoId);
        tab?.onFetched(event);
        if (tab && this.activeId !== tab.id) tab.markUnseen();
      })
      .catch(() => {
        /* sans abonnement, le fetch reste lançable mais muet */
      });
    api
      .onPushed((event) => {
        const tab = this.repoTabs.find((t) => t.repoId === event.repoId);
        tab?.onPushed(event);
        if (tab && this.activeId !== tab.id) tab.markUnseen();
      })
      .catch(() => {
        /* idem pour le push */
      });
    api
      .onPulled((event) => {
        const tab = this.repoTabs.find((t) => t.repoId === event.repoId);
        tab?.onPulled(event);
        if (tab && this.activeId !== tab.id) tab.markUnseen();
      })
      .catch(() => {
        /* idem pour le pull */
      });
    api
      .onTagPushed((event) => {
        const tab = this.repoTabs.find((t) => t.repoId === event.repoId);
        tab?.onTagPushed(event);
        if (tab && this.activeId !== tab.id) tab.markUnseen();
      })
      .catch(() => {
        /* idem pour les tags */
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
    // Auto-fetch : pas de pastille sur l'onglet — personne ne l'a demandé, et
    // seul l'onglet affiché en lance. La relecture, comme pour le disque,
    // n'est immédiate que pour l'onglet affiché.
    api
      .onAutoFetched((event) => {
        const tab = this.repoTabs.find((t) => t.repoId === event.repoId);
        if (tab?.onAutoFetched(event) && this.activeId === tab.id) {
          void tab.applyExternalChange();
        }
      })
      .catch(() => {
        /* sans abonnement, l'auto-fetch ne se lance pas — voir `tickAutoFetch` */
        this.autoFetchListening = false;
      });
    setInterval(() => this.tickAutoFetch(), AUTO_FETCH_TICK_MS);
    // Fenêtre réduite puis rouverte : on n'attend pas le prochain tour.
    document.addEventListener("visibilitychange", () => this.tickAutoFetch());

    try {
      this.recent = await api.listRecent();
    } catch {
      this.recent = [];
    }
    await this.loadProfiles();
    await this.loadPullMode();
    try {
      this.aliases = await api.listAliases();
    } catch {
      /* table illisible : les onglets portent le nom de leur dossier */
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

  /**
   * Ouvre les paramètres d'un dépôt dans son propre onglet, en l'activant
   * d'abord — c'est ce que fait le menu contextuel d'un onglet, qui n'est pas
   * forcément celui affiché.
   */
  async openRepoSettings(id: string) {
    const tab = this.repoTabs.find((t) => t.repoId === id);
    if (!tab) return;
    tab.openSettings();
    await this.activate(id);
  }

  /**
   * Fixe ou retire le nom d'affichage d'un dépôt. Les récents sont relus : le
   * backend y met ce nom à la place de celui du dossier. Renvoie l'erreur au
   * formulaire, comme les autres écritures des paramètres du dépôt.
   */
  async setAlias(tab: RepoStore, alias: string | null): Promise<AppError | null> {
    try {
      const kept = await api.setAlias(tab.repoId, alias);
      tab.alias = kept;
      if (kept) this.aliases[tab.repoId] = kept;
      else delete this.aliases[tab.repoId];
    } catch (e) {
      return e as AppError;
    }
    try {
      this.recent = await api.listRecent();
    } catch {
      /* la liste se mettra à jour à la prochaine ouverture */
    }
    return null;
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
    // Un onglet resté caché plus longtemps que l'intervalle est récupéré dès
    // qu'on y revient, sans attendre le tour suivant.
    this.tickAutoFetch();
  }

  /**
   * Un tour de la minuterie d'auto-fetch : **l'onglet affiché seulement**,
   * comme pour les changements du disque. Dix dépôts ouverts n'ont pas à
   * interroger dix serveurs chaque minute ; un onglet caché est rattrapé à son
   * activation, son échéance étant passée depuis longtemps. Fenêtre réduite,
   * rien ne part non plus — le retour la rattrape de la même façon.
   */
  private tickAutoFetch() {
    if (!this.autoFetchListening || document.hidden) return;
    const tab = this.active;
    if (tab?.autoFetchDue(autoFetchPref.minutes, Date.now())) void tab.autoFetch();
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
      tab.alias = this.aliases[id] ?? null;
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
