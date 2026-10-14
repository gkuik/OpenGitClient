//! Applications externes : le Finder, un terminal, un éditeur — les boutons
//! « Finder », « Terminal » et « Editor » de la barre du dépôt.
//!
//! C'est la seconde chose que l'application ouvre hors d'elle-même, après les
//! pages de forge, et elle suit la même règle : **le webview ne nomme jamais ce
//! qui s'ouvre**. Il envoie un identifiant d'onglet et un genre (`editor` ou
//! `terminal`) ; le dossier vient du backend, l'application d'une liste
//! connue d'ici. Un nom d'application reçu du frontend n'est retenu que s'il
//! figure dans cette liste — sinon la préférence deviendrait un « lance
//! n'importe quel programme » à deux appels de distance.
//!
//! Le lancement passe par `tauri-plugin-opener`, appelé depuis Rust comme pour
//! les pages de forge (le plugin n'est toujours pas enregistré côté webview).
//! Sur macOS, il revient à `open -a <application> <dossier>` : c'est le système
//! qui lance l'application, à qui l'on ne passe qu'un dossier. La règle « pas
//! de `git`, de `ssh` ni d'assistant d'identifiants » n'est pas en cause — rien
//! de Git ne passe par là.

use std::path::{Path, PathBuf};

use crate::error::AppError;

/// Éditeurs connus, dans l'ordre de préférence par défaut — le premier
/// installé est proposé tant que rien n'a été choisi. Le nom est celui du
/// paquet `.app`, et c'est aussi ce qu'attend `open -a`.
///
/// Seules y figurent des applications qui savent ouvrir un **dossier** reçu
/// ainsi : elles en font un projet.
pub const EDITORS: &[&str] = &[
    "Visual Studio Code",
    "Cursor",
    "Zed",
    "Windsurf",
    "VSCodium",
    "Sublime Text",
    "Nova",
    "BBEdit",
    "TextMate",
    "IntelliJ IDEA",
    "IntelliJ IDEA CE",
    "WebStorm",
    "PyCharm",
    "PyCharm CE",
    "RustRover",
    "GoLand",
    "Xcode",
];

/// Terminaux connus qui ouvrent une fenêtre **dans** le dossier reçu par
/// `open -a`. Ceux qui l'ignorent (Alacritty, kitty) n'y sont pas : le bouton
/// ouvrirait un terminal ailleurs, ce qui est pire que pas de bouton.
pub const TERMINALS: &[&str] = &["Terminal", "iTerm", "Ghostty", "Warp"];

/// Terminal de repli, toujours là sur macOS.
const DEFAULT_TERMINAL: &str = "Terminal";

/// Les deux genres d'application que la barre sait ouvrir.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AppKind {
    Editor,
    Terminal,
}

impl AppKind {
    fn known(self) -> &'static [&'static str] {
        match self {
            AppKind::Editor => EDITORS,
            AppKind::Terminal => TERMINALS,
        }
    }
}

/// Dossiers où chercher les applications. Le Terminal de macOS vit dans
/// `/System/Applications/Utilities`, le reste dans `/Applications` (ou celui de
/// l'utilisateur, où atterrissent les installations sans droits
/// d'administrateur).
fn app_dirs() -> Vec<PathBuf> {
    let mut dirs = vec![
        PathBuf::from("/Applications"),
        PathBuf::from("/Applications/Utilities"),
        PathBuf::from("/System/Applications/Utilities"),
    ];
    if let Some(home) = std::env::var_os("HOME") {
        dirs.push(Path::new(&home).join("Applications"));
    }
    dirs
}

fn is_installed(name: &str, dirs: &[PathBuf]) -> bool {
    dirs.iter().any(|d| d.join(format!("{name}.app")).is_dir())
}

/// Les applications connues de ce genre qui sont installées, dans l'ordre de
/// la liste. Vide hors macOS : `open -a` n'y existe pas, et deviner la ligne de
/// commande de chaque éditeur sur chaque système n'est pas à notre portée.
pub fn installed(kind: AppKind) -> Vec<String> {
    if !cfg!(target_os = "macos") {
        return Vec::new();
    }
    let dirs = app_dirs();
    kind.known()
        .iter()
        .filter(|name| is_installed(name, &dirs))
        .map(|name| name.to_string())
        .collect()
}

/// L'application à utiliser : celle choisie si elle est toujours installée,
/// sinon le Terminal pour un terminal, le premier éditeur installé pour un
/// éditeur. `None` : rien d'utilisable — le bouton se grise.
pub fn effective(kind: AppKind, chosen: Option<&str>, installed: &[String]) -> Option<String> {
    if let Some(name) = chosen.filter(|n| installed.iter().any(|i| i == n)) {
        return Some(name.to_string());
    }
    match kind {
        AppKind::Terminal if installed.iter().any(|i| i == DEFAULT_TERMINAL) => {
            Some(DEFAULT_TERMINAL.to_string())
        }
        _ => installed.first().cloned(),
    }
}

/// Un nom reçu du frontend est-il une application que l'on connaît ? Seule
/// garde contre un choix forgé : le reste du module ne lance que ce qui passe.
pub fn is_known(kind: AppKind, name: &str) -> bool {
    kind.known().contains(&name)
}

/// Montre le dossier du dépôt dans le gestionnaire de fichiers, sélectionné
/// dans son parent — « Reveal in Finder ».
pub fn reveal(dir: &Path) -> Result<(), AppError> {
    tauri_plugin_opener::reveal_item_in_dir(dir).map_err(|e| AppError::Io(e.to_string()))
}

/// Ouvre le dossier du dépôt avec cette application.
pub fn open_with(dir: &Path, app: &str) -> Result<(), AppError> {
    tauri_plugin_opener::open_path(dir, Some(app)).map_err(|e| AppError::Io(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn a_chosen_app_wins_while_it_is_installed() {
        let installed = names(&["Visual Studio Code", "Zed"]);
        assert_eq!(
            effective(AppKind::Editor, Some("Zed"), &installed).as_deref(),
            Some("Zed")
        );
        // Désinstallée depuis : on retombe sur le premier éditeur trouvé.
        assert_eq!(
            effective(AppKind::Editor, Some("Cursor"), &installed).as_deref(),
            Some("Visual Studio Code")
        );
    }

    #[test]
    fn the_terminal_defaults_to_apples_own() {
        let installed = names(&["Terminal", "iTerm"]);
        assert_eq!(
            effective(AppKind::Terminal, None, &installed).as_deref(),
            Some("Terminal")
        );
        assert_eq!(effective(AppKind::Editor, None, &[]), None);
    }

    #[test]
    fn only_known_apps_are_accepted() {
        assert!(is_known(AppKind::Editor, "Zed"));
        assert!(!is_known(AppKind::Editor, "Terminal"));
        assert!(!is_known(AppKind::Terminal, "/bin/sh"));
    }
}
