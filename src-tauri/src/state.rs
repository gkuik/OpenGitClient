//! État partagé de l'application + persistance des dépôts récents et de la session.
//!
//! Plusieurs dépôts peuvent être ouverts simultanément (un par onglet). Chacun est
//! identifié par son **chemin canonique**, qui sert d'identifiant d'onglet :
//! stable d'une session à l'autre, unique par dépôt (donc pas de doublon possible)
//! et directement persistable.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::dto::{
    Profile, PullMode, RecentRepo, SessionInfo, SidebarWidths, ThemeMode, FONT_SIZE_DEFAULT,
    FONT_SIZE_MAX, FONT_SIZE_MIN,
};
use crate::error::AppError;
use crate::git::{open_repository, GitBackend};
use crate::watcher::RepoWatcher;

const RECENT_FILE: &str = "recent.json";
const SESSION_FILE: &str = "session.json";
const PROFILES_FILE: &str = "profiles.json";
const PREFS_FILE: &str = "prefs.json";
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
    /// Dépôts dont une opération réseau est en cours. Fetch **et** push écrivent
    /// `refs/remotes/**` (libgit2 met les tips à jour après un push) : les en
    /// laisser deux se croiser sur le même dépôt les ferait se disputer ces
    /// références.
    networking: HashSet<String>,
    /// Chemins des dépôts récemment ouverts (persistés sur disque).
    recent: Vec<PathBuf>,
    /// Préférences de l'application, communes à tous les onglets.
    prefs: Prefs,
    /// Profils d'auteur, partagés par tous les dépôts (persistés sur disque).
    /// Le dépôt, lui, ne retient pas *quel* profil : son identité vit dans sa
    /// propre config Git (voir `GitBackend::set_identity`), ce qui évite d'avoir
    /// à maintenir une association en double.
    profiles: Vec<Profile>,
    /// Surveillance du disque : elle émet `repo://changed` pour les dépôts
    /// ouverts, afin que l'interface reflète ce qu'un autre outil modifie.
    /// `None` si le système ne la permet pas — l'application marche alors comme
    /// avant, sans rafraîchissement automatique.
    watcher: Option<RepoWatcher>,
    /// Handle Tauri pour résoudre le dossier de configuration.
    app: AppHandle,
}

impl AppState {
    /// Construit l'état et charge les récents + la session si elles existent.
    pub fn new(app: AppHandle) -> Self {
        let recent = load_json(&app, RECENT_FILE).unwrap_or_default();
        let profiles = load_json(&app, PROFILES_FILE).unwrap_or_default();
        let prefs = load_json(&app, PREFS_FILE).unwrap_or_default();
        let session: Session = load_json(&app, SESSION_FILE).unwrap_or_default();
        let watcher = RepoWatcher::new(app.clone());
        Self {
            repos: HashMap::new(),
            order: Vec::new(),
            active: session.active,
            networking: HashSet::new(),
            recent,
            prefs,
            profiles,
            watcher,
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
            // Le dépôt vient d'être ouvert : le mettre sous surveillance ici
            // plutôt qu'au niveau de la commande garantit qu'aucun onglet ne
            // puisse exister sans elle — restauration de session comprise.
            if let Some(watcher) = self.watcher.as_mut() {
                watcher.watch(&id, &canonical);
            }
        }

        self.active = Some(id.clone());
        self.push_recent(canonical);
        self.save_session();
        Ok(id)
    }

    /// Réserve le dépôt pour une opération réseau (fetch ou push). `false` si
    /// une autre y tourne déjà — le thread en cours finira par la libérer via
    /// [`Self::end_network`].
    pub fn begin_network(&mut self, id: &str) -> bool {
        self.networking.insert(id.to_string())
    }

    /// Libère la réservation posée par [`Self::begin_network`].
    pub fn end_network(&mut self, id: &str) {
        self.networking.remove(id);
    }

    /// Ferme un onglet. Sans effet si l'identifiant est inconnu.
    pub fn close(&mut self, id: &str) {
        self.repos.remove(id);
        if let Some(watcher) = self.watcher.as_mut() {
            watcher.unwatch(id);
        }
        // Une opération réseau peut encore tourner sur ce dépôt : sa réservation
        // part avec l'onglet, sinon elle en bloquerait une après réouverture.
        self.networking.remove(id);
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

    /// Mode exécuté par le bouton Pull.
    pub fn pull_mode(&self) -> PullMode {
        self.prefs.pull_mode
    }

    /// Change le mode du bouton Pull et le persiste.
    pub fn set_pull_mode(&mut self, mode: PullMode) -> Result<(), AppError> {
        self.prefs.pull_mode = mode;
        save_json(&self.app, PREFS_FILE, &self.prefs)
    }

    /// Thème de l'interface.
    pub fn theme(&self) -> ThemeMode {
        self.prefs.theme
    }

    /// Change le thème et le persiste.
    pub fn set_theme(&mut self, theme: ThemeMode) -> Result<(), AppError> {
        self.prefs.theme = theme;
        save_json(&self.app, PREFS_FILE, &self.prefs)
    }

    /// Taille du corps de texte, en points.
    ///
    /// Toujours ramenée dans les bornes à la lecture comme à l'écriture : le
    /// fichier peut avoir été édité à la main, et une police de 200 pt rendrait
    /// les paramètres — donc le réglage lui-même — inatteignables.
    pub fn font_size(&self) -> u8 {
        self.prefs.font_size.clamp(FONT_SIZE_MIN, FONT_SIZE_MAX)
    }

    /// Change la taille du corps de texte et la persiste.
    pub fn set_font_size(&mut self, size: u8) -> Result<(), AppError> {
        self.prefs.font_size = size.clamp(FONT_SIZE_MIN, FONT_SIZE_MAX);
        save_json(&self.app, PREFS_FILE, &self.prefs)
    }

    /// Largeurs des colonnes latérales, en rem.
    ///
    /// Ramenées dans les bornes à la lecture comme à l'écriture, pour la même
    /// raison que la taille du texte : le fichier peut avoir été édité à la
    /// main, et une colonne démesurée rendrait le réglage lui-même inatteignable.
    pub fn sidebar_widths(&self) -> SidebarWidths {
        self.prefs.sidebars.clamped()
    }

    /// Change les largeurs et les persiste.
    pub fn set_sidebar_widths(&mut self, widths: SidebarWidths) -> Result<(), AppError> {
        self.prefs.sidebars = widths.clamped();
        save_json(&self.app, PREFS_FILE, &self.prefs)
    }

    pub fn profiles(&self) -> Vec<Profile> {
        self.profiles.clone()
    }

    /// Crée ou met à jour un profil, et renvoie sa version enregistrée.
    ///
    /// Un `id` absent signifie « création » : il est généré ici, car le libellé
    /// peut être renommé sans que l'identité choisie dans un dépôt ne se perde.
    pub fn save_profile(
        &mut self,
        id: Option<String>,
        label: String,
        name: String,
        email: String,
    ) -> Result<Profile, AppError> {
        let profile = Profile {
            id: id.unwrap_or_else(new_profile_id),
            label,
            name,
            email,
        };
        match self.profiles.iter_mut().find(|p| p.id == profile.id) {
            Some(existing) => *existing = profile.clone(),
            None => self.profiles.push(profile.clone()),
        }
        save_json(&self.app, PROFILES_FILE, &self.profiles)?;
        Ok(profile)
    }

    /// Supprime un profil. Les dépôts qui l'utilisaient gardent leur identité :
    /// elle vit dans leur config Git, pas ici.
    pub fn delete_profile(&mut self, id: &str) -> Result<(), AppError> {
        self.profiles.retain(|p| p.id != id);
        save_json(&self.app, PROFILES_FILE, &self.profiles)
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
/// Préférences persistées dans `prefs.json`. `Default` couvre le premier
/// lancement comme un fichier illisible : l'application démarre toujours, quitte
/// à repartir des valeurs par défaut.
#[derive(Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct Prefs {
    pull_mode: PullMode,
    theme: ThemeMode,
    /// Corps de texte, en points.
    font_size: u8,
    /// Largeurs des deux colonnes latérales, en rem.
    sidebars: SidebarWidths,
}

/// `Default` est écrit à la main, pas dérivé : `u8::default()` vaudrait 0, et
/// un `prefs.json` écrit par une version antérieure — où le champ n'existait
/// pas — démarrerait donc avec une police de taille nulle.
impl Default for Prefs {
    fn default() -> Self {
        Self {
            pull_mode: PullMode::default(),
            theme: ThemeMode::default(),
            font_size: FONT_SIZE_DEFAULT,
            sidebars: SidebarWidths::default(),
        }
    }
}

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

/// Identifiant de profil : l'horodatage suffit, les profils étant créés un par un
/// à la main. Évite une dépendance de plus pour générer un UUID.
fn new_profile_id() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("p{nanos}")
}
