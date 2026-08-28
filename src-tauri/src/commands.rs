//! Commandes Tauri exposées au frontend.
//!
//! Chaque commande est une fine couche : elle verrouille l'état, récupère le
//! backend de l'onglet visé et délègue. Aucune logique Git ici.
//!
//! Plusieurs dépôts pouvant être ouverts (un par onglet), toutes les commandes
//! qui touchent un dépôt reçoivent un `repo_id` — le chemin canonique renvoyé par
//! `open_repository`. C'est volontairement explicite : une commande ne dépend
//! jamais d'un « dépôt courant » implicite, donc deux onglets ne peuvent pas se
//! marcher dessus, même si leurs réponses arrivent dans le désordre.

use std::path::Path;
use std::sync::{Mutex, MutexGuard};

use tauri::State;

use crate::dto::{
    BranchEntry, CommitDetails, CommitGraphPage, CommitResult, FileDiff, RecentRepo, RepoInfo,
    RepoStatus, SessionInfo, StashEntry,
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

// ── Onglets / cycle de vie ──────────────────────────────────────────────────

/// Ouvre un dépôt dans un nouvel onglet (ou réactive celui déjà ouvert).
/// `RepoInfo::path` est l'identifiant à réutiliser dans les autres commandes.
#[tauri::command]
pub fn open_repository(
    path: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<RepoInfo, AppError> {
    let mut guard = lock(&state)?;
    let id = guard.open(Path::new(&path))?;
    guard.backend(&id)?.info()
}

/// Ferme un onglet et libère le backend associé.
#[tauri::command]
pub fn close_repository(
    repo_id: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<(), AppError> {
    lock(&state)?.close(&repo_id);
    Ok(())
}

/// Mémorise l'onglet actif, pour le restaurer au prochain lancement.
#[tauri::command]
pub fn set_active_repo(
    repo_id: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<(), AppError> {
    lock(&state)?.set_active(&repo_id);
    Ok(())
}

/// Réordonne les onglets et persiste le nouvel ordre pour la prochaine session.
#[tauri::command]
pub fn set_tab_order(
    order: Vec<String>,
    state: State<'_, Mutex<AppState>>,
) -> Result<(), AppError> {
    lock(&state)?.set_order(order);
    Ok(())
}

/// Session persistée : onglets à rouvrir et onglet actif.
#[tauri::command]
pub fn get_session(state: State<'_, Mutex<AppState>>) -> Result<SessionInfo, AppError> {
    Ok(lock(&state)?.session())
}

#[tauri::command]
pub fn list_recent(state: State<'_, Mutex<AppState>>) -> Result<Vec<RecentRepo>, AppError> {
    Ok(lock(&state)?.recent_list())
}

/// Infos à jour d'un dépôt déjà ouvert (branche, HEAD).
#[tauri::command]
pub fn get_repo_info(
    repo_id: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<RepoInfo, AppError> {
    lock(&state)?.backend(&repo_id)?.info()
}

// ── Statut / diff / index ───────────────────────────────────────────────────

#[tauri::command]
pub fn get_status(
    repo_id: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<RepoStatus, AppError> {
    lock(&state)?.backend(&repo_id)?.status()
}

#[tauri::command]
pub fn get_file_diff(
    repo_id: String,
    path: String,
    staged: bool,
    state: State<'_, Mutex<AppState>>,
) -> Result<FileDiff, AppError> {
    lock(&state)?.backend(&repo_id)?.file_diff(&path, staged)
}

#[tauri::command]
pub fn stage_file(
    repo_id: String,
    path: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<(), AppError> {
    lock(&state)?.backend(&repo_id)?.stage(&path)
}

#[tauri::command]
pub fn unstage_file(
    repo_id: String,
    path: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<(), AppError> {
    lock(&state)?.backend(&repo_id)?.unstage(&path)
}

#[tauri::command]
pub fn stage_all(repo_id: String, state: State<'_, Mutex<AppState>>) -> Result<(), AppError> {
    lock(&state)?.backend(&repo_id)?.stage_all()
}

#[tauri::command]
pub fn unstage_all(repo_id: String, state: State<'_, Mutex<AppState>>) -> Result<(), AppError> {
    lock(&state)?.backend(&repo_id)?.unstage_all()
}

#[tauri::command]
pub fn commit(
    repo_id: String,
    summary: String,
    body: Option<String>,
    amend: bool,
    state: State<'_, Mutex<AppState>>,
) -> Result<CommitResult, AppError> {
    lock(&state)?
        .backend(&repo_id)?
        .commit(&summary, body.as_deref(), amend)
}

// ── Branches & stashes ──────────────────────────────────────────────────────

#[tauri::command]
pub fn list_branches(
    repo_id: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<Vec<BranchEntry>, AppError> {
    lock(&state)?.backend(&repo_id)?.local_branches()
}

/// Bascule de branche et renvoie les infos à jour du dépôt (branche, HEAD),
/// ce qui évite un aller-retour supplémentaire côté frontend.
#[tauri::command]
pub fn checkout_branch(
    repo_id: String,
    name: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<RepoInfo, AppError> {
    let guard = lock(&state)?;
    let backend = guard.backend(&repo_id)?;
    backend.checkout_branch(&name)?;
    backend.info()
}

#[tauri::command]
pub fn list_stashes(
    repo_id: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<Vec<StashEntry>, AppError> {
    lock(&state)?.backend(&repo_id)?.stashes()
}

#[tauri::command]
pub fn stash_apply(
    repo_id: String,
    index: usize,
    state: State<'_, Mutex<AppState>>,
) -> Result<(), AppError> {
    lock(&state)?.backend(&repo_id)?.stash_apply(index)
}

#[tauri::command]
pub fn stash_pop(
    repo_id: String,
    index: usize,
    state: State<'_, Mutex<AppState>>,
) -> Result<(), AppError> {
    lock(&state)?.backend(&repo_id)?.stash_pop(index)
}

#[tauri::command]
pub fn stash_drop(
    repo_id: String,
    index: usize,
    state: State<'_, Mutex<AppState>>,
) -> Result<(), AppError> {
    lock(&state)?.backend(&repo_id)?.stash_drop(index)
}

// ── Graph ───────────────────────────────────────────────────────────────────

/// Page d'historique pour le graph. `skip`/`limit` pagine le parcours ; le
/// frontend recharge depuis `skip = 0` après toute mutation du dépôt.
#[tauri::command]
pub fn commit_graph(
    repo_id: String,
    skip: usize,
    limit: usize,
    state: State<'_, Mutex<AppState>>,
) -> Result<CommitGraphPage, AppError> {
    lock(&state)?.backend(&repo_id)?.commit_graph(skip, limit)
}

#[tauri::command]
pub fn commit_details(
    repo_id: String,
    oid: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<CommitDetails, AppError> {
    lock(&state)?.backend(&repo_id)?.commit_details(&oid)
}

#[tauri::command]
pub fn commit_file_diff(
    repo_id: String,
    oid: String,
    path: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<FileDiff, AppError> {
    lock(&state)?
        .backend(&repo_id)?
        .commit_file_diff(&oid, &path)
}
