//! Objets de transfert (DTO) sérialisés vers le frontend.
//!
//! Chaque struct est le miroir exact d'un type TS dans `src/lib/types.ts`.
//! `rename_all = "camelCase"` fait la conversion snake_case → camelCase.

use serde::{Deserialize, Serialize};

use crate::error::AppError;

/// Statut d'un fichier, dérivé des flags libgit2.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FileStatus {
    Modified,
    Added,
    Deleted,
    Renamed,
    Typechange,
    Conflicted,
    Untracked,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub path: String,
    /// Ancien chemin en cas de renommage, sinon `None`.
    pub old_path: Option<String>,
    pub status: FileStatus,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoStatus {
    pub staged: Vec<FileEntry>,
    pub unstaged: Vec<FileEntry>,
    pub untracked: Vec<FileEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoInfo {
    /// Chemin canonique du dépôt. Sert aussi d'**identifiant d'onglet** : c'est
    /// la valeur à repasser en `repoId` dans toutes les autres commandes.
    pub path: String,
    pub name: String,
    pub branch: Option<String>,
    pub is_detached: bool,
    pub head: Option<String>,
    /// Fusion en cours (conflits à résoudre, ou commit de fusion à créer).
    /// Le frontend s'en sert pour afficher la sortie de secours : sans elle,
    /// un conflit laisserait l'utilisateur coincé dans l'application.
    pub merging: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DiffLineKind {
    Context,
    Addition,
    Deletion,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    pub kind: DiffLineKind,
    pub content: String,
    pub old_lineno: Option<u32>,
    pub new_lineno: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiffHunk {
    pub header: String,
    pub lines: Vec<DiffLine>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub path: String,
    pub is_binary: bool,
    pub hunks: Vec<DiffHunk>,
}

#[derive(Debug, Serialize)]
pub struct CommitResult {
    pub oid: String,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct RecentRepo {
    pub path: String,
    pub name: String,
}

/// Session à restaurer au lancement : onglets ouverts et onglet actif.
///
/// Les entrées sont des chemins canoniques, qui servent aussi d'identifiants
/// d'onglet. Le frontend les rouvre un par un et ignore ceux qui échouent.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub tabs: Vec<String>,
    pub active: Option<String>,
}

/// Branche locale. `name` est le nom complet ("fix/EDIAG6-811"), qui sert aussi
/// de clé de checkout ; le frontend le découpe sur "/" pour l'arborescence.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchEntry {
    pub name: String,
    /// Vrai si c'est la branche actuellement checkoutée.
    pub is_head: bool,
    /// Commit de tête. Vide si la branche n'a pas encore de commit (HEAD non né) ;
    /// le frontend s'en sert pour sélectionner ce commit dans le graph.
    pub oid: String,
    /// Branche amont et écart avec elle. **Absent** quand la branche n'en suit
    /// aucune : « rien à comparer » n'est pas « à jour », et le frontend
    /// n'affiche de compteur que dans le premier cas.
    pub upstream: Option<Upstream>,
}

/// Branche amont d'une branche locale, et l'écart qui l'en sépare.
///
/// Les deux compteurs viennent d'un seul appel à `graph_ahead_behind` et ne
/// valent que pour l'état **local** des références : ils datent du dernier
/// fetch, pas de ce que le serveur contient à l'instant présent.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Upstream {
    /// Nom de la branche amont ("origin/main").
    pub name: String,
    /// Commits que le local a en plus : ce qu'un push enverrait.
    pub ahead: usize,
    /// Commits que l'amont a en plus : ce qu'un pull ramènerait.
    pub behind: usize,
}

/// Branche distante (`refs/remotes/**`).
///
/// `name` est le nom complet, distant inclus ("origin/feature/x") ; il commence
/// toujours par `remote` suivi d'un "/", ce dont le frontend se sert pour
/// regrouper les branches par distant. Pas de `is_head` ici : aucune branche
/// distante n'est checkoutée, HEAD ne pointe que sur du local.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteBranchEntry {
    pub name: String,
    /// Distant auquel elle appartient ("origin").
    pub remote: String,
    /// Commit de tête.
    pub oid: String,
}

/// Nature d'une référence pointant sur un commit du graph.
///
/// Les tags ne sont pas encore lus par le backend ; branches locales et
/// distantes le sont, et se distinguent ici pour que la pastille le montre.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GraphRefKind {
    Head,
    LocalBranch,
    RemoteBranch,
}

/// Référence (branche, HEAD) attachée à un commit, pour l'affichage des pastilles.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphRef {
    pub name: String,
    pub kind: GraphRefKind,
}

/// Commit tel que consommé par le graph.
///
/// On transporte les `parents` bruts : l'assignation des lanes (présentation) est
/// faite côté frontend, ce qui garde le trait `GitBackend` purement Git.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphCommit {
    pub oid: String,
    /// OID abrégé (7 caractères), pour l'affichage.
    pub short_oid: String,
    pub summary: String,
    pub author_name: String,
    /// Date d'auteur, en secondes Unix UTC.
    pub timestamp: i64,
    pub parents: Vec<String>,
    pub refs: Vec<GraphRef>,
}

/// Page d'historique. `has_more` évite au frontend un aller-retour supplémentaire
/// pour découvrir qu'il est arrivé au bout.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitGraphPage {
    pub commits: Vec<GraphCommit>,
    pub has_more: bool,
}

/// Détail complet d'un commit, avec la liste des fichiers qu'il modifie.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitDetails {
    pub oid: String,
    pub short_oid: String,
    pub summary: String,
    /// Corps du message (tout ce qui suit la ligne vide), sinon `None`.
    pub body: Option<String>,
    pub author_name: String,
    pub author_email: String,
    pub timestamp: i64,
    pub parents: Vec<String>,
    /// Fichiers modifiés par rapport au premier parent. On réutilise `FileEntry`
    /// pour que le frontend affiche les mêmes badges que dans le panneau de statut.
    pub files: Vec<FileEntry>,
}

/// Entrée de la pile de stash (`stash@{index}`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StashEntry {
    /// Position dans la pile — 0 = le plus récent.
    pub index: usize,
    /// Message brut tel que stocké par Git.
    pub message: String,
    /// Branche sur laquelle le stash a été créé, extraite du message.
    pub branch: Option<String>,
    pub oid: String,
}

/// Référence distante déplacée par un `fetch`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchedRef {
    /// Nom complet de la référence ("refs/remotes/origin/main").
    pub name: String,
    /// OID avant le fetch ; `None` si la référence vient d'apparaître.
    pub old_oid: Option<String>,
    pub new_oid: String,
}

/// Résultat d'un `fetch`. `updated` vide = le distant n'a pas bougé.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchReport {
    /// Dépôt distant réellement interrogé (résolu si l'appel n'en nommait aucun).
    pub remote: String,
    pub updated: Vec<FetchedRef>,
}

/// Charge utile de l'événement `repo://fetched`.
///
/// Le fetch tourne sur un thread dédié : son résultat ne peut pas être la valeur
/// de retour de la commande, il remonte par cet événement. Exactement l'un des
/// deux champs est renseigné.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchEvent {
    /// Onglet concerné — le frontend en a besoin pour router le résultat, un
    /// fetch pouvant aboutir alors qu'un autre onglet est affiché.
    pub repo_id: String,
    pub report: Option<FetchReport>,
    pub error: Option<AppError>,
}

/// Résultat d'un push.
///
/// Il n'y a pas de compteur de commits envoyés : le nombre exact est celui que
/// la pastille `↑` de la branche affichait avant, et elle retombe à zéro au
/// rechargement — le dire deux fois inviterait les deux valeurs à diverger.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PushReport {
    /// Distant réellement poussé (résolu par le backend si non précisé).
    pub remote: String,
    /// Branche poussée — toujours la branche courante.
    pub branch: String,
    /// Vrai si le suivi vient d'être posé, c'est-à-dire au premier push de la
    /// branche (`push -u`).
    pub upstream_set: bool,
}

/// Charge utile de l'événement `repo://pushed`, jumelle de [`FetchEvent`] : le
/// push tourne lui aussi sur un thread dédié.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PushEvent {
    pub repo_id: String,
    pub report: Option<PushReport>,
    pub error: Option<AppError>,
}

/// Ce que le bouton Pull exécute, choisi dans son menu déroulant et persisté.
///
/// Il n'y a **pas** de variante `Rebase` : elle n'aurait aucune implémentation
/// derrière elle. Le menu affiche bien l'entrée, mais désactivée — le type, lui,
/// ne décrit que ce qui existe.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PullMode {
    /// Récupère les références de **tous** les distants, sans rien intégrer.
    FetchAll,
    /// N'intègre que par avance rapide ; en cas de divergence, ne touche à rien.
    FastForwardOnly,
    /// Avance rapide si possible, fusion sinon.
    FastForwardOrMerge,
}

impl Default for PullMode {
    /// Le défaut de GitKraken, et le geste le plus courant.
    fn default() -> Self {
        Self::FastForwardOrMerge
    }
}

/// Thème de l'interface, choisi dans les paramètres et persisté.
///
/// `System` n'est **pas** une troisième palette : c'est l'absence de choix, que
/// le frontend résout en clair ou sombre selon `prefers-color-scheme`. C'est
/// aussi ce que reçoit la fenêtre native — `set_theme(None)` la laisse suivre le
/// système, là où `Some(...)` la fige.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ThemeMode {
    #[default]
    System,
    Light,
    Dark,
}

/// Résultat d'un pull : ce qui a été récupéré, puis ce qui en a été fait.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullReport {
    /// Distants interrogés — un seul, sauf en `FetchAll`.
    pub remotes: Vec<String>,
    /// Références distantes déplacées par le fetch qui précède l'intégration.
    pub updated: Vec<FetchedRef>,
    pub outcome: PullOutcome,
}

/// Ce qu'un pull a fait du côté local.
///
/// Une divergence et un conflit ne sont **pas** des erreurs : le fetch qui les
/// précède a réussi et a déplacé des références, qu'il faut recharger. Les
/// remonter en `AppError` perdrait cette moitié-là du résultat.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum PullOutcome {
    /// Mode `FetchAll` : rien n'est intégré, par définition.
    FetchedOnly,
    /// L'amont n'a rien que le local n'ait déjà.
    UpToDate,
    /// Avance rapide : la branche a simplement été déplacée.
    FastForwarded { commits: usize },
    /// Fusion créée, sans conflit.
    Merged { commits: usize },
    /// Fusion interrompue par des conflits : le working directory les porte, à
    /// l'utilisateur de les résoudre puis de committer (ou d'abandonner).
    Conflicted { files: Vec<String> },
    /// Les deux côtés ont divergé et le mode choisi refuse de fusionner.
    Diverged { ahead: usize, behind: usize },
}

/// Charge utile de l'événement `repo://pulled`, jumelle de [`FetchEvent`].
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullEvent {
    pub repo_id: String,
    pub report: Option<PullReport>,
    pub error: Option<AppError>,
}

/// Dépôt distant d'un onglet, tel que le frontend en a besoin pour demander des
/// identifiants : `host` est la clé sous laquelle ils sont rangés.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteInfo {
    pub name: String,
    pub url: String,
    /// `None` si l'URL n'expose pas d'hôte exploitable (chemin local).
    pub host: Option<String>,
    /// Des identifiants sont-ils déjà enregistrés pour cet hôte ?
    pub has_credentials: bool,
    /// Le distant est-il joint en HTTP(S) ? C'est ce qui décide si un jeton
    /// stocké s'applique : en SSH l'authentification passe par une clé, et
    /// proposer d'y saisir un mot de passe n'aurait aucun effet.
    pub uses_http: bool,
}

/// Profil d'auteur : une identité Git réutilisable d'un dépôt à l'autre.
///
/// Sérialisé dans `profiles.json` à côté des récents et de la session, d'où le
/// `Deserialize`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    /// Identifiant stable, généré à la création — le libellé, lui, peut changer.
    pub id: String,
    /// Nom court affiché dans le sélecteur ("Perso", "Travail"…).
    pub label: String,
    pub name: String,
    pub email: String,
}

/// Identité sous laquelle un dépôt commite.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Identity {
    pub name: Option<String>,
    pub email: Option<String>,
    /// Définie dans le dépôt lui-même plutôt qu'héritée de la config globale.
    /// C'est ce qui distingue « profil choisi » de « valeur par défaut ».
    pub is_local: bool,
}
