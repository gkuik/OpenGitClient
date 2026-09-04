//! Couche d'accès Git abstraite.
//!
//! Toute la logique Git passe par le trait [`GitBackend`] ; les commandes Tauri
//! ne connaissent jamais `git2` directement. Ajouter une fonctionnalité (branches,
//! remote, stash…) = ajouter une méthode au trait + une commande. Ajouter un
//! backend alternatif (fallback CLI `git`) = une seconde implémentation du trait,
//! sans toucher aux commandes ni au frontend.

use std::path::Path;

use crate::dto::{
    BranchEntry, CommitDetails, CommitGraphPage, CommitResult, FetchReport, FileDiff, Identity,
    PullMode, PullReport, PushReport, RemoteBranchEntry, RemoteInfo, RepoInfo, RepoStatus,
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

    /// Liste les branches distantes (`refs/remotes/**`), triées par nom complet.
    ///
    /// Le pointeur symbolique `<distant>/HEAD` en est exclu : il double la
    /// branche par défaut du distant sans être une branche lui-même.
    ///
    /// Lecture pure des références déjà présentes sur le disque — aucun accès
    /// réseau, donc rien à voir avec [`GitBackend::fetch`], qui est le seul à
    /// les mettre à jour.
    fn remote_branches(&self) -> Result<Vec<RemoteBranchEntry>, AppError>;

    /// Bascule sur une branche locale. Échoue (sans rien écraser) si des
    /// modifications locales entrent en conflit.
    fn checkout_branch(&self, name: &str) -> Result<(), AppError>;

    /// Bascule sur une branche distante en créant la branche **locale** de suivi
    /// correspondante (`origin/feature` → `feature`), comme `git checkout
    /// feature` le fait pour une branche qui n'existe qu'à distance.
    ///
    /// Si une branche locale de ce nom existe déjà, elle est simplement
    /// checkoutée telle quelle : la rattraper sur la distante serait un pull.
    fn checkout_remote_branch(&self, name: &str) -> Result<(), AppError>;

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

    /// Récupère les références du dépôt distant (`git fetch`). `remote` à `None`
    /// laisse l'implémentation résoudre le distant à interroger.
    ///
    /// **Seule méthode bloquante sur le réseau du trait.** Elle ne doit jamais
    /// être appelée depuis le corps d'une commande Tauri, qui tient le `Mutex` de
    /// l'état : tous les onglets seraient gelés pour la durée de l'appel, et
    /// indéfiniment si la connexion ne répond pas. Voir `commands::fetch_remote`,
    /// qui l'exécute sur un thread dédié.
    fn fetch(&self, remote: Option<&str>) -> Result<FetchReport, AppError>;

    /// Publie la **branche courante** sur le dépôt distant (`git push`), et pose
    /// son suivi si elle n'en avait pas (`push -u`).
    ///
    /// Jamais de force : un refus du distant remonte tel quel en
    /// [`AppError::PushRejected`], à charge pour l'utilisateur de récupérer les
    /// commits manquants d'abord.
    ///
    /// **Bloquante sur le réseau**, comme [`GitBackend::fetch`] : mêmes
    /// contraintes, elle ne doit jamais être appelée depuis le corps d'une
    /// commande Tauri (voir `commands::push_branch`).
    fn push(&self, remote: Option<&str>) -> Result<PushReport, AppError>;

    /// Récupère puis intègre, selon le mode choisi (`git pull`).
    ///
    /// **Bloquante sur le réseau**, comme [`GitBackend::fetch`] : même thread
    /// dédié côté commande. C'est aussi la seule opération distante qui écrit
    /// dans le working directory — d'où la stratégie SAFE, qui refuse plutôt
    /// que d'écraser des modifications locales.
    fn pull(&self, mode: PullMode) -> Result<PullReport, AppError>;

    /// Abandonne une fusion en cours : les fichiers reviennent à HEAD et l'état
    /// de fusion est effacé. Sans elle, un conflit n'aurait aucune issue depuis
    /// l'application.
    fn abort_merge(&self) -> Result<(), AppError>;

    /// Dépôt distant qu'un fetch interrogerait, avec son URL. Sert au frontend à
    /// savoir pour quel hôte demander des identifiants.
    fn remote_info(&self, remote: Option<&str>) -> Result<RemoteInfo, AppError>;

    /// Identité sous laquelle ce dépôt commite (`user.name` / `user.email`).
    fn identity(&self) -> Result<Identity, AppError>;

    /// Fixe l'identité **du dépôt** : elle est écrite dans sa config locale, donc
    /// visible et respectée par n'importe quel autre outil Git.
    fn set_identity(&self, name: &str, email: &str) -> Result<(), AppError>;

    /// Retire l'identité locale : le dépôt retombe sur la configuration globale.
    fn clear_identity(&self) -> Result<(), AppError>;
}

/// Ouvre un dépôt et renvoie le backend correspondant.
///
/// Point de bascule unique entre implémentations : aujourd'hui libgit2, demain un
/// `match` sur une config/feature pourra retourner un `CliBackend`.
pub fn open_repository(path: &Path) -> Result<Box<dyn GitBackend>, AppError> {
    let backend = libgit2::Libgit2Backend::open(path)?;
    Ok(Box::new(backend))
}
