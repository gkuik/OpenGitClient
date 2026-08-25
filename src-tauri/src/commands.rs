//! Commandes Tauri exposées au frontend.
//!
//! Chaque commande est une fine couche : elle verrouille l'état, récupère le
//! backend courant et délègue. Aucune logique Git ici.

use std::path::Path;
use std::sync::{Mutex, MutexGuard};

use tauri::State;

use crate::dto::{
    BranchEntry, CommitDetails, CommitGraphPage, CommitResult, FileDiff, RecentRepo, RepoInfo,
    RepoStatus, StashEntry,
};
use crate::error::AppError;
use crate::state::AppState;

/// Verrouille l'état ; convertit un mutex empoisonné en `AppError` plutôt que
/// de paniquer (respect de la règle "zéro panic remonté au front").
fn lock<'a>(
    state: &'a State<'_, Mutex<AppState>>,
) -> Result<MutexGuard<'a, AppState>, AppError> {
    state
        .lock()
        .map_err(|_| AppError::Io("État interne corrompu".into()))
}

#[tauri::command]
pub fn open_repository(
    path: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<RepoInfo, AppError> {
    let mut guard = lock(&state)?;
    guard.open(Path::new(&path))?;
    guard.backend()?.info()
}

#[tauri::command]
pub fn get_status(state: State<'_, Mutex<AppState>>) -> Result<RepoStatus, AppError> {
    lock(&state)?.backend()?.status()
}

#[tauri::command]
pub fn get_file_diff(
    path: String,
    staged: bool,
    state: State<'_, Mutex<AppState>>,
) -> Result<FileDiff, AppError> {
    lock(&state)?.backend()?.file_diff(&path, staged)
}

#[tauri::command]
pub fn stage_file(path: String, state: State<'_, Mutex<AppState>>) -> Result<(), AppError> {
    lock(&state)?.backend()?.stage(&path)
}

#[tauri::command]
pub fn unstage_file(path: String, state: State<'_, Mutex<AppState>>) -> Result<(), AppError> {
    lock(&state)?.backend()?.unstage(&path)
}

#[tauri::command]
pub fn stage_all(state: State<'_, Mutex<AppState>>) -> Result<(), AppError> {
    lock(&state)?.backend()?.stage_all()
}

#[tauri::command]
pub fn unstage_all(state: State<'_, Mutex<AppState>>) -> Result<(), AppError> {
    lock(&state)?.backend()?.unstage_all()
}

#[tauri::command]
pub fn commit(
    summary: String,
    body: Option<String>,
    amend: bool,
    state: State<'_, Mutex<AppState>>,
) -> Result<CommitResult, AppError> {
    lock(&state)?
        .backend()?
        .commit(&summary, body.as_deref(), amend)
}

#[tauri::command]
pub fn list_recent(state: State<'_, Mutex<AppState>>) -> Result<Vec<RecentRepo>, AppError> {
    Ok(lock(&state)?.recent_list())
}

#[tauri::command]
pub fn list_branches(state: State<'_, Mutex<AppState>>) -> Result<Vec<BranchEntry>, AppError> {
    lock(&state)?.backend()?.local_branches()
}

#[tauri::command]
pub fn list_stashes(state: State<'_, Mutex<AppState>>) -> Result<Vec<StashEntry>, AppError> {
    lock(&state)?.backend()?.stashes()
}

#[tauri::command]
pub fn stash_apply(index: usize, state: State<'_, Mutex<AppState>>) -> Result<(), AppError> {
    lock(&state)?.backend()?.stash_apply(index)
}

#[tauri::command]
pub fn stash_pop(index: usize, state: State<'_, Mutex<AppState>>) -> Result<(), AppError> {
    lock(&state)?.backend()?.stash_pop(index)
}

#[tauri::command]
pub fn stash_drop(index: usize, state: State<'_, Mutex<AppState>>) -> Result<(), AppError> {
    lock(&state)?.backend()?.stash_drop(index)
}

/// Page d'historique pour le graph. `skip`/`limit` pagine le parcours ; le
/// frontend recharge depuis `skip = 0` après toute mutation du dépôt.
#[tauri::command]
pub fn commit_graph(
    skip: usize,
    limit: usize,
    state: State<'_, Mutex<AppState>>,
) -> Result<CommitGraphPage, AppError> {
    lock(&state)?.backend()?.commit_graph(skip, limit)
}

#[tauri::command]
pub fn commit_details(
    oid: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<CommitDetails, AppError> {
    lock(&state)?.backend()?.commit_details(&oid)
}

#[tauri::command]
pub fn commit_file_diff(
    oid: String,
    path: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<FileDiff, AppError> {
    lock(&state)?.backend()?.commit_file_diff(&oid, &path)
}

/// Bascule de branche et renvoie les infos à jour du dépôt (branche, HEAD),
/// ce qui évite un aller-retour supplémentaire côté frontend.
#[tauri::command]
pub fn checkout_branch(
    name: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<RepoInfo, AppError> {
    let guard = lock(&state)?;
    let backend = guard.backend()?;
    backend.checkout_branch(&name)?;
    backend.info()
}
