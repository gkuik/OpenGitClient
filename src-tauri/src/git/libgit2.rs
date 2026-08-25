//! Implémentation de [`GitBackend`] basée sur libgit2 (git2-rs).

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use git2::{
    build::CheckoutBuilder, BranchType, Commit, Delta, DiffDelta, DiffFlags, DiffFormat,
    DiffOptions, ErrorClass, IndexAddOption, ObjectType, Oid, Repository, Sort, Status, StatusEntry,
    StatusOptions, Tree,
};

use super::GitBackend;
use crate::dto::{
    BranchEntry, CommitDetails, CommitGraphPage, CommitResult, DiffHunk, DiffLine, DiffLineKind,
    FileDiff, FileEntry, FileStatus, GraphCommit, GraphRef, GraphRefKind, RepoInfo, RepoStatus,
    StashEntry,
};
use crate::error::AppError;

/// Longueur des OID abrégés affichés dans le graph (convention Git).
const SHORT_OID_LEN: usize = 7;

/// Backend libgit2.
///
/// Choix de conception : on ne conserve que le **chemin** du dépôt et on ré-ouvre
/// `Repository` au début de chaque opération. `Repository` n'est pas `Sync` ; le
/// stocker dans l'état partagé de Tauri imposerait des contorsions, alors que
/// `Repository::open` est très peu coûteux. Si le profilage l'exige un jour, on
/// pourra introduire un cache ici sans toucher au trait ni aux commandes.
pub struct Libgit2Backend {
    path: PathBuf,
}

impl Libgit2Backend {
    /// Ouvre et valide un dépôt. Échoue avec `NotARepository` si ce n'en est pas un.
    pub fn open(path: &Path) -> Result<Self, AppError> {
        Repository::open(path).map_err(|_| AppError::NotARepository)?;
        Ok(Self {
            path: path.to_path_buf(),
        })
    }

    fn repo(&self) -> Result<Repository, AppError> {
        Repository::open(&self.path).map_err(|_| AppError::NotARepository)
    }
}

impl GitBackend for Libgit2Backend {
    fn info(&self) -> Result<RepoInfo, AppError> {
        let repo = self.repo()?;
        let name = self
            .path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| self.path.to_string_lossy().to_string());

        let head = repo.head().ok();
        let is_detached = repo.head_detached().unwrap_or(false);

        let branch = match &head {
            Some(r) if r.is_branch() => r.shorthand().map(|s| s.to_string()),
            Some(_) => None,
            None => {
                // Branche non encore née (aucun commit) : lire la cible symbolique de HEAD.
                repo.find_reference("HEAD").ok().and_then(|h| {
                    h.symbolic_target()
                        .map(|s| s.trim_start_matches("refs/heads/").to_string())
                })
            }
        };
        let head_oid = head.as_ref().and_then(|r| r.target()).map(|o| o.to_string());

        Ok(RepoInfo {
            path: self.path.to_string_lossy().to_string(),
            name,
            branch,
            is_detached,
            head: head_oid,
        })
    }

    fn status(&self) -> Result<RepoStatus, AppError> {
        let repo = self.repo()?;
        let mut opts = StatusOptions::new();
        opts.include_untracked(true)
            .recurse_untracked_dirs(true)
            .renames_head_to_index(true)
            .renames_index_to_workdir(true)
            .include_ignored(false);

        let statuses = repo.statuses(Some(&mut opts))?;
        let mut out = RepoStatus::default();

        for entry in statuses.iter() {
            let s = entry.status();
            let path = entry.path().unwrap_or_default().to_string();

            // ── Côté index → "staged" ──
            if s.intersects(
                Status::INDEX_NEW
                    | Status::INDEX_MODIFIED
                    | Status::INDEX_DELETED
                    | Status::INDEX_RENAMED
                    | Status::INDEX_TYPECHANGE,
            ) {
                let (status, p, old_path) = classify_index(&entry, &path);
                out.staged.push(FileEntry {
                    path: p,
                    old_path,
                    status,
                });
            }

            // ── Côté working directory ──
            if s.contains(Status::WT_NEW) {
                out.untracked.push(FileEntry {
                    path: path.clone(),
                    old_path: None,
                    status: FileStatus::Untracked,
                });
            } else if s.intersects(
                Status::WT_MODIFIED
                    | Status::WT_DELETED
                    | Status::WT_RENAMED
                    | Status::WT_TYPECHANGE,
            ) {
                let (status, p, old_path) = classify_workdir(&entry, &path);
                out.unstaged.push(FileEntry {
                    path: p,
                    old_path,
                    status,
                });
            }

            // Conflit : signalé dans la section modifiée pour rester visible.
            if s.contains(Status::CONFLICTED) {
                out.unstaged.push(FileEntry {
                    path,
                    old_path: None,
                    status: FileStatus::Conflicted,
                });
            }
        }

        Ok(out)
    }

    fn file_diff(&self, path: &str, staged: bool) -> Result<FileDiff, AppError> {
        let repo = self.repo()?;
        let mut opts = DiffOptions::new();
        opts.pathspec(path)
            .include_untracked(true)
            .recurse_untracked_dirs(true)
            .context_lines(3);

        let diff = if staged {
            // HEAD (arbre) ↔ index. Sans commit, on diffe contre un arbre vide (None).
            let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
            repo.diff_tree_to_index(head_tree.as_ref(), None, Some(&mut opts))?
        } else {
            // index ↔ working directory.
            repo.diff_index_to_workdir(None, Some(&mut opts))?
        };

        build_file_diff(path, &diff)
    }

    fn stage(&self, path: &str) -> Result<(), AppError> {
        let repo = self.repo()?;
        let mut index = repo.index()?;
        let rel = Path::new(path);

        // Si le fichier existe encore sur le disque → add ; sinon → suppression.
        let exists = repo
            .workdir()
            .map(|w| w.join(rel).exists())
            .unwrap_or(false);

        if exists {
            index.add_path(rel)?;
        } else {
            index.remove_path(rel)?;
        }
        index.write()?;
        Ok(())
    }

    fn unstage(&self, path: &str) -> Result<(), AppError> {
        let repo = self.repo()?;
        match repo.head() {
            Ok(head) => {
                let obj = head.peel(ObjectType::Commit)?;
                repo.reset_default(Some(&obj), [Path::new(path)])?;
            }
            Err(_) => {
                // Aucun commit (HEAD non né) : "unstage" = retirer de l'index.
                let mut index = repo.index()?;
                index.remove_path(Path::new(path))?;
                index.write()?;
            }
        }
        Ok(())
    }

    fn stage_all(&self) -> Result<(), AppError> {
        let repo = self.repo()?;
        let mut index = repo.index()?;
        // add_all : nouveaux + modifiés ; update_all : modifiés + supprimés (déjà suivis).
        // Les deux combinés imitent `git add -A`.
        index.add_all(["*"], IndexAddOption::DEFAULT, None)?;
        index.update_all(["*"], None)?;
        index.write()?;
        Ok(())
    }

    fn unstage_all(&self) -> Result<(), AppError> {
        let repo = self.repo()?;
        match repo.head() {
            Ok(head) => {
                let obj = head.peel(ObjectType::Commit)?;
                repo.reset_default(Some(&obj), ["*"])?;
            }
            Err(_) => {
                // Pas de commit : vider l'index revient à tout dé-indexer.
                let mut index = repo.index()?;
                index.clear()?;
                index.write()?;
            }
        }
        Ok(())
    }

    fn commit(
        &self,
        summary: &str,
        body: Option<&str>,
        amend: bool,
    ) -> Result<CommitResult, AppError> {
        let repo = self.repo()?;

        let mut index = repo.index()?;
        let tree_oid = index.write_tree()?;
        let tree = repo.find_tree(tree_oid)?;

        let signature = repo.signature().map_err(|_| AppError::MissingSignature)?;

        let message = match body {
            Some(b) if !b.trim().is_empty() => format!("{summary}\n\n{}", b.trim()),
            _ => summary.to_string(),
        };
        // Message vide → on conserve l'ancien (utile pour un amend qui ne change
        // que l'arbre).
        let message_opt = if message.trim().is_empty() {
            None
        } else {
            Some(message.as_str())
        };

        if amend {
            // Remplace le dernier commit par l'arbre et le message courants.
            let head_commit = repo
                .head()
                .ok()
                .and_then(|h| h.peel_to_commit().ok())
                .ok_or(AppError::NothingToAmend)?;
            let oid = head_commit.amend(
                Some("HEAD"),
                Some(&signature),
                Some(&signature),
                None,
                message_opt,
                Some(&tree),
            )?;
            return Ok(CommitResult {
                oid: oid.to_string(),
                summary: summary.to_string(),
            });
        }

        let parent_commit = match repo.head() {
            Ok(head) => Some(head.peel_to_commit()?),
            Err(_) => None,
        };

        // Refuse un commit qui n'apporte aucun changement.
        match &parent_commit {
            Some(parent) if parent.tree_id() == tree_oid => {
                return Err(AppError::NothingToCommit);
            }
            None if tree.len() == 0 => {
                return Err(AppError::NothingToCommit);
            }
            _ => {}
        }

        let parents: Vec<&git2::Commit> = parent_commit.iter().collect();
        let oid = repo.commit(
            Some("HEAD"),
            &signature,
            &signature,
            &message,
            &tree,
            &parents,
        )?;

        Ok(CommitResult {
            oid: oid.to_string(),
            summary: summary.to_string(),
        })
    }

    fn local_branches(&self) -> Result<Vec<BranchEntry>, AppError> {
        let repo = self.repo()?;
        let mut out = Vec::new();

        for item in repo.branches(Some(BranchType::Local))? {
            let (branch, _kind) = item?;
            // `name()` peut être None si le nom n'est pas de l'UTF-8 valide.
            if let Some(name) = branch.name()? {
                out.push(BranchEntry {
                    name: name.to_string(),
                    is_head: branch.is_head(),
                    oid: branch
                        .get()
                        .target()
                        .map(|o| o.to_string())
                        .unwrap_or_default(),
                });
            }
        }

        out.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(out)
    }

    fn checkout_branch(&self, name: &str) -> Result<(), AppError> {
        let repo = self.repo()?;
        let refname = format!("refs/heads/{name}");

        // Échoue tôt si la branche n'existe pas.
        let target = repo.revparse_single(&refname)?;

        // Stratégie SAFE par défaut : libgit2 refuse d'écraser des modifications
        // locales, on remonte alors une erreur explicite plutôt que de perdre du
        // travail.
        let mut opts = CheckoutBuilder::new();
        repo.checkout_tree(&target, Some(&mut opts))
            .map_err(|e| match e.class() {
                ErrorClass::Checkout => AppError::CheckoutConflict,
                _ => AppError::from(e),
            })?;

        repo.set_head(&refname)?;
        Ok(())
    }

    fn stashes(&self) -> Result<Vec<StashEntry>, AppError> {
        // `stash_foreach` exige un emprunt mutable ; on possède le Repository
        // (ré-ouvert à chaque appel), donc un `mut` local suffit.
        let mut repo = self.repo()?;
        let mut out = Vec::new();

        repo.stash_foreach(|index, message, oid| {
            out.push(StashEntry {
                index,
                message: message.to_string(),
                branch: parse_stash_branch(message),
                oid: oid.to_string(),
            });
            true
        })?;

        Ok(out)
    }

    fn commit_graph(&self, skip: usize, limit: usize) -> Result<CommitGraphPage, AppError> {
        let repo = self.repo()?;
        let refs = collect_refs(&repo)?;

        let mut walk = repo.revwalk()?;
        // TOPOLOGICAL garantit qu'un enfant précède toujours ses parents (condition
        // de l'algorithme de lanes côté frontend) ; TIME départage les branches
        // indépendantes par date décroissante.
        walk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME)?;

        // Toutes les têtes locales + HEAD (qui couvre le cas détaché). Sur un dépôt
        // sans aucun commit les deux échouent : le parcours est alors simplement
        // vide, ce qui donne une page vide plutôt qu'une erreur.
        let _ = walk.push_glob("refs/heads/*");
        let _ = walk.push_head();

        // On demande un élément de plus que `limit` : sa présence suffit à savoir
        // qu'il reste des commits, sans second appel.
        let mut commits = Vec::new();
        let mut has_more = false;
        for (i, oid) in walk.skip(skip).take(limit + 1).enumerate() {
            if i == limit {
                has_more = true;
                break;
            }
            let commit = repo.find_commit(oid?)?;
            commits.push(build_graph_commit(&commit, &refs));
        }

        Ok(CommitGraphPage { commits, has_more })
    }

    fn commit_details(&self, oid: &str) -> Result<CommitDetails, AppError> {
        let repo = self.repo()?;
        let commit = find_commit(&repo, oid)?;

        let mut diff = commit_diff(&repo, &commit, None)?;
        // Un diff arbre↔arbre ne détecte pas les renommages par défaut ; on les
        // active pour rester cohérent avec l'affichage du statut.
        diff.find_similar(None)?;
        let files = diff_deltas_to_entries(&diff);

        let author = commit.author();
        Ok(CommitDetails {
            oid: commit.id().to_string(),
            short_oid: short_oid(commit.id()),
            summary: commit.summary().unwrap_or_default().to_string(),
            // `body()` est déjà le message privé de son résumé et de la ligne vide.
            body: commit
                .body()
                .map(|b| b.trim().to_string())
                .filter(|b| !b.is_empty()),
            author_name: author.name().unwrap_or_default().to_string(),
            author_email: author.email().unwrap_or_default().to_string(),
            timestamp: commit.time().seconds(),
            parents: commit.parent_ids().map(|p| p.to_string()).collect(),
            files,
        })
    }

    fn commit_file_diff(&self, oid: &str, path: &str) -> Result<FileDiff, AppError> {
        let repo = self.repo()?;
        let commit = find_commit(&repo, oid)?;
        let diff = commit_diff(&repo, &commit, Some(path))?;
        build_file_diff(path, &diff)
    }
}

// ── Helpers du graph ────────────────────────────────────────────────────────

/// OID abrégé pour l'affichage.
fn short_oid(oid: Oid) -> String {
    let s = oid.to_string();
    s[..SHORT_OID_LEN.min(s.len())].to_string()
}

/// Résout un OID textuel en commit. Chaîne malformée et objet absent donnent la
/// même erreur : de l'extérieur, le commit demandé n'existe pas.
fn find_commit<'r>(repo: &'r Repository, oid: &str) -> Result<Commit<'r>, AppError> {
    let parsed = Oid::from_str(oid).map_err(|_| AppError::CommitNotFound)?;
    repo.find_commit(parsed).map_err(|_| AppError::CommitNotFound)
}

/// Table `oid → références`, construite en un seul passage pour éviter une
/// recherche par commit pendant le parcours.
///
/// La branche courante est marquée `Head` plutôt que `LocalBranch` : c'est la
/// même référence, pas deux pastilles distinctes.
fn collect_refs(repo: &Repository) -> Result<HashMap<Oid, Vec<GraphRef>>, AppError> {
    let mut map: HashMap<Oid, Vec<GraphRef>> = HashMap::new();

    for item in repo.branches(Some(BranchType::Local))? {
        let (branch, _kind) = item?;
        // `name()` est None si le nom n'est pas de l'UTF-8 valide.
        let Some(name) = branch.name()? else { continue };
        let Some(oid) = branch.get().target() else {
            continue;
        };
        let kind = if branch.is_head() {
            GraphRefKind::Head
        } else {
            GraphRefKind::LocalBranch
        };
        map.entry(oid).or_default().push(GraphRef {
            name: name.to_string(),
            kind,
        });
    }

    // HEAD détaché : aucune branche ne le porte, on l'ajoute explicitement.
    if repo.head_detached().unwrap_or(false) {
        if let Some(oid) = repo.head().ok().and_then(|h| h.target()) {
            map.entry(oid).or_default().insert(
                0,
                GraphRef {
                    name: "HEAD".to_string(),
                    kind: GraphRefKind::Head,
                },
            );
        }
    }

    Ok(map)
}

fn build_graph_commit(commit: &Commit, refs: &HashMap<Oid, Vec<GraphRef>>) -> GraphCommit {
    let oid = commit.id();
    GraphCommit {
        oid: oid.to_string(),
        short_oid: short_oid(oid),
        summary: commit.summary().unwrap_or_default().to_string(),
        author_name: commit.author().name().unwrap_or_default().to_string(),
        timestamp: commit.time().seconds(),
        parents: commit.parent_ids().map(|p| p.to_string()).collect(),
        refs: refs.get(&oid).cloned().unwrap_or_default(),
    }
}

/// Diff d'un commit par rapport à son **premier parent** — le comportement de
/// `git show`. Un commit racine est comparé à un arbre vide (`None`).
fn commit_diff<'r>(
    repo: &'r Repository,
    commit: &Commit<'r>,
    pathspec: Option<&str>,
) -> Result<git2::Diff<'r>, AppError> {
    let tree = commit.tree()?;
    let parent_tree: Option<Tree> = match commit.parent(0) {
        Ok(parent) => Some(parent.tree()?),
        Err(_) => None,
    };

    let mut opts = DiffOptions::new();
    opts.context_lines(3);
    if let Some(p) = pathspec {
        opts.pathspec(p);
    }

    let diff = repo.diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), Some(&mut opts))?;
    Ok(diff)
}

/// Traduit les deltas d'un diff en `FileEntry`, pour réutiliser côté frontend
/// l'affichage déjà en place pour le statut.
fn diff_deltas_to_entries(diff: &git2::Diff) -> Vec<FileEntry> {
    diff.deltas()
        .map(|delta| {
            let status = match delta.status() {
                Delta::Added | Delta::Copied => FileStatus::Added,
                Delta::Deleted => FileStatus::Deleted,
                Delta::Renamed => FileStatus::Renamed,
                Delta::Typechange => FileStatus::Typechange,
                _ => FileStatus::Modified,
            };
            let path = delta
                .new_file()
                .path()
                .or_else(|| delta.old_file().path())
                .map(path_to_string)
                .unwrap_or_default();
            let old_path = match status {
                FileStatus::Renamed => delta.old_file().path().map(path_to_string),
                _ => None,
            };
            FileEntry {
                path,
                old_path,
                status,
            }
        })
        .collect()
}

/// Extrait la branche d'origine d'un message de stash.
///
/// Git génère « WIP on <branche>: <sha> <sujet> » (stash automatique) ou
/// « On <branche>: <message> » (message explicite). Un refname ne peut contenir
/// ni espace ni « : », donc découper sur le premier « : » est sûr.
fn parse_stash_branch(message: &str) -> Option<String> {
    let rest = message
        .strip_prefix("WIP on ")
        .or_else(|| message.strip_prefix("On "))?;
    let (branch, _) = rest.split_once(": ")?;
    Some(branch.to_string())
}

// ── Helpers de classification / construction du diff ────────────────────────

fn path_to_string(p: &Path) -> String {
    p.to_string_lossy().to_string()
}

/// Extrait (nouveau chemin, ancien chemin) d'un delta de renommage.
fn rename_paths(delta: Option<DiffDelta>, fallback: &str) -> (String, Option<String>) {
    match delta {
        Some(d) => {
            let new_p = d
                .new_file()
                .path()
                .map(path_to_string)
                .unwrap_or_else(|| fallback.to_string());
            let old_p = d.old_file().path().map(path_to_string);
            (new_p, old_p)
        }
        None => (fallback.to_string(), None),
    }
}

/// Traduit les flags "index" d'une entrée en (statut, chemin, ancien chemin).
fn classify_index(entry: &StatusEntry, path: &str) -> (FileStatus, String, Option<String>) {
    let s = entry.status();
    if s.contains(Status::INDEX_NEW) {
        (FileStatus::Added, path.to_string(), None)
    } else if s.contains(Status::INDEX_DELETED) {
        (FileStatus::Deleted, path.to_string(), None)
    } else if s.contains(Status::INDEX_RENAMED) {
        let (new_p, old_p) = rename_paths(entry.head_to_index(), path);
        (FileStatus::Renamed, new_p, old_p)
    } else if s.contains(Status::INDEX_TYPECHANGE) {
        (FileStatus::Typechange, path.to_string(), None)
    } else {
        (FileStatus::Modified, path.to_string(), None)
    }
}

/// Traduit les flags "working dir" d'une entrée en (statut, chemin, ancien chemin).
fn classify_workdir(entry: &StatusEntry, path: &str) -> (FileStatus, String, Option<String>) {
    let s = entry.status();
    if s.contains(Status::WT_DELETED) {
        (FileStatus::Deleted, path.to_string(), None)
    } else if s.contains(Status::WT_RENAMED) {
        let (new_p, old_p) = rename_paths(entry.index_to_workdir(), path);
        (FileStatus::Renamed, new_p, old_p)
    } else if s.contains(Status::WT_TYPECHANGE) {
        (FileStatus::Typechange, path.to_string(), None)
    } else {
        (FileStatus::Modified, path.to_string(), None)
    }
}

/// Construit un [`FileDiff`] structuré à partir d'un `git2::Diff`.
///
/// On utilise `Diff::print` (callback unique) plutôt que `Diff::foreach` : ce
/// dernier exigerait que deux closures empruntent `hunks` en mutable en même
/// temps, ce que l'emprunteur refuse. `print` distingue en-têtes de fichier ('F'),
/// en-têtes de hunk ('H') et lignes de contenu (' ', '+', '-') via `line.origin()`.
fn build_file_diff(path: &str, diff: &git2::Diff) -> Result<FileDiff, AppError> {
    let mut hunks: Vec<DiffHunk> = Vec::new();
    let mut is_binary = false;

    diff.print(DiffFormat::Patch, |delta, _hunk, line| {
        if delta.flags().contains(DiffFlags::BINARY) {
            is_binary = true;
        }
        match line.origin() {
            // Nouvel en-tête de hunk : on ouvre un hunk.
            'H' => {
                let header = String::from_utf8_lossy(line.content())
                    .trim_end()
                    .to_string();
                hunks.push(DiffHunk {
                    header,
                    lines: Vec::new(),
                });
            }
            // Lignes de contenu : rattachées au dernier hunk ouvert.
            c @ (' ' | '+' | '-') => {
                let kind = match c {
                    '+' => DiffLineKind::Addition,
                    '-' => DiffLineKind::Deletion,
                    _ => DiffLineKind::Context,
                };
                let content = String::from_utf8_lossy(line.content())
                    .trim_end_matches(['\n', '\r'])
                    .to_string();
                if let Some(h) = hunks.last_mut() {
                    h.lines.push(DiffLine {
                        kind,
                        content,
                        old_lineno: line.old_lineno(),
                        new_lineno: line.new_lineno(),
                    });
                }
            }
            // En-tête de fichier ('F'), marqueurs EOFNL/binaire, etc. : ignorés.
            _ => {}
        }
        true
    })?;

    Ok(FileDiff {
        path: path.to_string(),
        is_binary,
        hunks,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static DIR_COUNTER: AtomicUsize = AtomicUsize::new(0);

    /// Chemin temporaire garanti unique. L'horodatage seul ne suffit pas : les
    /// tests démarrent en parallèle et peuvent lire la même valeur, ce qui les
    /// ferait partager un dépôt (source de flakiness).
    fn unique_dir(prefix: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let n = DIR_COUNTER.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!("gitlite-{prefix}-{nanos}-{n}"))
    }

    /// Crée un dépôt temporaire isolé avec une identité Git locale.
    fn temp_repo() -> (PathBuf, Libgit2Backend) {
        let dir = unique_dir("test");
        fs::create_dir_all(&dir).unwrap();
        let repo = Repository::init(&dir).unwrap();
        let mut cfg = repo.config().unwrap();
        cfg.set_str("user.name", "Test").unwrap();
        cfg.set_str("user.email", "test@example.com").unwrap();
        let backend = Libgit2Backend::open(&dir).unwrap();
        (dir, backend)
    }

    #[test]
    fn full_cycle_stage_diff_commit() {
        let (dir, git) = temp_repo();

        // 1. Fichier non suivi.
        fs::write(dir.join("a.txt"), "ligne 1\nligne 2\n").unwrap();
        let st = git.status().unwrap();
        assert_eq!(st.untracked.len(), 1);
        assert_eq!(st.untracked[0].path, "a.txt");

        // 2. Stage → passe en indexé (ajout).
        git.stage("a.txt").unwrap();
        let st = git.status().unwrap();
        assert_eq!(st.staged.len(), 1);
        assert!(matches!(st.staged[0].status, FileStatus::Added));
        assert!(st.untracked.is_empty());

        // 3. Diff indexé : deux lignes ajoutées.
        let diff = git.file_diff("a.txt", true).unwrap();
        let additions = diff
            .hunks
            .iter()
            .flat_map(|h| &h.lines)
            .filter(|l| matches!(l.kind, DiffLineKind::Addition))
            .count();
        assert_eq!(additions, 2);

        // 4. Commit → statut propre.
        let res = git.commit("Premier commit", None, false).unwrap();
        assert!(!res.oid.is_empty());
        let st = git.status().unwrap();
        assert!(st.staged.is_empty() && st.unstaged.is_empty() && st.untracked.is_empty());

        // 5. Modification → apparaît en "modifié".
        fs::write(dir.join("a.txt"), "ligne 1\nMODIF\nligne 2\n").unwrap();
        let st = git.status().unwrap();
        assert_eq!(st.unstaged.len(), 1);
        assert!(matches!(st.unstaged[0].status, FileStatus::Modified));

        // 6. Commit sans rien d'indexé → refusé proprement.
        assert!(matches!(
            git.commit("vide", None, false),
            Err(AppError::NothingToCommit)
        ));

        // 7. Stage all + commit du changement.
        git.stage_all().unwrap();
        assert_eq!(git.status().unwrap().staged.len(), 1);
        git.commit("Second commit", Some("corps"), false).unwrap();
        assert!(git.status().unwrap().staged.is_empty());

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn amend_replaces_last_commit() {
        let (dir, git) = temp_repo();
        fs::write(dir.join("a.txt"), "1\n").unwrap();
        git.stage("a.txt").unwrap();
        let first = git.commit("initial", None, false).unwrap();

        // Amende uniquement le message : nouvel OID, historique inchangé (1 commit).
        let amended = git.commit("initial corrigé", None, true).unwrap();
        assert_ne!(first.oid, amended.oid);

        let repo = Repository::open(&dir).unwrap();
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(head.id().to_string(), amended.oid);
        assert_eq!(head.summary(), Some("initial corrigé"));
        assert_eq!(head.parent_count(), 0); // toujours le commit initial

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn unstage_new_file_returns_to_untracked() {
        let (dir, git) = temp_repo();
        fs::write(dir.join("b.txt"), "x\n").unwrap();
        git.stage("b.txt").unwrap();
        assert_eq!(git.status().unwrap().staged.len(), 1);

        git.unstage("b.txt").unwrap();
        let st = git.status().unwrap();
        assert!(st.staged.is_empty());
        assert_eq!(st.untracked.len(), 1); // pas encore committé → redevient non suivi
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn list_and_checkout_local_branches() {
        let (dir, git) = temp_repo();
        fs::write(dir.join("a.txt"), "1\n").unwrap();
        git.stage("a.txt").unwrap();
        git.commit("initial", None, false).unwrap();

        // Crée une branche imbriquée à partir de HEAD.
        let repo = Repository::open(&dir).unwrap();
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        repo.branch("feature/x", &head, false).unwrap();

        let branches = git.local_branches().unwrap();
        assert_eq!(branches.len(), 2);
        let feature = branches.iter().find(|b| b.name == "feature/x").unwrap();
        assert!(!feature.is_head);
        // La tête de branche est renseignée : le frontend s'en sert pour
        // sélectionner ce commit dans le graph.
        assert_eq!(feature.oid, head.id().to_string());

        // Bascule dessus : is_head suit et info() reflète la nouvelle branche.
        git.checkout_branch("feature/x").unwrap();
        let branches = git.local_branches().unwrap();
        assert!(branches.iter().any(|b| b.name == "feature/x" && b.is_head));
        assert_eq!(git.info().unwrap().branch.as_deref(), Some("feature/x"));

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn parses_stash_branch_from_message() {
        assert_eq!(
            parse_stash_branch("WIP on dev: 1a2b3c sujet").as_deref(),
            Some("dev")
        );
        assert_eq!(
            parse_stash_branch("On fix/EDIAG6-811: mon message").as_deref(),
            Some("fix/EDIAG6-811")
        );
        assert_eq!(parse_stash_branch("format inattendu"), None);
    }

    #[test]
    fn lists_stashes_with_origin_branch() {
        let (dir, git) = temp_repo();
        fs::write(dir.join("a.txt"), "1\n").unwrap();
        git.stage("a.txt").unwrap();
        git.commit("initial", None, false).unwrap();
        let current = git.info().unwrap().branch.unwrap();

        assert!(git.stashes().unwrap().is_empty());

        // Crée un stash à partir d'une modification non indexée.
        let mut repo = Repository::open(&dir).unwrap();
        fs::write(dir.join("a.txt"), "modifié\n").unwrap();
        let sig = repo.signature().unwrap();
        repo.stash_save(&sig, "mon travail", None).unwrap();

        let stashes = git.stashes().unwrap();
        assert_eq!(stashes.len(), 1);
        assert_eq!(stashes[0].index, 0);
        assert_eq!(stashes[0].branch.as_deref(), Some(current.as_str()));
        assert!(!stashes[0].oid.is_empty());

        fs::remove_dir_all(&dir).ok();
    }

    // ── Graph ───────────────────────────────────────────────────────────────

    #[test]
    fn commit_graph_walks_all_local_branches() {
        let (dir, git) = temp_repo();
        fs::write(dir.join("a.txt"), "1\n").unwrap();
        git.stage("a.txt").unwrap();
        git.commit("c1", None, false).unwrap();
        fs::write(dir.join("a.txt"), "2\n").unwrap();
        git.stage("a.txt").unwrap();
        git.commit("c2", None, false).unwrap();

        // Branche latérale à partir de c2, avec son propre commit.
        let repo = Repository::open(&dir).unwrap();
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        repo.branch("feature/x", &head, false).unwrap();
        git.checkout_branch("feature/x").unwrap();
        fs::write(dir.join("b.txt"), "x\n").unwrap();
        git.stage("b.txt").unwrap();
        let feat = git.commit("c3", None, false).unwrap();

        // Les trois commits sont visibles, y compris ceux hors de la branche courante.
        let page = git.commit_graph(0, 50).unwrap();
        assert_eq!(page.commits.len(), 3);
        assert!(!page.has_more);

        // Le plus récent est en tête et porte le badge HEAD sur feature/x.
        assert_eq!(page.commits[0].oid, feat.oid);
        assert_eq!(page.commits[0].summary, "c3");
        assert_eq!(page.commits[0].short_oid.len(), SHORT_OID_LEN);
        let head_ref = page.commits[0]
            .refs
            .iter()
            .find(|r| matches!(r.kind, GraphRefKind::Head))
            .expect("HEAD doit être badgé sur le dernier commit");
        assert_eq!(head_ref.name, "feature/x");

        // La branche par défaut reste sur c2 (badge de branche simple).
        let c2 = &page.commits[1];
        assert_eq!(c2.summary, "c2");
        assert!(c2
            .refs
            .iter()
            .any(|r| matches!(r.kind, GraphRefKind::LocalBranch)));
        assert_eq!(c2.parents.len(), 1);

        // Le commit racine n'a pas de parent.
        assert!(page.commits[2].parents.is_empty());

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn commit_graph_paginates() {
        let (dir, git) = temp_repo();
        for i in 0..5 {
            fs::write(dir.join("a.txt"), format!("{i}\n")).unwrap();
            git.stage("a.txt").unwrap();
            git.commit(&format!("c{i}"), None, false).unwrap();
        }

        let first = git.commit_graph(0, 2).unwrap();
        assert_eq!(first.commits.len(), 2);
        assert!(first.has_more);

        // Dernière page : moins d'éléments que demandé et plus rien après.
        let last = git.commit_graph(4, 2).unwrap();
        assert_eq!(last.commits.len(), 1);
        assert!(!last.has_more);

        // Les pages sont des tranches cohérentes du parcours complet.
        let all = git.commit_graph(0, 50).unwrap();
        assert_eq!(all.commits.len(), 5);
        assert_eq!(all.commits[0].oid, first.commits[0].oid);
        assert_eq!(all.commits[1].oid, first.commits[1].oid);
        assert_eq!(all.commits[4].oid, last.commits[0].oid);

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn commit_graph_on_empty_repo_is_empty() {
        let (dir, git) = temp_repo();
        let page = git.commit_graph(0, 50).unwrap();
        assert!(page.commits.is_empty());
        assert!(!page.has_more);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn commit_details_lists_changed_files() {
        let (dir, git) = temp_repo();
        fs::write(dir.join("a.txt"), "1\n").unwrap();
        git.stage("a.txt").unwrap();
        git.commit("initial", None, false).unwrap();

        fs::write(dir.join("a.txt"), "2\n").unwrap();
        fs::write(dir.join("b.txt"), "nouveau\n").unwrap();
        git.stage_all().unwrap();
        let res = git.commit("second", Some("corps du message"), false).unwrap();

        let details = git.commit_details(&res.oid).unwrap();
        assert_eq!(details.summary, "second");
        assert_eq!(details.body.as_deref(), Some("corps du message"));
        assert_eq!(details.author_email, "test@example.com");
        assert_eq!(details.parents.len(), 1);

        // Un fichier modifié + un ajouté, avec les bons statuts.
        assert_eq!(details.files.len(), 2);
        let a = details.files.iter().find(|f| f.path == "a.txt").unwrap();
        assert!(matches!(a.status, FileStatus::Modified));
        let b = details.files.iter().find(|f| f.path == "b.txt").unwrap();
        assert!(matches!(b.status, FileStatus::Added));

        // Un commit sans corps ne fabrique pas une chaîne vide.
        let first = git.commit_details(&details.parents[0]).unwrap();
        assert_eq!(first.summary, "initial");
        assert!(first.body.is_none());
        assert!(first.parents.is_empty());

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn commit_file_diff_uses_first_parent() {
        let (dir, git) = temp_repo();
        fs::write(dir.join("a.txt"), "ligne 1\n").unwrap();
        git.stage("a.txt").unwrap();
        let first = git.commit("initial", None, false).unwrap();

        fs::write(dir.join("a.txt"), "ligne 1\nligne 2\n").unwrap();
        git.stage("a.txt").unwrap();
        let second = git.commit("ajout", None, false).unwrap();

        // Diff vs parent : uniquement la ligne ajoutée.
        let diff = git.commit_file_diff(&second.oid, "a.txt").unwrap();
        let added: Vec<&str> = diff
            .hunks
            .iter()
            .flat_map(|h| &h.lines)
            .filter(|l| matches!(l.kind, DiffLineKind::Addition))
            .map(|l| l.content.as_str())
            .collect();
        assert_eq!(added, ["ligne 2"]);

        // Commit racine : comparé à l'arbre vide, tout le fichier est en ajout.
        let root = git.commit_file_diff(&first.oid, "a.txt").unwrap();
        let added_root = root
            .hunks
            .iter()
            .flat_map(|h| &h.lines)
            .filter(|l| matches!(l.kind, DiffLineKind::Addition))
            .count();
        assert_eq!(added_root, 1);

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn commit_lookup_on_unknown_oid_fails() {
        let (dir, git) = temp_repo();

        // Chaîne malformée et OID bien formé mais absent : même erreur.
        assert!(matches!(
            git.commit_details("pas-un-oid"),
            Err(AppError::CommitNotFound)
        ));
        assert!(matches!(
            git.commit_details("0123456789abcdef0123456789abcdef01234567"),
            Err(AppError::CommitNotFound)
        ));
        assert!(matches!(
            git.commit_file_diff("pas-un-oid", "a.txt"),
            Err(AppError::CommitNotFound)
        ));

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn open_non_repo_fails() {
        let dir = unique_dir("notrepo");
        fs::create_dir_all(&dir).unwrap();
        assert!(matches!(
            Libgit2Backend::open(&dir),
            Err(AppError::NotARepository)
        ));
        fs::remove_dir_all(&dir).ok();
    }
}
