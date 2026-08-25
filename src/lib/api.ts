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
  StashEntry,
} from "./types";

// ── Point d'accès UNIQUE au backend Rust ──────────────────────────────────
// Aucun composant Svelte n'appelle `invoke` directement : tout passe par ici,
// ce qui garde la logique Git côté Rust et centralise le typage + les erreurs.

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
  openRepository: (path: string) => call<RepoInfo>("open_repository", { path }),
  getStatus: () => call<RepoStatus>("get_status"),
  getFileDiff: (path: string, staged: boolean) =>
    call<FileDiff>("get_file_diff", { path, staged }),
  stageFile: (path: string) => call<void>("stage_file", { path }),
  unstageFile: (path: string) => call<void>("unstage_file", { path }),
  stageAll: () => call<void>("stage_all"),
  unstageAll: () => call<void>("unstage_all"),
  commit: (summary: string, body: string | null, amend: boolean) =>
    call<CommitResult>("commit", { summary, body, amend }),
  listRecent: () => call<RecentRepo[]>("list_recent"),
  listBranches: () => call<BranchEntry[]>("list_branches"),
  /** Bascule de branche ; renvoie les infos du dépôt à jour. */
  checkoutBranch: (name: string) => call<RepoInfo>("checkout_branch", { name }),
  listStashes: () => call<StashEntry[]>("list_stashes"),
  /** Applique un stash sans le retirer de la pile. */
  stashApply: (index: number) => call<void>("stash_apply", { index }),
  /** Applique un stash puis le retire (git stash pop). */
  stashPop: (index: number) => call<void>("stash_pop", { index }),
  /** Retire un stash sans l'appliquer (irréversible). */
  stashDrop: (index: number) => call<void>("stash_drop", { index }),
  /** Page d'historique du graph. Recharger depuis `skip = 0` après toute mutation. */
  commitGraph: (skip: number, limit: number) =>
    call<CommitGraphPage>("commit_graph", { skip, limit }),
  commitDetails: (oid: string) => call<CommitDetails>("commit_details", { oid }),
  /** Diff d'un fichier dans un commit (commit ↔ premier parent). */
  commitFileDiff: (oid: string, path: string) =>
    call<FileDiff>("commit_file_diff", { oid, path }),
};
