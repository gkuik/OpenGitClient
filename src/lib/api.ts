import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  AppError,
  BranchEntry,
  CommitDetails,
  CommitGraphPage,
  CommitResult,
  FileDiff,
  RecentRepo,
  RepoInfo,
  RepoStatus,
  SessionInfo,
  StashEntry,
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
  /** Bascule de branche ; renvoie les infos du dépôt à jour. */
  checkoutBranch: (repoId: string, name: string) =>
    call<RepoInfo>("checkout_branch", { repoId, name }),
  listStashes: (repoId: string) => call<StashEntry[]>("list_stashes", { repoId }),
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
