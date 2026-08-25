//! État partagé de l'application + persistance des dépôts récents.

use std::fs;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use crate::dto::RecentRepo;
use crate::error::AppError;
use crate::git::{open_repository, GitBackend};

const RECENT_FILE: &str = "recent.json";
const RECENT_MAX: usize = 10;

/// État applicatif, protégé par un `Mutex` (voir `lib.rs`).
///
/// L'architecture prévoit déjà un seul dépôt courant, mais rien n'empêche
/// d'évoluer vers plusieurs onglets/dépôts plus tard (le champ `current`
/// deviendrait une collection).
pub struct AppState {
    /// Backend Git du dépôt actuellement ouvert (aucun au démarrage).
    current: Option<Box<dyn GitBackend>>,
    /// Chemins des dépôts récemment ouverts (persistés sur disque).
    recent: Vec<PathBuf>,
    /// Handle Tauri pour résoudre le dossier de configuration.
    app: AppHandle,
}

impl AppState {
    /// Construit l'état et charge la liste des récents si elle existe.
    pub fn new(app: AppHandle) -> Self {
        let recent = load_recent(&app).unwrap_or_default();
        Self {
            current: None,
            recent,
            app,
        }
    }

    /// Ouvre un dépôt, le fixe comme courant et l'ajoute aux récents.
    pub fn open(&mut self, path: &Path) -> Result<(), AppError> {
        let backend = open_repository(path)?;
        self.current = Some(backend);
        self.push_recent(path.to_path_buf());
        Ok(())
    }

    /// Emprunte le backend courant, ou `NoRepoOpen` si aucun dépôt n'est ouvert.
    pub fn backend(&self) -> Result<&dyn GitBackend, AppError> {
        self.current.as_deref().ok_or(AppError::NoRepoOpen)
    }

    /// Liste des récents sous forme sérialisable (chemin + nom du dossier).
    pub fn recent_list(&self) -> Vec<RecentRepo> {
        self.recent
            .iter()
            .map(|p| RecentRepo {
                path: p.to_string_lossy().to_string(),
                name: p
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| p.to_string_lossy().to_string()),
            })
            .collect()
    }

    fn push_recent(&mut self, path: PathBuf) {
        self.recent.retain(|p| p != &path);
        self.recent.insert(0, path);
        self.recent.truncate(RECENT_MAX);
        // La persistance ne doit jamais faire échouer l'ouverture d'un dépôt.
        let _ = save_recent(&self.app, &self.recent);
    }
}

fn recent_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| AppError::Io(e.to_string()))?;
    Ok(dir.join(RECENT_FILE))
}

fn load_recent(app: &AppHandle) -> Result<Vec<PathBuf>, AppError> {
    let file = recent_path(app)?;
    if !file.exists() {
        return Ok(Vec::new());
    }
    let data = fs::read_to_string(&file)?;
    let list: Vec<String> = serde_json::from_str(&data).unwrap_or_default();
    Ok(list.into_iter().map(PathBuf::from).collect())
}

fn save_recent(app: &AppHandle, recent: &[PathBuf]) -> Result<(), AppError> {
    let file = recent_path(app)?;
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent)?;
    }
    let list: Vec<String> = recent
        .iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect();
    let data = serde_json::to_string_pretty(&list).map_err(|e| AppError::Io(e.to_string()))?;
    fs::write(&file, data)?;
    Ok(())
}
