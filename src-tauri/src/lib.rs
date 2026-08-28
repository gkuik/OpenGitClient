//! Point d'entrée de la bibliothèque applicative (partagé desktop/mobile).

mod commands;
mod dto;
mod error;
mod git;
mod state;

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
            app.manage(Mutex::new(AppState::new(handle)));
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
            commands::commit,
            commands::list_recent,
            commands::list_branches,
            commands::checkout_branch,
            commands::list_stashes,
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
