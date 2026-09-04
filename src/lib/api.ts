import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  AppError,
  BranchEntry,
  CommitDetails,
  CommitGraphPage,
  CommitResult,
  FetchEvent,
  FileDiff,
  Identity,
  Profile,
  PullEvent,
  PullMode,
  PushEvent,
  RemoteBranchEntry,
  RemoteInfo,
  RecentRepo,
  RepoChangedEvent,
  RepoInfo,
  RepoStatus,
  SessionInfo,
  SidebarWidths,
  StashEntry,
  ThemeMode,
} from "./types";

// ── Point d'accès UNIQUE au backend Rust ──────────────────────────────────
// Aucun composant Svelte n'appelle `invoke` directement : tout passe par ici,
// ce qui garde la logique Git côté Rust et centralise le typage + les erreurs.
//
// Plusieurs dépôts peuvent être ouverts (un par onglet) : toute opération liée à
// un dépôt prend un `repoId` — le chemin canonique renvoyé par `openRepository`.

/**
 * Normalise n'importe quelle erreur remontée par `invoke` en `AppError`.
 * Le backend renvoie déjà `{ kind, message }` ; on couvre aussi les cas
 * dégénérés (string, Error JS) pour ne jamais casser l'UI.
 */
function toAppError(e: unknown): AppError {
  if (e && typeof e === "object" && "kind" in e && "message" in e) {
    return e as AppError;
  }
  if (typeof e === "string") return { kind: "Unknown", message: e };
  if (e instanceof Error) return { kind: "Unknown", message: e.message };
  return { kind: "Unknown", message: "Erreur inconnue" };
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw toAppError(e);
  }
}

/** Ouvre le dialog natif de sélection de dossier. Retourne null si annulé. */
export async function pickRepositoryFolder(): Promise<string | null> {
  const selected = await open({ directory: true, multiple: false });
  return typeof selected === "string" ? selected : null;
}

export const api = {
  // ── Onglets / session ────────────────────────────────────────────────────
  /** Ouvre un dépôt ; `RepoInfo.path` est l'identifiant d'onglet à réutiliser. */
  openRepository: (path: string) => call<RepoInfo>("open_repository", { path }),
  closeRepository: (repoId: string) => call<void>("close_repository", { repoId }),
  setActiveRepo: (repoId: string) => call<void>("set_active_repo", { repoId }),
  /** Ordre d'affichage des onglets, persisté pour la prochaine session. */
  setTabOrder: (order: string[]) => call<void>("set_tab_order", { order }),
  getSession: () => call<SessionInfo>("get_session"),
  listRecent: () => call<RecentRepo[]>("list_recent"),
  getRepoInfo: (repoId: string) => call<RepoInfo>("get_repo_info", { repoId }),

  // ── Statut / diff / index ────────────────────────────────────────────────
  getStatus: (repoId: string) => call<RepoStatus>("get_status", { repoId }),
  getFileDiff: (repoId: string, path: string, staged: boolean) =>
    call<FileDiff>("get_file_diff", { repoId, path, staged }),
  stageFile: (repoId: string, path: string) => call<void>("stage_file", { repoId, path }),
  unstageFile: (repoId: string, path: string) =>
    call<void>("unstage_file", { repoId, path }),
  stageAll: (repoId: string) => call<void>("stage_all", { repoId }),
  unstageAll: (repoId: string) => call<void>("unstage_all", { repoId }),
  commit: (repoId: string, summary: string, body: string | null, amend: boolean) =>
    call<CommitResult>("commit", { repoId, summary, body, amend }),

  // ── Branches & stashes ───────────────────────────────────────────────────
  listBranches: (repoId: string) => call<BranchEntry[]>("list_branches", { repoId }),
  /**
   * Branches distantes déjà présentes sur le disque (`refs/remotes/**`). Ne va
   * pas sur le réseau : c'est `fetchRemote` qui les met à jour.
   */
  listRemoteBranches: (repoId: string) =>
    call<RemoteBranchEntry[]>("list_remote_branches", { repoId }),
  /** Bascule de branche ; renvoie les infos du dépôt à jour. */
  checkoutBranch: (repoId: string, name: string) =>
    call<RepoInfo>("checkout_branch", { repoId, name }),
  /**
   * Bascule sur une branche distante ("origin/feature") : le backend crée la
   * branche locale de suivi ("feature") si elle n'existe pas encore, sinon il
   * bascule sur celle qui existe déjà, sans la faire avancer.
   */
  checkoutRemoteBranch: (repoId: string, name: string) =>
    call<RepoInfo>("checkout_remote_branch", { repoId, name }),
  // ── Dépôt distant ────────────────────────────────────────────────────────
  /**
   * Lance un fetch et rend la main immédiatement : le backend l'exécute sur un
   * thread dédié pour ne pas geler les autres onglets. Le résultat n'est donc
   * *pas* la valeur de retour — il arrive via `onFetched`. Une erreur levée ici
   * signale un échec de lancement (onglet fermé, fetch déjà en cours), auquel
   * cas aucun événement ne suivra.
   */
  fetchRemote: (repoId: string, remote?: string) =>
    call<void>("fetch_remote", { repoId, remote: remote ?? null }),
  /**
   * S'abonne au résultat des fetch. L'événement porte son `repoId` : il peut
   * concerner un onglet qui n'est plus celui affiché.
   */
  onFetched: (handler: (event: FetchEvent) => void): Promise<UnlistenFn> =>
    listen<FetchEvent>("repo://fetched", (e) => handler(e.payload)),
  /**
   * Publie la branche courante. Même contrat que `fetchRemote` : réponse
   * immédiate, résultat par `onPushed`. Le suivi est posé au premier push,
   * et rien n'est jamais forcé — un rejet du distant remonte en erreur.
   */
  pushBranch: (repoId: string, remote?: string) =>
    call<void>("push_branch", { repoId, remote: remote ?? null }),
  onPushed: (handler: (event: PushEvent) => void): Promise<UnlistenFn> =>
    listen<PushEvent>("repo://pushed", (e) => handler(e.payload)),
  /**
   * Récupère puis intègre, selon le mode. Même contrat que `fetchRemote` :
   * réponse immédiate, résultat par `onPulled`. C'est la seule opération
   * distante qui écrit dans le working directory.
   */
  pull: (repoId: string, mode: PullMode) => call<void>("pull", { repoId, mode }),
  onPulled: (handler: (event: PullEvent) => void): Promise<UnlistenFn> =>
    listen<PullEvent>("repo://pulled", (e) => handler(e.payload)),
  /** Sortie de secours d'un pull qui a conflité ; renvoie les infos à jour. */
  abortMerge: (repoId: string) => call<RepoInfo>("abort_merge", { repoId }),
  // ── Surveillance du disque ───────────────────────────────────────────────
  /**
   * S'abonne aux changements détectés sur le disque : un éditeur qui enregistre,
   * un `git` lancé au terminal, un autre client. Le backend surveille les dépôts
   * ouverts et émet sans qu'on ait rien demandé — l'événement porte donc son
   * `repoId`, comme celui du fetch.
   *
   * Aucun réseau n'est en jeu : il n'y a que du disque à relire.
   */
  onRepoChanged: (handler: (event: RepoChangedEvent) => void): Promise<UnlistenFn> =>
    listen<RepoChangedEvent>("repo://changed", (e) => handler(e.payload)),
  /** Mode du bouton Pull : préférence globale, persistée par le backend. */
  getPullMode: () => call<PullMode>("get_pull_mode"),
  setPullMode: (mode: PullMode) => call<void>("set_pull_mode", { mode }),
  /**
   * Thème de l'interface : préférence globale, persistée. `setTheme` aligne au
   * passage l'apparence de la fenêtre native, que le webview ne peut pas peindre.
   */
  getTheme: () => call<ThemeMode>("get_theme"),
  setTheme: (mode: ThemeMode) => call<void>("set_theme", { theme: mode }),

  /**
   * Taille du corps de texte, en points (préférence globale, persistée). Le
   * backend ramène dans ses bornes ce qui en sort.
   */
  getFontSize: () => call<number>("get_font_size"),
  setFontSize: (size: number) => call<void>("set_font_size", { size }),

  /**
   * Largeurs des colonnes latérales, en rem (préférence globale, persistée).
   * Les deux voyagent ensemble : un aller-retour au démarrage, une écriture par
   * glissement. Le backend ramène dans ses bornes ce qui en sort.
   */
  getSidebarWidths: () => call<SidebarWidths>("get_sidebar_widths"),
  setSidebarWidths: (widths: SidebarWidths) =>
    call<void>("set_sidebar_widths", { widths }),
  /** Dépôt distant interrogé par un fetch : hôte, URL, identifiants déjà connus. */
  getRemoteInfo: (repoId: string, remote?: string) =>
    call<RemoteInfo>("get_remote_info", { repoId, remote: remote ?? null }),
  /**
   * Enregistre les identifiants d'un hôte dans le trousseau du système.
   * Sens unique : aucune commande ne permet de relire le secret ensuite.
   */
  setCredentials: (host: string, username: string, secret: string) =>
    call<void>("set_credentials", { host, username, secret }),
  forgetCredentials: (host: string) => call<void>("forget_credentials", { host }),
  hasCredentials: (host: string) => call<boolean>("has_credentials", { host }),

  // ── Profils d'auteur ─────────────────────────────────────────────────────
  listProfiles: () => call<Profile[]>("list_profiles"),
  /** `id` absent = création ; sinon mise à jour du profil visé. */
  saveProfile: (id: string | null, label: string, name: string, email: string) =>
    call<Profile>("save_profile", { id, label, name, email }),
  deleteProfile: (id: string) => call<void>("delete_profile", { id }),
  /** Identité du dépôt, et si elle lui est propre. */
  getIdentity: (repoId: string) => call<Identity>("get_identity", { repoId }),
  setIdentity: (repoId: string, name: string, email: string) =>
    call<Identity>("set_identity", { repoId, name, email }),
  clearIdentity: (repoId: string) => call<Identity>("clear_identity", { repoId }),

  listStashes: (repoId: string) => call<StashEntry[]>("list_stashes", { repoId }),
  /**
   * Remise les modifications locales, fichiers non suivis compris. Le message
   * est construit comme celui d'un commit : résumé, puis description.
   */
  stashSave: (repoId: string, summary: string, body: string | null) =>
    call<void>("stash_save", { repoId, summary, body }),
  /** Applique un stash sans le retirer de la pile. */
  stashApply: (repoId: string, index: number) =>
    call<void>("stash_apply", { repoId, index }),
  /** Applique un stash puis le retire (git stash pop). */
  stashPop: (repoId: string, index: number) => call<void>("stash_pop", { repoId, index }),
  /** Retire un stash sans l'appliquer (irréversible). */
  stashDrop: (repoId: string, index: number) =>
    call<void>("stash_drop", { repoId, index }),

  // ── Graph ────────────────────────────────────────────────────────────────
  /** Page d'historique du graph. Recharger depuis `skip = 0` après toute mutation. */
  commitGraph: (repoId: string, skip: number, limit: number) =>
    call<CommitGraphPage>("commit_graph", { repoId, skip, limit }),
  commitDetails: (repoId: string, oid: string) =>
    call<CommitDetails>("commit_details", { repoId, oid }),
  /** Diff d'un fichier dans un commit (commit ↔ premier parent). */
  commitFileDiff: (repoId: string, oid: string, path: string) =>
    call<FileDiff>("commit_file_diff", { repoId, oid, path }),
};
