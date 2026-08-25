//! Objets de transfert (DTO) sérialisés vers le frontend.
//!
//! Chaque struct est le miroir exact d'un type TS dans `src/lib/types.ts`.
//! `rename_all = "camelCase"` fait la conversion snake_case → camelCase.

use serde::Serialize;

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
    pub path: String,
    pub name: String,
    pub branch: Option<String>,
    pub is_detached: bool,
    pub head: Option<String>,
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
}

/// Nature d'une référence pointant sur un commit du graph.
///
/// Seuls HEAD et les branches locales sont produits pour l'instant : les remotes
/// et les tags ne sont pas encore lus par le backend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GraphRefKind {
    Head,
    LocalBranch,
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
