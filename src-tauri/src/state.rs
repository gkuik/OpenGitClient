//! État partagé de l'application + persistance des dépôts récents et de la session.
//!
//! Plusieurs dépôts peuvent être ouverts simultanément (un par onglet). Chacun est
//! identifié par son **chemin canonique**, qui sert d'identifiant d'onglet :
//! stable d'une session à l'autre, unique par dépôt (donc pas de doublon possible)
//! et directement persistable.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::dto::{RecentRepo, SessionInfo};
use crate::error::AppError;
use crate::git::{open_repository, GitBackend};

const RECENT_FILE: &str = "recent.json";
const SESSION_FILE: &str = "session.json";
const RECENT_MAX: usize = 10;

/// Session persistée : onglets ouverts et onglet actif, pour restaurer l'espace
/// de travail au lancement.
#[derive(Debug, Default, Serialize, Deserialize)]
struct Session {
    tabs: Vec<String>,
    active: Option<String>,
}

/// État applicatif, protégé par un `Mutex` (voir `lib.rs`).
pub struct AppState {
    /// Dépôts ouverts, indexés par chemin canonique.
    repos: HashMap<String, Box<dyn GitBackend>>,
    /// Ordre d'affichage des onglets (la `HashMap` n'en a aucun).
    order: Vec<String>,
    /// Onglet actif. Le backend n'en dépend pas — chaque commande reçoit son
    /// `repo_id` — mais on le persiste pour restaurer la session.
    active: Option<String>,
    /// Chemins des dépôts récemment ouverts (persistés sur disque).
    recent: Vec<PathBuf>,
    /// Handle Tauri pour résoudre le dossier de configuration.
    app: AppHandle,
}

impl AppState {
    /// Construit l'état et charge les récents + la session si elles existent.
    pub fn new(app: AppHandle) -> Self {
        let recent = load_json(&app, RECENT_FILE).unwrap_or_default();
        let session: Session = load_json(&app, SESSION_FILE).unwrap_or_default();
        Self {
            repos: HashMap::new(),
            order: Vec::new(),
            active: session.active,
            recent,
            app,
        }
        .with_pending_tabs(session.tabs)
    }

    /// Les onglets persistés ne sont pas ouverts ici : le frontend les rouvre un
    /// par un via `open_repository`, ce qui laisse tomber proprement un dépôt
    /// disparu du disque sans faire échouer le démarrage.
    fn with_pending_tabs(mut self, tabs: Vec<String>) -> Self {
        self.order = tabs;
        self
    }

    /// Ouvre un dépôt (ou réactive celui déjà ouvert) et renvoie son identifiant.
    pub fn open(&mut self, path: &Path) -> Result<String, AppError> {
        // Canonicaliser d'abord : deux chemins différents vers le même dossier
        // doivent donner le même onglet.
        let canonical = fs::canonicalize(path).map_err(|_| AppError::NotARepository)?;
        let id = canonical.to_string_lossy().to_string();

        if !self.repos.contains_key(&id) {
            let backend = open_repository(&canonical)?;
            self.repos.insert(id.clone(), backend);
            // Un onglet restauré est déjà dans `order` : ne pas le dupliquer ni
            // le déplacer en fin de barre.
            if !self.order.contains(&id) {
                self.order.push(id.clone());
            }
        }

        self.active = Some(id.clone());
        self.push_recent(canonical);
        self.save_session();
        Ok(id)
    }

    /// Ferme un onglet. Sans effet si l'identifiant est inconnu.
    pub fn close(&mut self, id: &str) {
        self.repos.remove(id);
        self.order.retain(|t| t != id);
        if self.active.as_deref() == Some(id) {
            self.active = self.order.last().cloned();
        }
        self.save_session();
    }

    /// Mémorise l'onglet actif (pour la restauration au prochain lancement).
    pub fn set_active(&mut self, id: &str) {
        if self.repos.contains_key(id) {
            self.active = Some(id.to_string());
            self.save_session();
        }
    }

    /// Réordonne les onglets (glisser-déposer dans la barre).
    ///
    /// L'ordre reçu du frontend fait foi mais reste filtré : un identifiant
    /// inconnu est ignoré, et un onglet ouvert absent de la liste est conservé
    /// en fin de barre — une liste partielle ou périmée ne doit jamais faire
    /// disparaître un dépôt de la session.
    pub fn set_order(&mut self, order: Vec<String>) {
        let mut next: Vec<String> = Vec::with_capacity(self.order.len());
        for id in order {
            if self.repos.contains_key(&id) && !next.contains(&id) {
                next.push(id);
            }
        }
        for id in &self.order {
            if !next.contains(id) {
                next.push(id.clone());
            }
        }
        self.order = next;
        self.save_session();
    }

    /// Emprunte le backend d'un onglet, ou `NoRepoOpen` s'il n'est pas ouvert.
    pub fn backend(&self, id: &str) -> Result<&dyn GitBackend, AppError> {
        self.repos
            .get(id)
            .map(|b| b.as_ref())
            .ok_or(AppError::NoRepoOpen)
    }

    /// Session à restaurer au démarrage (onglets persistés + onglet actif).
    pub fn session(&self) -> SessionInfo {
        SessionInfo {
            tabs: self.order.clone(),
            active: self.active.clone(),
        }
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
        let _ = save_json(&self.app, RECENT_FILE, &self.recent);
    }

    fn save_session(&self) {
        let session = Session {
            tabs: self.order.clone(),
            active: self.active.clone(),
        };
        let _ = save_json(&self.app, SESSION_FILE, &session);
    }
}

fn config_path(app: &AppHandle, file: &str) -> Result<PathBuf, AppError> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| AppError::Io(e.to_string()))?;
    Ok(dir.join(file))
}

/// Lit un fichier de configuration JSON. Absence ou contenu illisible donnent
/// `None` : une configuration corrompue ne doit pas empêcher l'app de démarrer.
fn load_json<T: for<'de> Deserialize<'de>>(app: &AppHandle, file: &str) -> Option<T> {
    let path = config_path(app, file).ok()?;
    let data = fs::read_to_string(path).ok()?;
    serde_json::from_str(&data).ok()
}

fn save_json<T: Serialize>(app: &AppHandle, file: &str, value: &T) -> Result<(), AppError> {
    let path = config_path(app, file)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let data = serde_json::to_string_pretty(value).map_err(|e| AppError::Io(e.to_string()))?;
    fs::write(&path, data)?;
    Ok(())
}
