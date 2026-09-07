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

use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use tauri::{AppHandle, Emitter, Manager, State};

use crate::dto::{
    BranchEntry, CommitDetails, CommitGraphPage, CommitResult, FetchEvent, FileDiff, Identity,
    MergeMode, MergeReport, Profile, PullEvent, PullMode, PullRequestEvent, PushEvent, RecentRepo,
    RemoteBranchEntry, RemoteInfo, RepoInfo, RepoStatus, SessionInfo, SidebarWidths, StashEntry,
    ThemeMode,
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

/// Abandonne tous les changements en cours (irréversible). La confirmation est
/// demandée côté interface : le backend, lui, exécute.
///
/// Renvoie les infos du dépôt comme `abort_merge`, et pour la même raison : une
/// fusion en cours est refermée au passage, et `merging` décide du bandeau.
#[tauri::command]
pub fn discard_all(
    repo_id: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<RepoInfo, AppError> {
    let guard = lock(&state)?;
    let backend = guard.backend(&repo_id)?;
    backend.discard_all()?;
    backend.info()
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

/// Branches distantes de l'onglet. Lecture locale de `refs/remotes/**` : c'est
/// un `fetch` qui les met à jour, pas cette commande.
#[tauri::command]
pub fn list_remote_branches(
    repo_id: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<Vec<RemoteBranchEntry>, AppError> {
    lock(&state)?.backend(&repo_id)?.remote_branches()
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

/// Bascule sur une branche distante : la branche locale de suivi est créée au
/// passage si elle n'existe pas encore. Renvoie les infos à jour du dépôt, comme
/// `checkout_branch`.
#[tauri::command]
pub fn checkout_remote_branch(
    repo_id: String,
    name: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<RepoInfo, AppError> {
    let guard = lock(&state)?;
    let backend = guard.backend(&repo_id)?;
    backend.checkout_remote_branch(&name)?;
    backend.info()
}

// ── Dépôt distant ───────────────────────────────────────────────────────────

/// Nom de l'événement portant le résultat d'un fetch (voir `src/lib/api.ts`).
const FETCH_EVENT: &str = "repo://fetched";

/// Lance un `fetch` **en tâche de fond** et rend la main immédiatement.
///
/// C'est la seule commande qui ne fait pas son travail elle-même, et c'est
/// délibéré : un fetch est un appel réseau bloquant, l'exécuter dans le corps de
/// la commande le ferait sous le `Mutex` de l'état. Tous les onglets seraient
/// gelés pour toute sa durée — indéfiniment sur une connexion qui ne répond
/// jamais. On se contente donc de réserver le dépôt, et un thread dédié fait le
/// reste avant d'émettre `repo://fetched`.
///
/// Le thread rouvre **son propre** backend plutôt que d'emprunter celui de
/// l'état : l'identifiant d'onglet *est* le chemin canonique du dépôt, et
/// `Libgit2Backend` ne garde qu'un chemin — le thread n'a donc jamais besoin de
/// toucher à `AppState` pendant l'appel réseau.
#[tauri::command]
pub fn fetch_remote(
    repo_id: String,
    remote: Option<String>,
    app: AppHandle,
    state: State<'_, Mutex<AppState>>,
) -> Result<(), AppError> {
    {
        let mut guard = lock(&state)?;
        // L'onglet doit exister : inutile de lancer un thread pour un dépôt fermé.
        guard.backend(&repo_id)?;
        if !guard.begin_network(&repo_id) {
            return Err(AppError::NetworkBusy);
        }
    }

    let path = PathBuf::from(&repo_id);
    std::thread::spawn(move || {
        let outcome = crate::git::open_repository(&path)
            .and_then(|backend| backend.fetch(remote.as_deref()));

        // Libérer la réservation **avant** de notifier : le frontend peut relancer
        // un fetch dès qu'il reçoit l'événement.
        if let Some(state) = app.try_state::<Mutex<AppState>>() {
            if let Ok(mut guard) = state.lock() {
                guard.end_network(&repo_id);
            }
        }

        let (report, error) = match outcome {
            Ok(report) => (Some(report), None),
            Err(e) => (None, Some(e)),
        };
        // L'échec de l'émission (fenêtre déjà fermée) n'a rien à rattraper.
        let _ = app.emit(
            FETCH_EVENT,
            FetchEvent {
                repo_id,
                report,
                error,
            },
        );
    });

    Ok(())
}

/// Nom de l'événement portant le résultat d'un pull (voir `src/lib/api.ts`).
const PULL_EVENT: &str = "repo://pulled";

/// Récupère puis intègre **en tâche de fond**, selon le mode demandé.
///
/// Mêmes contraintes que [`fetch_remote`] — appel réseau bloquant, thread dédié,
/// réservation partagée relâchée avant l'émission. À la différence des deux
/// autres opérations distantes, celle-ci écrit dans le working directory : le
/// frontend recharge donc tout à réception, statut compris.
#[tauri::command]
pub fn pull(
    repo_id: String,
    mode: PullMode,
    app: AppHandle,
    state: State<'_, Mutex<AppState>>,
) -> Result<(), AppError> {
    {
        let mut guard = lock(&state)?;
        guard.backend(&repo_id)?;
        if !guard.begin_network(&repo_id) {
            return Err(AppError::NetworkBusy);
        }
    }

    let path = PathBuf::from(&repo_id);
    std::thread::spawn(move || {
        let outcome =
            crate::git::open_repository(&path).and_then(|backend| backend.pull(mode));

        if let Some(state) = app.try_state::<Mutex<AppState>>() {
            if let Ok(mut guard) = state.lock() {
                guard.end_network(&repo_id);
            }
        }

        let (report, error) = match outcome {
            Ok(report) => (Some(report), None),
            Err(e) => (None, Some(e)),
        };
        let _ = app.emit(
            PULL_EVENT,
            PullEvent {
                repo_id,
                report,
                error,
            },
        );
    });

    Ok(())
}

/// Abandonne la fusion en cours et renvoie les infos à jour du dépôt : c'est la
/// sortie de secours d'un pull qui a conflité.
#[tauri::command]
pub fn abort_merge(
    repo_id: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<RepoInfo, AppError> {
    let guard = lock(&state)?;
    let backend = guard.backend(&repo_id)?;
    backend.abort_merge()?;
    backend.info()
}

/// Fusionne une branche locale dans une autre : glisser-déposer d'une branche sur
/// une autre, ou menu contextuel de la section LOCAL.
///
/// Purement local — aucun réseau, donc pas de thread dédié comme fetch/push/pull :
/// la commande rend directement son rapport. Il dit notamment si HEAD a changé de
/// branche, ce que le frontend ne peut pas deviner (une avance rapide sur une
/// branche inactive n'y touche pas).
#[tauri::command]
pub fn merge_branches(
    repo_id: String,
    source: String,
    target: String,
    mode: MergeMode,
    state: State<'_, Mutex<AppState>>,
) -> Result<MergeReport, AppError> {
    let guard = lock(&state)?;
    guard
        .backend(&repo_id)?
        .merge_branches(&source, &target, mode)
}

/// Mode exécuté par le bouton Pull (préférence globale, persistée).
#[tauri::command]
pub fn get_pull_mode(state: State<'_, Mutex<AppState>>) -> Result<PullMode, AppError> {
    Ok(lock(&state)?.pull_mode())
}

#[tauri::command]
pub fn set_pull_mode(
    mode: PullMode,
    state: State<'_, Mutex<AppState>>,
) -> Result<(), AppError> {
    lock(&state)?.set_pull_mode(mode)
}

/// Thème de l'interface (préférence globale, persistée).
#[tauri::command]
pub fn get_theme(state: State<'_, Mutex<AppState>>) -> Result<ThemeMode, AppError> {
    Ok(lock(&state)?.theme())
}

/// Change le thème : persistance de la préférence, puis fenêtre native.
///
/// Les couleurs de l'interface, elles, sont l'affaire du webview (voir
/// `src/lib/theme.svelte.ts`) : ce que la fenêtre reçoit ici, c'est son
/// apparence *native* — le fond que macOS peint derrière le contenu, la teinte
/// des boutons de fenêtre et celle du sélecteur de dossier.
#[tauri::command]
pub fn set_theme(
    theme: ThemeMode,
    app: AppHandle,
    state: State<'_, Mutex<AppState>>,
) -> Result<(), AppError> {
    lock(&state)?.set_theme(theme)?;
    apply_window_theme(&app, theme);
    Ok(())
}

/// Taille du corps de texte, en points (préférence globale, persistée).
///
/// Rien à faire côté natif, contrairement au thème : la taille ne concerne que
/// le contenu du webview, que la fenêtre se contente d'héberger.
#[tauri::command]
pub fn get_font_size(state: State<'_, Mutex<AppState>>) -> Result<u8, AppError> {
    Ok(lock(&state)?.font_size())
}

#[tauri::command]
pub fn set_font_size(size: u8, state: State<'_, Mutex<AppState>>) -> Result<(), AppError> {
    lock(&state)?.set_font_size(size)
}

/// Largeurs des colonnes latérales, en rem (préférence globale, persistée).
///
/// Les deux voyagent ensemble plutôt qu'une commande par côté : c'est un seul
/// aller-retour au démarrage, et un seul `prefs.json` écrit par glissement.
#[tauri::command]
pub fn get_sidebar_widths(state: State<'_, Mutex<AppState>>) -> Result<SidebarWidths, AppError> {
    Ok(lock(&state)?.sidebar_widths())
}

#[tauri::command]
pub fn set_sidebar_widths(
    widths: SidebarWidths,
    state: State<'_, Mutex<AppState>>,
) -> Result<(), AppError> {
    lock(&state)?.set_sidebar_widths(widths)
}

/// Aligne l'apparence de la fenêtre principale sur le thème choisi.
///
/// `System` se traduit par `None`, qui laisse la fenêtre suivre le système —
/// c'est bien une absence de consigne, pas une troisième apparence. L'échec est
/// ignoré : sur une plateforme qui ne sait pas changer de thème, l'interface,
/// elle, reste dans la bonne palette.
pub fn apply_window_theme(app: &AppHandle, theme: ThemeMode) {
    let native = match theme {
        ThemeMode::System => None,
        ThemeMode::Light => Some(tauri::Theme::Light),
        ThemeMode::Dark => Some(tauri::Theme::Dark),
    };
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_theme(native);
    }
}

/// Nom de l'événement portant le résultat d'un push (voir `src/lib/api.ts`).
const PUSH_EVENT: &str = "repo://pushed";

/// Publie la branche courante **en tâche de fond**, et rend la main aussitôt.
///
/// Mêmes contraintes que [`fetch_remote`], pour les mêmes raisons : appel réseau
/// bloquant, donc thread dédié plutôt que le corps de la commande, qui tient le
/// `Mutex` de l'état ; backend rouvert depuis le chemin plutôt qu'emprunté ;
/// réservation relâchée **avant** l'émission. Cette réservation est la même que
/// celle du fetch — les deux écrivent `refs/remotes/**`.
#[tauri::command]
pub fn push_branch(
    repo_id: String,
    remote: Option<String>,
    app: AppHandle,
    state: State<'_, Mutex<AppState>>,
) -> Result<(), AppError> {
    {
        let mut guard = lock(&state)?;
        guard.backend(&repo_id)?;
        if !guard.begin_network(&repo_id) {
            return Err(AppError::NetworkBusy);
        }
    }

    let path = PathBuf::from(&repo_id);
    std::thread::spawn(move || {
        let outcome =
            crate::git::open_repository(&path).and_then(|backend| backend.push(remote.as_deref()));

        if let Some(state) = app.try_state::<Mutex<AppState>>() {
            if let Ok(mut guard) = state.lock() {
                guard.end_network(&repo_id);
            }
        }

        let (report, error) = match outcome {
            Ok(report) => (Some(report), None),
            Err(e) => (None, Some(e)),
        };
        let _ = app.emit(
            PUSH_EVENT,
            PushEvent {
                repo_id,
                report,
                error,
            },
        );
    });

    Ok(())
}

/// Dépôt distant qu'un fetch interrogerait, avec l'hôte auquel rattacher des
/// identifiants et le fait qu'il en existe déjà.
#[tauri::command]
pub fn get_remote_info(
    repo_id: String,
    remote: Option<String>,
    state: State<'_, Mutex<AppState>>,
) -> Result<RemoteInfo, AppError> {
    lock(&state)?
        .backend(&repo_id)?
        .remote_info(remote.as_deref())
}

/// Enregistre les identifiants d'un hôte dans le trousseau du système.
///
/// Sens unique : le secret entre ici et n'en ressort que vers libgit2 au moment
/// d'un fetch. Aucune commande ne permet de le relire depuis le frontend.
#[tauri::command]
pub fn set_credentials(
    host: String,
    username: String,
    secret: String,
) -> Result<(), AppError> {
    crate::credentials::set(&host, username, secret)
}

/// Oublie les identifiants d'un hôte. Sans effet s'il n'y en avait pas.
#[tauri::command]
pub fn forget_credentials(host: String) -> Result<(), AppError> {
    crate::credentials::forget(&host)
}

/// Des identifiants sont-ils enregistrés pour cet hôte ? Ne dit rien de leur
/// contenu — c'est ce que l'écran Paramètres affiche en face de chaque hôte.
#[tauri::command]
pub fn has_credentials(host: String) -> bool {
    crate::credentials::has(&host)
}

// ── Profils d'auteur ────────────────────────────────────────────────────────

#[tauri::command]
pub fn list_profiles(state: State<'_, Mutex<AppState>>) -> Result<Vec<Profile>, AppError> {
    Ok(lock(&state)?.profiles())
}

/// Crée un profil (`id` absent) ou met à jour celui visé, et renvoie le résultat.
#[tauri::command]
pub fn save_profile(
    id: Option<String>,
    label: String,
    name: String,
    email: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<Profile, AppError> {
    lock(&state)?.save_profile(id, label, name, email)
}

#[tauri::command]
pub fn delete_profile(id: String, state: State<'_, Mutex<AppState>>) -> Result<(), AppError> {
    lock(&state)?.delete_profile(&id)
}

/// Identité sous laquelle l'onglet commite, et si elle lui est propre.
#[tauri::command]
pub fn get_identity(
    repo_id: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<Identity, AppError> {
    lock(&state)?.backend(&repo_id)?.identity()
}

/// Applique un profil au dépôt : son identité est écrite dans la config locale.
#[tauri::command]
pub fn set_identity(
    repo_id: String,
    name: String,
    email: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<Identity, AppError> {
    let guard = lock(&state)?;
    let backend = guard.backend(&repo_id)?;
    backend.set_identity(&name, &email)?;
    backend.identity()
}

/// Retire l'identité propre au dépôt : retour à la configuration globale.
#[tauri::command]
pub fn clear_identity(
    repo_id: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<Identity, AppError> {
    let guard = lock(&state)?;
    let backend = guard.backend(&repo_id)?;
    backend.clear_identity()?;
    backend.identity()
}

#[tauri::command]
pub fn list_stashes(
    repo_id: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<Vec<StashEntry>, AppError> {
    lock(&state)?.backend(&repo_id)?.stashes()
}

/// Remise les modifications locales (fichiers non suivis compris) sous le
/// message donné, construit comme celui d'un commit.
#[tauri::command]
pub fn stash_save(
    repo_id: String,
    summary: String,
    body: Option<String>,
    state: State<'_, Mutex<AppState>>,
) -> Result<(), AppError> {
    lock(&state)?
        .backend(&repo_id)?
        .stash_save(&summary, body.as_deref())
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

// ── Pull requests ───────────────────────────────────────────────────────────

/// Nom de l'événement portant la liste des pull requests (voir `src/lib/api.ts`).
const PR_EVENT: &str = "repo://pull-requests";

/// Charge les pull requests du dépôt **en tâche de fond**, comme fetch et push,
/// et pour la même raison : c'est un appel réseau, et le corps d'une commande
/// tient le `Mutex` de l'état.
///
/// Deux différences avec eux, toutes deux voulues :
///
/// - **aucune réservation réseau n'est prise.** Un fetch et un push se disputent
///   `refs/remotes/**` ; lire une API n'écrit rien du tout sur le disque, donc
///   rien ne justifierait de griser les trois boutons de la barre pendant ce
///   temps. C'est le frontend qui évite de relancer deux fois de suite.
/// - **l'URL du distant est lue tout de suite**, sous le verrou, avant de partir
///   sur le thread : c'est elle qui nomme la forge et le dépôt. Un dépôt sans
///   distant échoue donc immédiatement, en retour de commande, et la section
///   n'a pas d'événement à attendre.
#[tauri::command]
pub fn load_pull_requests(
    repo_id: String,
    include_closed: bool,
    app: AppHandle,
    state: State<'_, Mutex<AppState>>,
) -> Result<(), AppError> {
    let url = {
        let guard = lock(&state)?;
        guard.backend(&repo_id)?.remote_info(None)?.url
    };

    std::thread::spawn(move || {
        let outcome = crate::forge::detect(&url)
            .ok_or(AppError::ForgeUnsupported)
            .and_then(|remote| crate::forge::open(&remote))
            .and_then(|forge| forge.pull_requests(include_closed));

        let (report, error) = match outcome {
            Ok(report) => (Some(report), None),
            Err(e) => (None, Some(e)),
        };
        let _ = app.emit(
            PR_EVENT,
            PullRequestEvent {
                repo_id,
                report,
                error,
            },
        );
    });

    Ok(())
}

/// Ouvre la page web d'une pull request dans le navigateur du système.
///
/// C'est la seule chose que l'application ouvre à l'extérieur, et le filtre est
/// ici plutôt que dans les capacités : le plugin `opener` n'est **pas**
/// enregistré, donc le webview n'a aucune commande « ouvre cette URL » à sa
/// disposition — il ne peut demander que ce que celle-ci accepte, à savoir la
/// page d'une forge reconnue.
#[tauri::command]
pub fn open_pull_request(url: String) -> Result<(), AppError> {
    if !crate::forge::is_openable(&url) {
        return Err(AppError::Io(format!("Adresse refusée : {url}")));
    }
    tauri_plugin_opener::open_url(url, None::<&str>)
        .map_err(|e| AppError::Io(e.to_string()))
}
