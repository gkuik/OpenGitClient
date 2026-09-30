//! Couche d'accès Git abstraite.
//!
//! Toute la logique Git passe par le trait [`GitBackend`] ; les commandes Tauri
//! ne connaissent jamais `git2` directement. Ajouter une fonctionnalité (branches,
//! remote, stash…) = ajouter une méthode au trait + une commande. Ajouter un
//! backend alternatif (fallback CLI `git`) = une seconde implémentation du trait,
//! sans toucher aux commandes ni au frontend.

use std::path::{Path, PathBuf};

use crate::dto::{
    BranchEntry, CommitDetails, CommitGraphPage, CommitResult, FetchReport, FileContent, FileDiff,
    FileSource, Identity,
    MergeMode, MergeReport, PullMode, PullReport, PushMode, PushReport, RemoteBranchEntry, RemoteInfo, RepoInfo,
    RepoStatus, StashEntry, TagEntry, TagPushReport,
};
use crate::error::AppError;

mod libgit2;

/// Ce qu'il faut surveiller sur le disque pour voir un dépôt changer sous nos
/// pieds (voir `crate::watcher`).
///
/// Deux racines et non une : dans le cas courant le dossier Git est le `.git`
/// du working directory, mais il est ailleurs pour un worktree lié ou un
/// submodule — surveiller la seule racine du working directory raterait alors
/// tout mouvement de références.
pub struct WatchRoots {
    /// Racine du working directory. Absente sur un dépôt nu.
    pub workdir: Option<PathBuf>,
    /// Dossier Git (`.git` ou son équivalent).
    pub gitdir: PathBuf,
}

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

    /// Abandonne **tous** les changements en cours : les fichiers suivis
    /// reviennent à HEAD (index et working directory compris) et les fichiers
    /// non suivis sont supprimés du disque.
    ///
    /// Irréversible, et volontairement total : le compteur de l'en-tête compte
    /// les non suivis, donc les laisser derrière ferait mentir le bouton qui
    /// promet de tout annuler. Les fichiers **ignorés** ne sont pas touchés :
    /// ce sont des produits de build, pas des changements.
    ///
    /// Une fusion en cours est refermée au passage, comme le fait
    /// `git reset --hard` : sans cela, l'état de fusion survivrait à la
    /// disparition des conflits et le commit suivant naîtrait avec deux parents.
    fn discard_all(&self) -> Result<(), AppError>;

    /// Abandonne les changements des chemins donnés, index et working
    /// directory compris — la version par chemin de [`GitBackend::discard_all`],
    /// avec la même règle : HEAD décide.
    ///
    /// Un chemin présent dans HEAD y revient (`git checkout HEAD -- <paths>`,
    /// forcé : la stratégie SAFE refuserait d'écraser précisément ce qu'on veut
    /// effacer). Un chemin absent de HEAD est un fichier neuf, indexé ou non :
    /// il est retiré de l'index s'il y était, puis supprimé du disque, et les
    /// dossiers qu'il vide partent avec lui. Un chemin qui n'existe nulle part
    /// n'est pas une erreur : il n'y a rien à abandonner.
    ///
    /// Un lot plutôt qu'un chemin : un dossier de l'arbre en contient des
    /// dizaines, et les traiter un par un rouvrirait le dépôt et réécrirait
    /// l'index autant de fois. Ici, un seul checkout et une seule écriture.
    ///
    /// Irréversible, comme `discard_all`, mais **sans** refermer une fusion en
    /// cours : abandonner un fichier ne dit rien des autres conflits.
    fn discard_paths(&self, paths: &[String]) -> Result<(), AppError>;

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

    /// Crée une branche locale sur le commit `oid` — HEAD s'il est absent — et
    /// bascule dessus, comme `git switch -c <nom> [<commit>]`.
    ///
    /// Le working directory est mis à jour **avant** que la branche existe,
    /// stratégie SAFE : un commit de départ qui écraserait des modifications
    /// locales fait tout échouer en [`AppError::CheckoutConflict`], sans laisser
    /// de branche à moitié créée derrière lui. Depuis HEAD, rien ne bouge sur le
    /// disque et les modifications en cours suivent sur la nouvelle branche.
    ///
    /// Aucun suivi n'est posé, même depuis une branche distante : le premier
    /// push demandera où publier, par la barre d'upstream.
    fn create_branch(&self, name: &str, oid: Option<&str>) -> Result<(), AppError>;

    /// Fusionne la branche locale `source` dans la branche locale `target`
    /// (glisser-déposer et menu contextuel de la section LOCAL).
    ///
    /// La cible **reçoit** la fusion, qu'elle soit ou non la branche courante :
    /// c'est le sens du geste, une branche déposée sur une autre. Trois cas, dans
    /// cet ordre : la cible contient déjà la source (rien à faire), la cible est
    /// strictement en retard (avance rapide — une simple référence à déplacer, et
    /// donc rien à checkouter si la cible n'est pas HEAD), ou les deux ont divergé
    /// (vraie fusion, qui impose de basculer sur la cible : Git n'écrit pas dans
    /// une branche inactive).
    ///
    /// [`MergeMode::NoFastForward`] supprime le deuxième cas : la fusion est
    /// toujours matérialisée par un commit, donc toujours précédée d'une bascule
    /// sur la cible.
    ///
    /// Un conflit laisse le dépôt en état de fusion sur la cible, comme un pull :
    /// `commit()` reprendra `MERGE_HEAD` comme second parent, `abort_merge()` est
    /// la sortie de secours.
    fn merge_branches(
        &self,
        source: &str,
        target: &str,
        mode: MergeMode,
    ) -> Result<MergeReport, AppError>;

    // ── Tags ────────────────────────────────────────────────────────────────

    /// Liste les tags (`refs/tags/**`) qui désignent un commit, triés par nom.
    /// Lecture pure du disque, comme les branches.
    fn tags(&self) -> Result<Vec<TagEntry>, AppError>;

    /// Crée un tag sur le commit `oid`. Avec un message, le tag est **annoté**
    /// (un objet signé par l'identité du dépôt, comme un commit) ; sans, il est
    /// léger — une simple référence.
    ///
    /// Jamais forcé : un tag du même nom remonte [`AppError::TagExists`]. Un tag
    /// est fait pour ne pas bouger, et le déplacer en silence réécrirait ce que
    /// d'autres ont peut-être déjà récupéré.
    fn create_tag(&self, name: &str, oid: &str, message: Option<&str>) -> Result<(), AppError>;

    /// Supprime un tag **local**. Le distant n'en sait rien : c'est
    /// [`GitBackend::delete_remote_tag`] qui s'en charge, geste séparé.
    fn delete_tag(&self, name: &str) -> Result<(), AppError>;

    /// Amène le commit d'un tag sous HEAD, **détaché** — ce que fait
    /// `git checkout <tag>`. Stratégie SAFE, comme pour une branche : des
    /// modifications locales qui seraient écrasées font échouer la bascule.
    fn checkout_tag(&self, name: &str) -> Result<(), AppError>;

    /// Publie un tag sur le distant (`git push <remote> refs/tags/<t>`).
    ///
    /// **Bloquante sur le réseau**, comme [`GitBackend::push`] : jamais depuis
    /// le corps d'une commande (voir `commands::push_tag`). Jamais forcée non
    /// plus : un tag différent du même nom sur le distant fait refuser l'envoi
    /// ([`AppError::TagRejected`]).
    fn push_tag(&self, name: &str) -> Result<TagPushReport, AppError>;

    /// Supprime un tag **du distant** (`git push <remote> :refs/tags/<t>`), sans
    /// toucher au tag local. Irréversible pour tous ceux qui partagent ce
    /// distant ; la confirmation est l'affaire de l'interface.
    ///
    /// **Bloquante sur le réseau**, mêmes contraintes que [`GitBackend::push_tag`].
    fn delete_remote_tag(&self, name: &str) -> Result<TagPushReport, AppError>;

    /// Liste la pile de stash, du plus récent au plus ancien.
    fn stashes(&self) -> Result<Vec<StashEntry>, AppError>;

    /// Remise les modifications locales sur la pile, sous un message construit
    /// comme celui d'un commit (`résumé`, puis `\n\n` + description).
    ///
    /// Les fichiers **non suivis sont inclus** : le working directory ressort
    /// propre, ce qui est ce qu'on attend d'une remise. L'index n'est pas
    /// conservé — ce qui était indexé l'est de nouveau au dépilage.
    fn stash_save(&self, summary: &str, body: Option<&str>) -> Result<(), AppError>;

    /// Applique un stash sur le working directory **sans** le retirer de la pile.
    /// Échoue proprement si l'application entre en conflit.
    fn stash_apply(&self, index: usize) -> Result<(), AppError>;

    /// Applique un stash puis le retire de la pile (équivalent `git stash pop`).
    /// En cas de conflit, le stash est conservé.
    fn stash_pop(&self, index: usize) -> Result<(), AppError>;

    /// Retire un stash de la pile sans l'appliquer (irréversible).
    fn stash_drop(&self, index: usize) -> Result<(), AppError>;

    /// Page d'historique pour le graph : parcours de toutes les têtes locales et
    /// distantes, des tags et de HEAD, trié topologiquement puis par date
    /// décroissante.
    ///
    /// La pagination est un simple `skip`/`limit` sur ce parcours. L'ordre est
    /// stable tant que les références ne bougent pas ; toute mutation du dépôt
    /// impose de recharger depuis la première page.
    fn commit_graph(&self, skip: usize, limit: usize) -> Result<CommitGraphPage, AppError>;

    /// Détail d'un commit, avec les fichiers qu'il modifie (vs premier parent).
    fn commit_details(&self, oid: &str) -> Result<CommitDetails, AppError>;

    /// Diff d'un fichier au sein d'un commit (commit ↔ premier parent).
    fn commit_file_diff(&self, oid: &str, path: &str) -> Result<FileDiff, AppError>;

    /// Contenu d'un fichier depuis la source donnée — disque, index ou commit —
    /// pour l'aperçu rendu d'un Markdown. Plafonné : un aperçu n'a pas à
    /// charger un fichier de plusieurs mégaoctets dans le webview.
    fn file_content(&self, path: &str, source: &FileSource) -> Result<FileContent, AppError>;

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
    /// En [`PushMode::Normal`], un refus du distant remonte tel quel en
    /// [`AppError::PushRejected`], à charge pour l'utilisateur de récupérer les
    /// commits manquants d'abord. Les deux modes de force réécrivent la branche
    /// distante ; `ForceWithLease` s'interdit de le faire quand elle a bougé
    /// depuis le dernier fetch et remonte alors [`AppError::PushLeaseStale`],
    /// sans avoir rien envoyé.
    ///
    /// **Bloquante sur le réseau**, comme [`GitBackend::fetch`] : mêmes
    /// contraintes, elle ne doit jamais être appelée depuis le corps d'une
    /// commande Tauri (voir `commands::push_branch`).
    ///
    /// `target` est le nom de la branche **sur le distant**, quand il diffère
    /// du nom local : c'est ce que la barre d'upstream demande au premier push
    /// (GitKraken : « What remote/branch should X push to and pull from? »).
    /// Absent, la branche est publiée sous son propre nom. Le suivi posé après
    /// coup pointe sur `<remote>/<target>`.
    fn push(
        &self,
        remote: Option<&str>,
        target: Option<&str>,
        mode: PushMode,
    ) -> Result<PushReport, AppError>;

    /// Noms des dépôts distants déclarés, dans l'ordre de la configuration.
    ///
    /// Lecture pure de `.git/config` — aucun réseau. C'est ce qu'offre le
    /// sélecteur de la barre d'upstream : `remote_info` ne résout qu'un seul
    /// distant, celui qu'un fetch prendrait, alors que la question posée est
    /// justement lequel choisir.
    fn remotes(&self) -> Result<Vec<String>, AppError>;

    /// Récupère puis intègre, selon le mode choisi (`git pull`).
    ///
    /// `branch` est la branche locale à tirer ; absente, c'est la courante.
    /// Une branche **non courante** avance sans rien toucher sur le disque —
    /// sa référence est simplement déplacée sur l'amont quand c'est une avance
    /// rapide, comme `git fetch origin b:b`. Quand une vraie fusion s'impose,
    /// on bascule dessus d'abord — la règle de [`GitBackend::merge_branches`] :
    /// Git n'écrit pas dans une branche inactive. `PullReport.switched` le dit.
    ///
    /// **Bloquante sur le réseau**, comme [`GitBackend::fetch`] : même thread
    /// dédié côté commande. C'est aussi la seule opération distante qui écrit
    /// dans le working directory — d'où la stratégie SAFE, qui refuse plutôt
    /// que d'écraser des modifications locales.
    fn pull(&self, branch: Option<&str>, mode: PullMode) -> Result<PullReport, AppError>;

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

    // ── Surveillance du disque ──────────────────────────────────────────────

    /// Racines à surveiller pour détecter un changement venu d'ailleurs
    /// (éditeur, terminal, autre outil Git). Voir [`WatchRoots`].
    fn watch_roots(&self) -> Result<WatchRoots, AppError>;

    /// Retire d'une liste de chemins absolus ceux que le dépôt ignore
    /// (`.gitignore` & co).
    ///
    /// Le lot entier passe en un seul appel, et ce n'est pas de la coquetterie :
    /// une compilation dans le dépôt émet des milliers de chemins à la seconde,
    /// et une question par chemin rouvrirait le dépôt à chaque fois.
    fn filter_ignored(&self, paths: Vec<PathBuf>) -> Vec<PathBuf>;
}

/// Ouvre un dépôt et renvoie le backend correspondant.
///
/// Point de bascule unique entre implémentations : aujourd'hui libgit2, demain un
/// `match` sur une config/feature pourra retourner un `CliBackend`.
pub fn open_repository(path: &Path) -> Result<Box<dyn GitBackend>, AppError> {
    let backend = libgit2::Libgit2Backend::open(path)?;
    Ok(Box::new(backend))
}
