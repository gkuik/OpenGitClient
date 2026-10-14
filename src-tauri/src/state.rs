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
    sanitize_toolbar, GitFlowConfig, GraphColumns, GraphLineStyle, Profile, PullMode, RecentRepo, SessionInfo, SidebarWidths,
    ThemeMode, AUTO_FETCH_MINUTES_DEFAULT, AUTO_FETCH_MINUTES_MAX, FONT_SIZE_DEFAULT,
    FONT_SIZE_MAX, FONT_SIZE_MIN, GRAPH_ROUNDNESS_DEFAULT, GRAPH_ROUNDNESS_MAX,
};
use crate::error::AppError;
use crate::external::AppKind;
use crate::git::{open_repository, GitBackend};
use crate::watcher::RepoWatcher;

const RECENT_FILE: &str = "recent.json";
const SESSION_FILE: &str = "session.json";
const PROFILES_FILE: &str = "profiles.json";
const PREFS_FILE: &str = "prefs.json";
const PROJECTS_FILE: &str = "projects.json";
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
    /// Réglages propres à un dépôt **qui ne sont pas du Git** — aujourd'hui le
    /// seul nom d'affichage —, indexés par chemin canonique comme les onglets.
    /// Ce qui est du Git (identité, distants) vit dans la config du dépôt et
    /// n'est jamais recopié ici : aucun autre outil ne lirait ce fichier.
    projects: HashMap<String, ProjectPrefs>,
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
        migrate_legacy_config(&app);
        let recent = load_json(&app, RECENT_FILE).unwrap_or_default();
        let profiles = load_json(&app, PROFILES_FILE).unwrap_or_default();
        let prefs = load_json(&app, PREFS_FILE).unwrap_or_default();
        let projects = load_json(&app, PROJECTS_FILE).unwrap_or_default();
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
            projects,
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

    /// Une opération réseau tourne-t-elle sur ce dépôt ? Renommer ou retirer un
    /// distant réécrit `refs/remotes/**`, que le thread réseau écrit aussi.
    pub fn is_networking(&self, id: &str) -> bool {
        self.networking.contains(id)
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

    /// Disposition du tableau du graph, nettoyée à la lecture comme les
    /// largeurs : le fichier peut avoir été édité à la main.
    pub fn graph_columns(&self) -> GraphColumns {
        self.prefs.graph_columns.clone().sanitized()
    }

    /// Change la disposition du tableau du graph et la persiste.
    pub fn set_graph_columns(&mut self, columns: GraphColumns) -> Result<(), AppError> {
        self.prefs.graph_columns = columns.sanitized();
        save_json(&self.app, PREFS_FILE, &self.prefs)
    }

    /// Éditeur ou terminal choisi, tel qu'enregistré (pas encore confronté à
    /// ce qui est installé : c'est `external::effective` qui tranche).
    pub fn external_app(&self, kind: AppKind) -> Option<String> {
        match kind {
            AppKind::Editor => self.prefs.editor.clone(),
            AppKind::Terminal => self.prefs.terminal.clone(),
        }
    }

    /// Choisit un éditeur ou un terminal ; `None` revient au défaut. Le nom a
    /// déjà été confronté à la liste connue par la commande.
    pub fn set_external_app(&mut self, kind: AppKind, name: Option<String>) -> Result<(), AppError> {
        match kind {
            AppKind::Editor => self.prefs.editor = name,
            AppKind::Terminal => self.prefs.terminal = name,
        }
        save_json(&self.app, PREFS_FILE, &self.prefs)
    }

    /// Barre du dépôt, nettoyée à la lecture ; `None` si jamais personnalisée.
    pub fn toolbar(&self) -> Option<Vec<String>> {
        self.prefs.toolbar.clone().map(sanitize_toolbar)
    }

    /// Change la barre du dépôt et la persiste ; `None` la remet par défaut.
    pub fn set_toolbar(&mut self, items: Option<Vec<String>>) -> Result<(), AppError> {
        self.prefs.toolbar = items.map(sanitize_toolbar);
        save_json(&self.app, PREFS_FILE, &self.prefs)
    }

    /// Tracé des lignes du graph.
    pub fn graph_lines(&self) -> GraphLineStyle {
        self.prefs.graph_lines
    }

    /// Change le tracé des lignes du graph et le persiste.
    pub fn set_graph_lines(&mut self, style: GraphLineStyle) -> Result<(), AppError> {
        self.prefs.graph_lines = style;
        save_json(&self.app, PREFS_FILE, &self.prefs)
    }

    /// Arrondi du tracé du graph, en pourcentage — ramené dans ses bornes à la
    /// lecture comme à l'écriture, le fichier pouvant avoir été édité à la main.
    pub fn graph_roundness(&self) -> u8 {
        self.prefs.graph_roundness.min(GRAPH_ROUNDNESS_MAX)
    }

    /// Change l'arrondi du tracé du graph et le persiste.
    pub fn set_graph_roundness(&mut self, roundness: u8) -> Result<(), AppError> {
        self.prefs.graph_roundness = roundness.min(GRAPH_ROUNDNESS_MAX);
        save_json(&self.app, PREFS_FILE, &self.prefs)
    }

    /// Intervalle de l'auto-fetch, en minutes (0 = désactivé) — ramené dans ses
    /// bornes à la lecture comme à l'écriture.
    pub fn auto_fetch_minutes(&self) -> u8 {
        self.prefs.auto_fetch_minutes.min(AUTO_FETCH_MINUTES_MAX)
    }

    /// Change l'intervalle de l'auto-fetch et le persiste.
    pub fn set_auto_fetch_minutes(&mut self, minutes: u8) -> Result<(), AppError> {
        self.prefs.auto_fetch_minutes = minutes.min(AUTO_FETCH_MINUTES_MAX);
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

    /// Noms d'affichage des dépôts, par chemin canonique. Seuls ceux qui en ont
    /// un figurent dans la table.
    pub fn aliases(&self) -> HashMap<String, String> {
        self.projects
            .iter()
            .filter_map(|(id, p)| p.alias.clone().map(|a| (id.clone(), a)))
            .collect()
    }

    /// Fixe le nom d'affichage d'un dépôt, ou le retire avec `None` — une
    /// chaîne vide ou blanche vaut retrait : un onglet sans nom ne se
    /// retrouverait plus. Renvoie le nom retenu.
    pub fn set_alias(&mut self, id: &str, alias: Option<String>) -> Result<Option<String>, AppError> {
        let alias = alias
            .map(|a| a.trim().to_string())
            .filter(|a| !a.is_empty());
        match &alias {
            Some(a) => {
                self.projects.entry(id.to_string()).or_default().alias = Some(a.clone());
            }
            None => {
                if let Some(p) = self.projects.get_mut(id) {
                    p.alias = None;
                }
                // Une entrée vidée de tout réglage n'a plus rien à faire dans le
                // fichier.
                self.projects.retain(|_, p| !p.is_empty());
            }
        }
        save_json(&self.app, PROJECTS_FILE, &self.projects)?;
        Ok(alias)
    }

    /// Réglages Git Flow d'un dépôt, `None` s'il n'en a jamais eu.
    pub fn git_flow(&self, id: &str) -> Option<GitFlowConfig> {
        self.projects
            .get(id)
            .and_then(|p| p.git_flow.clone())
            .map(GitFlowConfig::sanitized)
    }

    /// Enregistre les réglages Git Flow d'un dépôt, et renvoie leur version
    /// nettoyée — celle que le frontend doit afficher.
    pub fn set_git_flow(&mut self, id: &str, config: GitFlowConfig) -> Result<GitFlowConfig, AppError> {
        let config = config.sanitized();
        self.projects.entry(id.to_string()).or_default().git_flow = Some(config.clone());
        save_json(&self.app, PROJECTS_FILE, &self.projects)?;
        Ok(config)
    }

    /// Liste des récents sous forme sérialisable : chemin, et le nom
    /// d'affichage du dépôt s'il en a un, celui de son dossier sinon.
    pub fn recent_list(&self) -> Vec<RecentRepo> {
        self.recent
            .iter()
            .map(|p| {
                let path = p.to_string_lossy().to_string();
                let alias = self.projects.get(&path).and_then(|pr| pr.alias.clone());
                RecentRepo {
                    name: alias.unwrap_or_else(|| {
                        p.file_name()
                            .map(|n| n.to_string_lossy().to_string())
                            .unwrap_or_else(|| path.clone())
                    }),
                    path,
                }
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

/// Identifiant de l'application quand elle s'appelait GitLite : le dossier de
/// configuration porte son nom.
const LEGACY_IDENTIFIER: &str = "com.gitlite.app";

/// Reprend la configuration écrite sous l'ancien identifiant (récents, session,
/// profils, préférences). Le dossier est déplacé tel quel, et seulement si le
/// nouveau n'existe pas encore : une fois l'application lancée sous son nouveau
/// nom, c'est lui qui fait foi. Un échec n'empêche pas de démarrer, on repart
/// simplement de zéro.
fn migrate_legacy_config(app: &AppHandle) {
    let Ok(dir) = app.path().app_config_dir() else {
        return;
    };
    let Some(legacy) = dir.parent().map(|p| p.join(LEGACY_IDENTIFIER)) else {
        return;
    };
    if legacy != dir && legacy.is_dir() && !dir.exists() {
        let _ = fs::rename(&legacy, &dir);
    }
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
    /// Disposition du tableau du graph : ordre, colonnes masquées, largeurs.
    graph_columns: GraphColumns,
    /// Tracé des lignes du graph quand elles changent de colonne.
    graph_lines: GraphLineStyle,
    /// Arrondi de ce tracé, en pourcentage (tracés arrondi et courbe).
    graph_roundness: u8,
    /// Intervalle de l'auto-fetch, en minutes ; 0 le désactive.
    auto_fetch_minutes: u8,
    /// Éléments de la barre du dépôt, dans l'ordre. `None` tant qu'elle n'a
    /// jamais été personnalisée — distinct d'une liste vide, qui est une barre
    /// vide voulue.
    toolbar: Option<Vec<String>>,
    /// Éditeur et terminal choisis, par nom d'application. `None` : le défaut,
    /// recalculé à chaque lecture d'après ce qui est installé.
    editor: Option<String>,
    terminal: Option<String>,
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
            graph_columns: GraphColumns::default(),
            graph_lines: GraphLineStyle::default(),
            graph_roundness: GRAPH_ROUNDNESS_DEFAULT,
            // Écrit à la main lui aussi : dérivé, il vaudrait 0, et un
            // `prefs.json` d'avant ce réglage démarrerait sans auto-fetch.
            auto_fetch_minutes: AUTO_FETCH_MINUTES_DEFAULT,
            toolbar: None,
            editor: None,
            terminal: None,
        }
    }
}

/// Réglages d'un dépôt propres à l'application, persistés dans `projects.json`.
/// `default` sur chaque champ : un fichier écrit par une version antérieure
/// — ou à laquelle il manquera un réglage futur — se lit quand même.
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct ProjectPrefs {
    /// Nom affiché à la place de celui du dossier : onglet, barre du dépôt,
    /// récents.
    alias: Option<String>,
    /// Git Flow. `None` tant qu'on n'y a jamais touché : le frontend propose
    /// alors des valeurs déduites des branches du dépôt. Désactivé, il reste
    /// enregistré, pour qu'un ordre de colonnes réglé ne se perde pas.
    git_flow: Option<GitFlowConfig>,
}

impl ProjectPrefs {
    fn is_empty(&self) -> bool {
        self.alias.is_none() && self.git_flow.is_none()
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
