//! Couche d'accès Git abstraite.
//!
//! Toute la logique Git passe par le trait [`GitBackend`] ; les commandes Tauri
//! ne connaissent jamais `git2` directement. Ajouter une fonctionnalité (branches,
//! remote, stash…) = ajouter une méthode au trait + une commande. Ajouter un
//! backend alternatif (fallback CLI `git`) = une seconde implémentation du trait,
//! sans toucher aux commandes ni au frontend.

use std::path::Path;

use crate::dto::{
    BranchEntry, CommitDetails, CommitGraphPage, CommitResult, FileDiff, RepoInfo, RepoStatus,
    StashEntry,
};
use crate::error::AppError;

mod libgit2;

/// Interface d'accès à un dépôt Git ouvert.
///
/// `Send` est requis pour stocker le backend dans l'état partagé de Tauri
/// (derrière un `Mutex`). On ne demande pas `Sync` : l'accès est sérialisé par le
/// `Mutex`, ce qui suffit et laisse le champ libre à des implémentations non-`Sync`.
pub trait GitBackend: Send {
    /// Métadonnées du dépôt (nom, branche courante, HEAD…).
    fn info(&self) -> Result<RepoInfo, AppError>;

    /// Statut du working directory, classé staged / unstaged / untracked.
    fn status(&self) -> Result<RepoStatus, AppError>;

    /// Diff d'un fichier. `staged = true` → HEAD↔index ; `false` → index↔working dir.
    fn file_diff(&self, path: &str, staged: bool) -> Result<FileDiff, AppError>;

    /// Indexe un fichier (add / suppression selon son état sur le disque).
    fn stage(&self, path: &str) -> Result<(), AppError>;

    /// Retire un fichier de l'index (reset vers HEAD).
    fn unstage(&self, path: &str) -> Result<(), AppError>;

    /// Indexe tous les changements (équivalent `git add -A`).
    fn stage_all(&self) -> Result<(), AppError>;

    /// Retire tous les changements de l'index.
    fn unstage_all(&self) -> Result<(), AppError>;

    /// Crée un commit à partir de l'index courant.
    /// Si `amend` est vrai, remplace le dernier commit (message + arbre) au lieu
    /// d'en créer un nouveau.
    fn commit(
        &self,
        summary: &str,
        body: Option<&str>,
        amend: bool,
    ) -> Result<CommitResult, AppError>;

    /// Liste les branches locales, triées par nom complet.
    fn local_branches(&self) -> Result<Vec<BranchEntry>, AppError>;

    /// Bascule sur une branche locale. Échoue (sans rien écraser) si des
    /// modifications locales entrent en conflit.
    fn checkout_branch(&self, name: &str) -> Result<(), AppError>;

    /// Liste la pile de stash, du plus récent au plus ancien.
    fn stashes(&self) -> Result<Vec<StashEntry>, AppError>;

    /// Applique un stash sur le working directory **sans** le retirer de la pile.
    /// Échoue proprement si l'application entre en conflit.
    fn stash_apply(&self, index: usize) -> Result<(), AppError>;

    /// Applique un stash puis le retire de la pile (équivalent `git stash pop`).
    /// En cas de conflit, le stash est conservé.
    fn stash_pop(&self, index: usize) -> Result<(), AppError>;

    /// Retire un stash de la pile sans l'appliquer (irréversible).
    fn stash_drop(&self, index: usize) -> Result<(), AppError>;

    /// Page d'historique pour le graph : parcours de toutes les têtes locales et
    /// de HEAD, trié topologiquement puis par date décroissante.
    ///
    /// La pagination est un simple `skip`/`limit` sur ce parcours. L'ordre est
    /// stable tant que les références ne bougent pas ; toute mutation du dépôt
    /// impose de recharger depuis la première page.
    fn commit_graph(&self, skip: usize, limit: usize) -> Result<CommitGraphPage, AppError>;

    /// Détail d'un commit, avec les fichiers qu'il modifie (vs premier parent).
    fn commit_details(&self, oid: &str) -> Result<CommitDetails, AppError>;

    /// Diff d'un fichier au sein d'un commit (commit ↔ premier parent).
    fn commit_file_diff(&self, oid: &str, path: &str) -> Result<FileDiff, AppError>;
}

/// Ouvre un dépôt et renvoie le backend correspondant.
///
/// Point de bascule unique entre implémentations : aujourd'hui libgit2, demain un
/// `match` sur une config/feature pourra retourner un `CliBackend`.
pub fn open_repository(path: &Path) -> Result<Box<dyn GitBackend>, AppError> {
    let backend = libgit2::Libgit2Backend::open(path)?;
    Ok(Box::new(backend))
}
