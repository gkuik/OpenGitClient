//! Point d'entrée de la bibliothèque applicative (partagé desktop/mobile).

mod commands;
mod credentials;
mod dto;
mod error;
mod git;
mod state;
mod watcher;

use std::sync::Mutex;

use tauri::Manager;

use state::AppState;

/// Configure et lance l'application Tauri.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // L'état a besoin d'un AppHandle pour persister les dépôts récents.
            let handle = app.handle().clone();
            let state = AppState::new(handle.clone());
            // La fenêtre native prend le thème persisté avant d'être montrée :
            // le frontend ne peut pas s'en charger, il ne repeint que le webview.
            commands::apply_window_theme(&handle, state.theme());
            app.manage(Mutex::new(state));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::open_repository,
            commands::close_repository,
            commands::set_active_repo,
            commands::set_tab_order,
            commands::get_session,
            commands::get_repo_info,
            commands::get_status,
            commands::get_file_diff,
            commands::stage_file,
            commands::unstage_file,
            commands::stage_all,
            commands::unstage_all,
            commands::discard_all,
            commands::commit,
            commands::list_recent,
            commands::list_branches,
            commands::list_remote_branches,
            commands::checkout_branch,
            commands::checkout_remote_branch,
            commands::fetch_remote,
            commands::push_branch,
            commands::pull,
            commands::abort_merge,
            commands::merge_branches,
            commands::get_pull_mode,
            commands::set_pull_mode,
            commands::get_theme,
            commands::set_theme,
            commands::get_font_size,
            commands::set_font_size,
            commands::get_sidebar_widths,
            commands::set_sidebar_widths,
            commands::get_remote_info,
            commands::set_credentials,
            commands::forget_credentials,
            commands::has_credentials,
            commands::list_profiles,
            commands::save_profile,
            commands::delete_profile,
            commands::get_identity,
            commands::set_identity,
            commands::clear_identity,
            commands::list_stashes,
            commands::stash_save,
            commands::stash_apply,
            commands::stash_pop,
            commands::stash_drop,
            commands::commit_graph,
            commands::commit_details,
            commands::commit_file_diff,
        ])
        .run(tauri::generate_context!())
        .expect("erreur au démarrage de l'application Tauri");
}
