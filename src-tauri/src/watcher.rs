//! Surveillance du disque : refléter en direct ce qu'un autre outil change.
//!
//! Un éditeur qui enregistre, un `git checkout` au terminal, un autre client
//! Git : le dépôt bouge sous les pieds de l'application, qui jusqu'ici ne le
//! voyait qu'au retour sur l'onglet. Ce module écoute le système de fichiers et
//! émet `repo://changed`, que le frontend route vers l'onglet concerné — même
//! contrat que `repo://fetched`, à ceci près que personne ne l'a demandé.
//!
//! **Rien n'est jamais récupéré du réseau ici.** Un fetch reste une action
//! explicite ; ce module ne fait que relire ce qui est déjà sur le disque.
//!
//! Trois principes, qui sont tout le sujet :
//!
//! - **Un seul watcher pour tous les onglets.** `notify` accepte plusieurs
//!   chemins sur la même instance : un thread au total, et non un par dépôt.
//! - **Le callback ne touche jamais à `AppState`.** Il tourne sur le thread de
//!   `notify` pendant qu'une commande peut tenir le `Mutex` de l'état ; il n'a
//!   ici accès qu'au registre des dépôts surveillés, qui a son propre verrou et
//!   n'est jamais pris en sens inverse.
//! - **Le filtrage est vital, pas cosmétique.** Une compilation dans le dépôt
//!   émet des milliers d'événements à la seconde. Trois étages les arrêtent :
//!   la liste blanche du dossier Git, les règles d'exclusion du dépôt
//!   ([`GitBackend::filter_ignored`]), et le regroupement temporel du debouncer.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use notify_debouncer_mini::notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, DebouncedEvent, Debouncer};
use tauri::{AppHandle, Emitter};

use crate::dto::ChangeEvent;
use crate::git::{open_repository, GitBackend};

/// Nom de l'événement émis vers le frontend (voir `src/lib/api.ts`).
const CHANGE_EVENT: &str = "repo://changed";

/// Fenêtre de regroupement des événements.
///
/// Un enregistrement d'éditeur en produit souvent trois (fichier temporaire,
/// renommage, attributs) et une opération Git bien davantage. 300 ms est assez
/// long pour n'en faire qu'un rafraîchissement, assez court pour rester perçu
/// comme immédiat.
const DEBOUNCE: Duration = Duration::from_millis(300);

/// Ce qu'un lot d'événements change pour un dépôt donné.
#[derive(Default)]
struct Change {
    worktree: bool,
    refs: bool,
}

/// Un dépôt surveillé.
struct Watched {
    /// Racine du working directory, absente sur un dépôt nu.
    workdir: Option<PathBuf>,
    gitdir: PathBuf,
    /// Chemins effectivement confiés à `notify`, pour pouvoir les retirer.
    watched: Vec<PathBuf>,
    /// Backend **propre** au watcher, ouvert depuis le chemin comme le fait le
    /// thread du fetch : il sert à interroger les règles d'exclusion sans rien
    /// emprunter à l'état partagé.
    backend: Box<dyn GitBackend>,
}

type Registry = HashMap<String, Watched>;

/// Surveillance du disque pour l'ensemble des onglets ouverts.
pub struct RepoWatcher {
    repos: Arc<Mutex<Registry>>,
    debouncer: Debouncer<RecommendedWatcher>,
}

impl RepoWatcher {
    /// Démarre la surveillance. `None` si le système ne la permet pas :
    /// l'application marche alors comme avant, sans rafraîchissement
    /// automatique — ce n'est pas une erreur à remonter à l'utilisateur.
    pub fn new(app: AppHandle) -> Option<Self> {
        let repos: Arc<Mutex<Registry>> = Arc::new(Mutex::new(Registry::new()));
        let handler_repos = Arc::clone(&repos);

        let debouncer = new_debouncer(DEBOUNCE, move |result: DebounceEventResult| {
            let Ok(events) = result else { return };
            // Un verrou empoisonné (panique dans un autre appel) ne doit pas
            // faire paniquer le thread de notify à son tour.
            let Ok(repos) = handler_repos.lock() else { return };
            dispatch(&app, &repos, events);
        })
        .ok()?;

        Some(Self { repos, debouncer })
    }

    /// Met un dépôt sous surveillance. Sans effet s'il l'est déjà.
    ///
    /// Un échec est silencieux, pour la même raison qu'en construction : perdre
    /// le rafraîchissement automatique d'un onglet ne doit pas empêcher de
    /// l'ouvrir.
    pub fn watch(&mut self, id: &str, path: &Path) {
        {
            let Ok(repos) = self.repos.lock() else { return };
            if repos.contains_key(id) {
                return;
            }
        }

        let Ok(backend) = open_repository(path) else { return };
        let Ok(roots) = backend.watch_roots() else { return };

        // La racine du working directory couvre déjà le `.git` qu'elle contient :
        // ne surveiller le dossier Git à part que s'il est ailleurs — worktree
        // lié ou submodule.
        let mut targets: Vec<PathBuf> = Vec::with_capacity(2);
        if let Some(workdir) = &roots.workdir {
            targets.push(workdir.clone());
        }
        if !roots
            .workdir
            .as_ref()
            .is_some_and(|w| roots.gitdir.starts_with(w))
        {
            targets.push(roots.gitdir.clone());
        }

        let watched: Vec<PathBuf> = targets
            .into_iter()
            .filter(|p| {
                self.debouncer
                    .watcher()
                    .watch(p, RecursiveMode::Recursive)
                    .is_ok()
            })
            .collect();
        if watched.is_empty() {
            return;
        }

        if let Ok(mut repos) = self.repos.lock() {
            repos.insert(
                id.to_string(),
                Watched {
                    workdir: roots.workdir,
                    gitdir: roots.gitdir,
                    watched,
                    backend,
                },
            );
        }
    }

    /// Retire un dépôt de la surveillance (fermeture d'onglet).
    pub fn unwatch(&mut self, id: &str) {
        let Ok(mut repos) = self.repos.lock() else { return };
        let Some(entry) = repos.remove(id) else { return };
        // Le verrou est relâché avant de toucher au watcher : celui-ci peut
        // livrer un lot pendant ce temps, et son callback le reprendrait.
        drop(repos);
        for path in entry.watched {
            let _ = self.debouncer.watcher().unwatch(&path);
        }
    }
}

/// Émet au plus un événement par dépôt concerné par le lot.
fn dispatch(app: &AppHandle, repos: &Registry, events: Vec<DebouncedEvent>) {
    for (repo_id, change) in changes(repos, events) {
        let _ = app.emit(
            CHANGE_EVENT,
            ChangeEvent {
                repo_id,
                worktree: change.worktree,
                refs: change.refs,
            },
        );
    }
}

/// Attribue un lot d'événements aux dépôts surveillés.
///
/// Séparée de l'émission pour être testable : c'est ici que se joue tout le
/// filtrage, et une erreur y ferait soit rater un changement, soit noyer
/// l'interface.
fn changes(repos: &Registry, events: Vec<DebouncedEvent>) -> Vec<(String, Change)> {
    // Chemins du working directory retenus par dépôt : ils ne sont soumis aux
    // règles d'exclusion qu'une fois le lot entier réparti, en un seul appel.
    let mut pending: HashMap<&String, (Change, Vec<PathBuf>)> = HashMap::new();

    for event in events {
        for (id, repo) in repos {
            // Le dossier Git d'abord : il est presque toujours *dans* le working
            // directory, et ses fichiers ne se lisent pas comme les autres.
            if let Ok(rel) = event.path.strip_prefix(&repo.gitdir) {
                if let Some(change) = classify_gitdir(rel) {
                    let slot = pending.entry(id).or_default();
                    slot.0.worktree |= change.worktree;
                    slot.0.refs |= change.refs;
                }
                continue;
            }
            // Un dépôt imbriqué dans un autre appartient aux deux : pas de
            // `break`, le changement concerne réellement les deux statuts.
            if repo.workdir.as_ref().is_some_and(|w| event.path.starts_with(w)) {
                pending.entry(id).or_default().1.push(event.path.clone());
            }
        }
    }

    pending
        .into_iter()
        .filter_map(|(id, (mut change, candidates))| {
            // Inutile d'interroger les règles d'exclusion si l'index a déjà
            // tranché : c'est le cas courant d'un `git` lancé au terminal, qui
            // touche l'index *et* les fichiers dans le même lot.
            if !change.worktree && !candidates.is_empty() {
                change.worktree = !repos[id].backend.filter_ignored(candidates).is_empty();
            }
            (change.worktree || change.refs).then(|| (id.clone(), change))
        })
        .collect()
}

/// Ce qu'un chemin **du dossier Git** implique, ou `None` s'il ne change rien de
/// ce qui est affiché.
///
/// La liste est blanche, et c'est le seul choix tenable : `objects/**` déborde à
/// chaque commit comme à chaque fetch, `index.lock` va et vient à chaque
/// écriture, et `logs/**`, `FETCH_HEAD` ou `COMMIT_EDITMSG` ne se voient nulle
/// part dans l'interface. Une liste noire aurait laissé passer tout ce qu'un
/// futur Git ajoutera.
fn classify_gitdir(rel: &Path) -> Option<Change> {
    let first = rel.components().next()?.as_os_str().to_str()?;
    match first {
        // L'index : c'est le statut qui bouge, pas l'historique.
        "index" => Some(Change {
            worktree: true,
            refs: false,
        }),
        "HEAD" | "ORIG_HEAD" | "packed-refs" | "refs" => Some(Change {
            worktree: false,
            refs: true,
        }),
        // Opérations en cours : elles déplacent HEAD *et* posent des fichiers en
        // conflit dans le working directory.
        "MERGE_HEAD" | "REBASE_HEAD" | "CHERRY_PICK_HEAD" | "REVERT_HEAD" => Some(Change {
            worktree: true,
            refs: true,
        }),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::fs;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    use notify_debouncer_mini::DebouncedEventKind;

    static DIR_COUNTER: AtomicUsize = AtomicUsize::new(0);

    /// Dépôt temporaire enregistré comme le ferait `RepoWatcher::watch`, avec un
    /// `.gitignore`. Les racines viennent du backend : sur macOS le dossier
    /// temporaire n'est pas le chemin canonique, et c'est justement ce que les
    /// événements du disque portent.
    fn temp_registry() -> (PathBuf, Registry) {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let n = DIR_COUNTER.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("opengitclient-watch-{nanos}-{n}"));
        fs::create_dir_all(&dir).unwrap();
        git2::Repository::init(&dir).unwrap();
        fs::write(dir.join(".gitignore"), "target/\n").unwrap();

        let backend = open_repository(&dir).unwrap();
        let roots = backend.watch_roots().unwrap();
        let mut repos = Registry::new();
        repos.insert(
            "depot".to_string(),
            Watched {
                workdir: roots.workdir,
                gitdir: roots.gitdir,
                watched: Vec::new(),
                backend,
            },
        );
        (dir, repos)
    }

    /// Traduit des chemins **relatifs au working directory** en un lot
    /// d'événements, comme le disque en livrerait.
    fn batch(repos: &Registry, paths: &[&str]) -> Vec<DebouncedEvent> {
        let workdir = repos["depot"].workdir.clone().unwrap();
        paths
            .iter()
            .map(|p| DebouncedEvent::new(workdir.join(p), DebouncedEventKind::Any))
            .collect()
    }

    #[test]
    fn le_dossier_git_ne_retient_que_sa_liste_blanche() {
        // Le bruit d'un commit ou d'un fetch, qui ne doit rien déclencher.
        for noise in [
            "objects/ab/cdef",
            "index.lock",
            "logs/HEAD",
            "FETCH_HEAD",
            "COMMIT_EDITMSG",
        ] {
            assert!(
                classify_gitdir(Path::new(noise)).is_none(),
                "{noise} ne devrait rien déclencher"
            );
        }
    }

    #[test]
    fn index_et_references_ne_rechargent_pas_la_meme_chose() {
        let index = classify_gitdir(Path::new("index")).unwrap();
        assert!(index.worktree && !index.refs);

        let refs = classify_gitdir(Path::new("refs/heads/main")).unwrap();
        assert!(refs.refs && !refs.worktree);

        // Une fusion en cours change les deux à la fois.
        let merge = classify_gitdir(Path::new("MERGE_HEAD")).unwrap();
        assert!(merge.worktree && merge.refs);
    }

    #[test]
    fn le_dossier_git_lui_meme_ne_dit_rien() {
        assert!(classify_gitdir(Path::new("")).is_none());
    }

    #[test]
    fn un_fichier_du_projet_ne_recharge_que_le_statut() {
        let (dir, repos) = temp_registry();
        let events = batch(&repos, &["src/main.rs"]);

        let out = changes(&repos, events);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].0, "depot");
        assert!(out[0].1.worktree && !out[0].1.refs);

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn une_compilation_dans_le_depot_ne_reveille_rien() {
        let (dir, repos) = temp_registry();
        // Un dossier ignoré, et le bruit d'écriture du dossier Git : c'est
        // exactement ce qu'un `cargo build` ou un `git commit` déverse.
        let events = batch(
            &repos,
            &[
                "target/debug/build.o",
                ".git/objects/ab/cdef",
                ".git/index.lock",
                ".git/COMMIT_EDITMSG",
            ],
        );

        assert!(changes(&repos, events).is_empty());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn un_checkout_exterieur_recharge_les_deux() {
        let (dir, repos) = temp_registry();
        // Ce que laisse un `git checkout` : HEAD bouge, les fichiers changent.
        let events = batch(&repos, &[".git/HEAD", ".git/index", "src/main.rs"]);

        let out = changes(&repos, events);
        assert_eq!(out.len(), 1);
        assert!(out[0].1.worktree && out[0].1.refs);

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn un_depot_non_surveille_est_ignore() {
        let (dir, repos) = temp_registry();
        let events = vec![DebouncedEvent::new(
            PathBuf::from("/ailleurs/src/main.rs"),
            DebouncedEventKind::Any,
        )];

        assert!(changes(&repos, events).is_empty());
        fs::remove_dir_all(&dir).ok();
    }
}
