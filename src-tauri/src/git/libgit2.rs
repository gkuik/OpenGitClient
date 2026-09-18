//! Implémentation de [`GitBackend`] basée sur libgit2 (git2-rs).

use std::collections::HashMap;
use std::cell::{Cell, RefCell};
use std::path::{Path, PathBuf};
use std::rc::Rc;

use git2::{
    build::CheckoutBuilder, Branch, BranchType, Commit, ConfigLevel, Cred, CredentialType, Delta,
    DiffDelta, DiffFlags, DiffFormat, DiffOptions, ErrorClass, ErrorCode, FetchOptions,
    IndexAddOption, ObjectType, Oid, PushOptions, Reference, RemoteCallbacks, Repository,
    RepositoryState, ResetType, Sort, StashFlags, Status, StatusEntry, StatusOptions, Tree,
};

use super::{GitBackend, WatchRoots};
use crate::dto::{
    BranchEntry, CommitDetails, CommitGraphPage, CommitResult, DiffHunk, DiffLine, DiffLineKind,
    FetchReport, FetchedRef, FileDiff, FileEntry, FileStatus, GraphCommit, GraphRef, GraphRefKind,
    Identity, MergeMode, MergeOutcome, MergeReport, PullMode, PullOutcome, PullReport, PushMode, PushReport,
    RemoteBranchEntry, RemoteInfo, RepoInfo, RepoStatus, StashEntry, Upstream,
};
use crate::error::AppError;

/// Longueur des OID abrégés affichés dans le graph (convention Git).
const SHORT_OID_LEN: usize = 7;

/// Nombre maximum d'identifiants proposés au serveur avant d'abandonner.
///
/// libgit2 rappelle le callback d'authentification tant qu'on lui rend des
/// identifiants refusés : sans plafond, un accès refusé boucle à l'infini. La
/// valeur laisse la place à l'enchaînement normal côté SSH (nom d'utilisateur,
/// puis clé) plus quelques essais de l'agent.
const MAX_CRED_ATTEMPTS: u32 = 5;

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
            merging: repo.state() == RepositoryState::Merge,
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

    fn discard_all(&self) -> Result<(), AppError> {
        let repo = self.repo()?;

        // ── 1. Fichiers suivis : retour à HEAD, index et disque compris ──
        match repo.head() {
            Ok(head) => {
                let obj = head.peel(ObjectType::Commit)?;
                repo.reset(&obj, ResetType::Hard, None)?;
            }
            Err(_) => {
                // HEAD non né : aucun arbre où revenir. Vider l'index suffit,
                // tout ce qui reste sur le disque est alors non suivi et part
                // à l'étape suivante.
                let mut index = repo.index()?;
                index.clear()?;
                index.write()?;
            }
        }

        // ── 2. Fichiers non suivis : suppression sur le disque ──
        // Un dépôt nu n'a rien à nettoyer.
        if let Some(workdir) = repo.workdir().map(Path::to_path_buf) {
            // `recurse_untracked_dirs` donne les fichiers un à un plutôt qu'un
            // dossier en bloc : un dossier non suivi peut contenir des fichiers
            // ignorés, qui doivent survivre. Les chemins sont collectés avant
            // toute suppression, le temps de rendre l'emprunt sur le dépôt.
            let mut opts = StatusOptions::new();
            opts.include_untracked(true)
                .recurse_untracked_dirs(true)
                .include_ignored(false);

            let untracked: Vec<String> = repo
                .statuses(Some(&mut opts))?
                .iter()
                .filter(|e| e.status().contains(Status::WT_NEW))
                .filter_map(|e| e.path().map(str::to_string))
                .collect();

            for rel in untracked {
                let abs = workdir.join(&rel);
                remove_untracked(&abs)?;
                prune_empty_dirs(&workdir, abs.parent());
            }
        }

        // Comme `git reset --hard` : la fusion éventuelle est refermée, sans
        // quoi le prochain commit se ferait deux parents sur des conflits qui
        // n'existent plus.
        repo.cleanup_state()?;
        Ok(())
    }

    fn discard_paths(&self, paths: &[String]) -> Result<(), AppError> {
        let repo = self.repo()?;

        // HEAD décide : un chemin qui y est y revient ; un chemin qui n'y est
        // pas est un fichier neuf, qui n'a nulle part où revenir. Un HEAD non
        // né n'a pas d'arbre, et tout est alors « neuf ».
        let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
        let (tracked, new): (Vec<&String>, Vec<&String>) = paths.iter().partition(|p| {
            head_tree
                .as_ref()
                .is_some_and(|tree| tree.get_path(Path::new(p)).is_ok())
        });

        // `git checkout HEAD -- <paths>` : index et disque, en un seul passage.
        // Forcé, parce que la stratégie SAFE refuse d'écraser des modifications
        // locales — et c'est exactement ce qu'on lui demande ici.
        if !tracked.is_empty() {
            let mut opts = CheckoutBuilder::new();
            opts.force();
            for p in &tracked {
                opts.path(p.as_str());
            }
            repo.checkout_head(Some(&mut opts))?;
        }

        // Fichiers neufs : hors de l'index s'ils y étaient — une seule écriture
        // — puis hors du disque. Un dépôt nu n'a pas de disque à nettoyer.
        if !new.is_empty() {
            let mut index = repo.index()?;
            let mut dirty = false;
            for p in &new {
                if index.get_path(Path::new(p), 0).is_some() {
                    index.remove_path(Path::new(p))?;
                    dirty = true;
                }
            }
            if dirty {
                index.write()?;
            }
            if let Some(workdir) = repo.workdir() {
                for p in &new {
                    let abs = workdir.join(p);
                    remove_untracked(&abs)?;
                    prune_empty_dirs(workdir, abs.parent());
                }
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
        let mut repo = self.repo()?;

        // Une fusion en cours ajoute ses têtes aux parents du commit. Lu ici,
        // avant tout emprunt du dépôt, parce que `mergehead_foreach` le prend
        // en `&mut`. **Sans ça, le commit qui résout une fusion n'aurait qu'un
        // parent** : le lien vers la branche fusionnée serait perdu, et
        // `MERGE_HEAD` resterait derrière — dépôt en état incohérent.
        let merge_heads = merge_heads(&mut repo)?;

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

        // Refuse un commit qui n'apporte aucun changement — sauf en fusion : un
        // merge qui retient entièrement « notre » côté a légitimement l'arbre de
        // HEAD, et refuser laisserait la fusion ouverte sans issue.
        if merge_heads.is_empty() {
            match &parent_commit {
                Some(parent) if parent.tree_id() == tree_oid => {
                    return Err(AppError::NothingToCommit);
                }
                None if tree.len() == 0 => {
                    return Err(AppError::NothingToCommit);
                }
                _ => {}
            }
        }

        let merged: Vec<Commit> = merge_heads
            .iter()
            .map(|oid| repo.find_commit(*oid))
            .collect::<Result<_, _>>()?;
        let parents: Vec<&Commit> = parent_commit.iter().chain(merged.iter()).collect();
        let oid = repo.commit(
            Some("HEAD"),
            &signature,
            &signature,
            &message,
            &tree,
            &parents,
        )?;

        // La fusion est close : `MERGE_HEAD` et compagnie disparaissent, sinon
        // le prochain commit se croirait encore en fusion.
        if !merge_heads.is_empty() {
            repo.cleanup_state()?;
        }

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
                let target = branch.get().target();
                out.push(BranchEntry {
                    name: name.to_string(),
                    is_head: branch.is_head(),
                    oid: target.map(|o| o.to_string()).unwrap_or_default(),
                    upstream: upstream_of(&repo, &branch, target),
                });
            }
        }

        out.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(out)
    }

    fn remote_branches(&self) -> Result<Vec<RemoteBranchEntry>, AppError> {
        let repo = self.repo()?;
        let mut out = Vec::new();

        for item in repo.branches(Some(BranchType::Remote))? {
            let (branch, _kind) = item?;
            let reference = branch.get();

            // `<distant>/HEAD` est un pointeur *symbolique* vers la branche par
            // défaut du distant : l'afficher doublerait cette branche. Une
            // référence symbolique n'a pas de `target()`, ce qui l'écarte ici au
            // même titre qu'une référence cassée.
            let Some(oid) = reference.target() else {
                continue;
            };
            // `name()` peut être None si le nom n'est pas de l'UTF-8 valide.
            let Some(name) = branch.name()? else {
                continue;
            };

            let remote = remote_name_of(&repo, reference, name);

            out.push(RemoteBranchEntry {
                name: name.to_string(),
                remote,
                oid: oid.to_string(),
            });
        }

        out.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(out)
    }

    fn checkout_branch(&self, name: &str) -> Result<(), AppError> {
        let repo = self.repo()?;
        checkout_local(&repo, name)
    }

    fn checkout_remote_branch(&self, name: &str) -> Result<(), AppError> {
        let repo = self.repo()?;
        // Échoue tôt si la branche distante n'existe pas.
        let branch = repo.find_branch(name, BranchType::Remote)?;
        let reference = branch.get();
        let remote = remote_name_of(&repo, reference, name);
        let local_name = name
            .strip_prefix(&format!("{remote}/"))
            .unwrap_or(name)
            .to_string();

        // Une branche locale porte déjà ce nom : on bascule dessus telle quelle,
        // comme `git checkout <nom>`. Elle peut être en retard sur la distante —
        // la rattraper serait un pull, pas un checkout.
        if repo.find_branch(&local_name, BranchType::Local).is_ok() {
            return self.checkout_branch(&local_name);
        }

        let commit = reference.peel_to_commit()?;

        // L'ordre compte : le working directory est mis à jour **avant** que la
        // branche existe. Un conflit interrompt donc tout sans laisser derrière
        // lui une branche à moitié créée.
        let mut opts = CheckoutBuilder::new();
        repo.checkout_tree(commit.as_object(), Some(&mut opts))
            .map_err(map_checkout_error)?;

        let mut local = repo.branch(&local_name, &commit, false)?;
        // Le suivi est ce qui distingue cette bascule d'une branche créée de
        // rien, et ce dont un futur pull/push aura besoin. Son échec (distant
        // supprimé, refspec absente) ne doit pas faire échouer une bascule déjà
        // effectuée : le checkout, lui, a bien eu lieu.
        let _ = local.set_upstream(Some(name));

        repo.set_head(&format!("refs/heads/{local_name}"))?;
        Ok(())
    }

    fn merge_branches(
        &self,
        source: &str,
        target: &str,
        mode: MergeMode,
    ) -> Result<MergeReport, AppError> {
        let repo = self.repo()?;

        // Une fusion déjà en cours interdit d'en ouvrir une seconde : `MERGE_HEAD`
        // est unique, et l'écraser perdrait le côté qui restait à résoudre.
        if repo.state() != RepositoryState::Clean {
            return Err(AppError::MergeInProgress);
        }

        let source_oid = repo
            .find_branch(source, BranchType::Local)?
            .get()
            .target()
            .ok_or(AppError::CommitNotFound)?;
        let target_oid = repo
            .find_branch(target, BranchType::Local)?
            .get()
            .target()
            .ok_or(AppError::CommitNotFound)?;

        // Écart mesuré **depuis la source** : `ahead` est ce que la cible
        // gagnerait, `behind` ce qu'elle a en propre. Les deux suffisent à
        // décider, sans passer par `merge_analysis`, qui ne raisonne que par
        // rapport à HEAD — or la cible n'est pas forcément la branche courante.
        // Une source fusionnée sur elle-même donne (0, 0), donc « déjà à jour ».
        let (ahead, behind) = repo.graph_ahead_behind(source_oid, target_oid)?;

        let current = repo
            .head()
            .ok()
            .filter(|h| h.is_branch())
            .and_then(|h| h.shorthand().map(str::to_string));
        let on_target = current.as_deref() == Some(target);

        let report = |switched, outcome| MergeReport {
            source: source.to_string(),
            target: target.to_string(),
            switched,
            outcome,
        };

        if ahead == 0 {
            return Ok(report(false, MergeOutcome::UpToDate));
        }

        if behind == 0 && mode == MergeMode::FastForwardOrMerge {
            // Avance rapide. Le working directory ne suit que si la cible est la
            // branche courante ; sinon il n'y a qu'une référence à déplacer, et ni
            // HEAD ni les fichiers n'ont à bouger — c'est tout l'intérêt de ne pas
            // basculer pour rien.
            if on_target {
                let object = repo.find_object(source_oid, None)?;
                let mut opts = CheckoutBuilder::new();
                repo.checkout_tree(&object, Some(&mut opts))
                    .map_err(map_checkout_error)?;
            }
            repo.reference(
                &format!("refs/heads/{target}"),
                source_oid,
                true,
                &format!("merge {source}: avance rapide"),
            )?;
            return Ok(report(false, MergeOutcome::FastForwarded { commits: ahead }));
        }

        // Divergence — ou avance rapide refusée par le mode. La cible doit devenir
        // la branche courante pour recevoir la fusion : un commit s'écrit sur HEAD,
        // pas sur une branche inactive. La bascule vient **avant** toute écriture,
        // et sa
        // stratégie SAFE refuse d'écraser des modifications locales — la fusion
        // n'est donc jamais entamée sur un working directory qu'on ne pourrait
        // pas préparer.
        let switched = !on_target;
        if switched {
            checkout_local(&repo, target)?;
        }

        // `merge` écrit l'index et le working directory, et pose `MERGE_HEAD` :
        // à partir d'ici le dépôt est en état de fusion, que le commit ci-dessous
        // ou `abort_merge` referme.
        let annotated = repo.find_annotated_commit(source_oid)?;
        let mut opts = CheckoutBuilder::new();
        repo.merge(&[&annotated], None, Some(&mut opts))
            .map_err(map_checkout_error)?;

        let mut index = repo.index()?;
        if index.has_conflicts() {
            // On reste sur la cible, en fusion : les conflits sont dans le working
            // directory, l'utilisateur les résout puis committe (le commit
            // reprendra `MERGE_HEAD` comme second parent) ou abandonne.
            return Ok(report(
                switched,
                MergeOutcome::Conflicted {
                    files: conflicted_paths(&index),
                },
            ));
        }

        let tree_oid = index.write_tree()?;
        let tree = repo.find_tree(tree_oid)?;
        let signature = repo.signature().map_err(|_| AppError::MissingSignature)?;
        let ours = repo.head()?.peel_to_commit()?;
        let theirs = repo.find_commit(source_oid)?;
        repo.commit(
            Some("HEAD"),
            &signature,
            &signature,
            &format!("Merge branch '{source}' into {target}"),
            &tree,
            &[&ours, &theirs],
        )?;
        repo.cleanup_state()?;

        Ok(report(switched, MergeOutcome::Merged { commits: ahead }))
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

        // Le message ci-dessus vient du reflog, où libgit2 remplace les retours
        // à la ligne par des espaces : une remise nommée puis décrite y arrive
        // recollée en une seule ligne. Le commit de stash, lui, porte le message
        // intact — on le relit donc ici, hors de la closure, qui emprunte le
        // dépôt en mutable. Le reflog reste la source de la branche : le format
        // « On <branche> : » y est garanti, y compris pour un stash créé
        // ailleurs.
        for entry in &mut out {
            if let Some(message) = Oid::from_str(&entry.oid)
                .and_then(|oid| repo.find_commit(oid))
                .ok()
                .and_then(|commit| commit.message().map(|m| m.trim_end().to_string()))
            {
                entry.message = message;
            }
        }

        Ok(out)
    }

    fn stash_save(&self, summary: &str, body: Option<&str>) -> Result<(), AppError> {
        let mut repo = self.repo()?;
        // Un stash est un commit : il est signé comme tel, donc par l'identité
        // du dépôt — la même que celle choisie dans la boîte de commit.
        let signature = repo.signature().map_err(|_| AppError::MissingSignature)?;

        // Même construction que `commit` : résumé, ligne vide, description.
        let message = match body {
            Some(b) if !b.trim().is_empty() => format!("{}\n\n{}", summary.trim(), b.trim()),
            _ => summary.trim().to_string(),
        };

        // INCLUDE_UNTRACKED remise aussi les fichiers non suivis : sans ça le
        // working directory ne ressortirait pas propre, ce qui est précisément
        // ce qu'on attend d'une remise. L'index n'est pas conservé (pas de
        // KEEP_INDEX) : ce qui était indexé le redeviendra au dépilage.
        match repo.stash_save(&signature, &message, Some(StashFlags::INCLUDE_UNTRACKED)) {
            Ok(_) => Ok(()),
            // libgit2 signale « rien à remiser » par un NotFound générique, que
            // le bandeau d'erreur rendrait incompréhensible.
            Err(e) if e.code() == ErrorCode::NotFound => Err(AppError::NothingToStash),
            Err(e) => Err(e.into()),
        }
    }

    fn stash_apply(&self, index: usize) -> Result<(), AppError> {
        // Les opérations de stash exigent un Repository mutable ; on le possède.
        let mut repo = self.repo()?;
        repo.stash_apply(index, None).map_err(map_stash_error)
    }

    fn stash_pop(&self, index: usize) -> Result<(), AppError> {
        let mut repo = self.repo()?;
        repo.stash_pop(index, None).map_err(map_stash_error)
    }

    fn stash_drop(&self, index: usize) -> Result<(), AppError> {
        let mut repo = self.repo()?;
        repo.stash_drop(index)?;
        Ok(())
    }

    fn commit_graph(&self, skip: usize, limit: usize) -> Result<CommitGraphPage, AppError> {
        let repo = self.repo()?;
        let refs = collect_refs(&repo)?;

        let mut walk = repo.revwalk()?;
        // TOPOLOGICAL garantit qu'un enfant précède toujours ses parents (condition
        // de l'algorithme de lanes côté frontend) ; TIME départage les branches
        // indépendantes par date décroissante.
        walk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME)?;

        // Toutes les têtes locales + HEAD (qui couvre le cas détaché), plus les
        // têtes distantes : sans elles, un `origin/main` en avance n'aurait aucun
        // commit à montrer alors que la sidebar l'affiche. Sur un dépôt sans
        // aucun commit les trois échouent : le parcours est alors simplement
        // vide, ce qui donne une page vide plutôt qu'une erreur.
        let _ = walk.push_glob("refs/heads/*");
        let _ = walk.push_glob("refs/remotes/*");
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

    fn fetch(&self, remote: Option<&str>) -> Result<FetchReport, AppError> {
        let repo = self.repo()?;
        let name = resolve_remote(&repo, remote)?;
        let updated = fetch_one(&repo, &name)?;
        Ok(FetchReport {
            remote: name,
            updated,
        })
    }


    fn push(&self, remote: Option<&str>, mode: PushMode) -> Result<PushReport, AppError> {
        let repo = self.repo()?;

        // Il faut une branche : un HEAD détaché n'a rien à publier.
        let head = repo.head().map_err(|_| AppError::DetachedHead)?;
        let branch_name = head
            .shorthand()
            .filter(|_| head.is_branch())
            .ok_or(AppError::DetachedHead)?
            .to_string();

        let name = resolve_remote(&repo, remote)?;
        let mut remote = repo.find_remote(&name).map_err(|_| AppError::NoRemote)?;

        // Lu **avant** le push : c'est ce qui distingue un premier push (à qui on
        // pose le suivi) d'un push ordinaire.
        let had_upstream = repo
            .find_branch(&branch_name, BranchType::Local)
            .ok()
            .and_then(|b| b.upstream().ok())
            .is_some();

        // Même écueil que dans `fetch` : les callbacks vivent dans les
        // `PushOptions` jusqu'à la fin de la fonction, donc leur état passe par
        // des `Rc` pour rester lisible après coup.
        let rejection = Rc::new(RefCell::new(None::<String>));
        let cred_state = Rc::new(Cell::new(CredState::Untouched));
        // Où le dernier fetch a laissé la branche distante. C'est le « bail »
        // (*lease*) : la promesse qu'on n'écrasera que cet état-là, et pas ce
        // qu'un autre aurait poussé depuis.
        let leased = Rc::new(RefCell::new(None::<String>));

        let mut callbacks = RemoteCallbacks::new();
        {
            let rejection = Rc::clone(&rejection);
            callbacks.push_update_reference(move |refname, status| {
                // **Ce callback n'est pas optionnel.** Un serveur peut refuser
                // une référence (non-fast-forward, branche protégée, hook) sans
                // que `push()` échoue pour autant : sans le lire, ce rejet
                // passerait pour un succès.
                if let Some(msg) = status {
                    *rejection.borrow_mut() = Some(format!("{refname} : {msg}"));
                }
                Ok(())
            });
        }
        {
            let state = Rc::clone(&cred_state);
            let mut attempts = 0u32;
            callbacks.credentials(move |url, username, allowed| {
                attempts += 1;
                credentials(url, username, allowed, attempts, &state)
            });
        }
        if mode == PushMode::ForceWithLease {
            // Le bail se vérifie **ici** et nulle part ailleurs : ce callback est
            // le seul endroit où l'on connaisse l'état réel du serveur (`dst`)
            // avant que le moindre octet ne parte. Le comparer à notre référence
            // de suivi, c'est exactement ce que fait `--force-with-lease` ; en
            // renvoyant une erreur, on annule le push avant l'envoi.
            //
            // Une branche distante absente donne un `dst` nul, et notre attente
            // vaut alors nul aussi : créer la branche n'écrase rien.
            let expected = repo
                .find_reference(&format!("refs/remotes/{name}/{branch_name}"))
                .ok()
                .and_then(|r| r.target())
                .unwrap_or_else(Oid::zero);
            let leased = Rc::clone(&leased);
            callbacks.push_negotiation(move |updates| {
                for update in updates {
                    // `src` est l'état **actuel** de la référence sur le serveur,
                    // `dst` la valeur qu'on veut y écrire — l'inverse de ce que
                    // les noms suggèrent au premier coup d'œil.
                    let actual = update.src();
                    if actual != expected {
                        *leased.borrow_mut() = Some(short_oid(actual));
                        return Err(git2::Error::from_str(
                            "remote branch moved since the last fetch",
                        ));
                    }
                }
                Ok(())
            });
        }

        let mut options = PushOptions::new();
        options.remote_callbacks(callbacks);

        // Refspec explicite, et non celles configurées pour le distant : on ne
        // pousse **que** la branche courante, jamais toutes les têtes. Le "+" en
        // tête n'apparaît que sur demande explicite de l'utilisateur, entrée par
        // entrée dans le menu du bouton — jamais par défaut, et jamais retenu.
        let forced = mode != PushMode::Normal;
        let lead = if forced { "+" } else { "" };
        let refspec = format!("{lead}refs/heads/{branch_name}:refs/heads/{branch_name}");
        let result = remote.push(&[refspec.as_str()], Some(&mut options));
        // Ne pas laisser de connexion ouverte derrière soi, succès ou non.
        let _ = remote.disconnect();

        match result {
            Ok(()) => {}
            // Bail rompu : c'est notre propre callback qui a interrompu le push,
            // donc avant tout envoi. Ce cas passe avant les autres, l'erreur
            // remontée par libgit2 étant celle que nous lui avons donnée.
            Err(_) if leased.borrow().is_some() => {
                let actual = leased.borrow().clone().unwrap_or_default();
                return Err(AppError::PushLeaseStale(actual));
            }
            // Rejet côté client : libgit2 compare les références annoncées par le
            // serveur avant d'envoyer quoi que ce soit, et s'arrête là.
            Err(e) if e.code() == ErrorCode::NotFastForward => {
                return Err(AppError::PushRejected(e.message().to_string()))
            }
            Err(_) if cred_state.get() == CredState::NothingToOffer => {
                return Err(AppError::NoCredentials)
            }
            Err(_) if cred_state.get() == CredState::Refused => return Err(AppError::RemoteAuth),
            Err(e) => return Err(fetch_error(e)),
        }

        // Rejet côté serveur, lui, remonté par le callback.
        if let Some(reason) = rejection.borrow().clone() {
            return Err(AppError::PushRejected(reason));
        }

        // `push -u`, et seulement après coup : une branche amont posée alors que
        // le push a échoué désignerait une référence qui n'existe pas.
        let mut upstream_set = false;
        if !had_upstream {
            if let Ok(mut branch) = repo.find_branch(&branch_name, BranchType::Local) {
                upstream_set = branch
                    .set_upstream(Some(&format!("{name}/{branch_name}")))
                    .is_ok();
            }
        }

        Ok(PushReport {
            remote: name,
            branch: branch_name,
            upstream_set,
            forced,
        })
    }

    fn pull(&self, mode: PullMode) -> Result<PullReport, AppError> {
        let repo = self.repo()?;

        // « Fetch All » n'intègre rien : il s'arrête après avoir interrogé tous
        // les distants. Un distant injoignable interrompt le lot — annoncer un
        // succès partiel serait pire que l'erreur.
        if mode == PullMode::FetchAll {
            let remotes: Vec<String> = repo
                .remotes()?
                .iter()
                .flatten()
                .map(str::to_string)
                .collect();
            if remotes.is_empty() {
                return Err(AppError::NoRemote);
            }
            let mut updated = Vec::new();
            for name in &remotes {
                updated.extend(fetch_one(&repo, name)?);
            }
            return Ok(PullReport {
                remotes,
                updated,
                outcome: PullOutcome::FetchedOnly,
            });
        }

        // Les deux autres modes intègrent : il faut une branche courante.
        let head = repo.head().map_err(|_| AppError::DetachedHead)?;
        let branch_name = head
            .shorthand()
            .filter(|_| head.is_branch())
            .ok_or(AppError::DetachedHead)?
            .to_string();

        let remote_name = resolve_remote(&repo, None)?;
        let updated = fetch_one(&repo, &remote_name)?;

        // L'amont est relu **après** le fetch : c'est tout l'intérêt de l'ordre.
        let branch = repo.find_branch(&branch_name, BranchType::Local)?;
        let local = branch.get().target().ok_or(AppError::NoUpstream)?;
        let upstream = branch.upstream().map_err(|_| AppError::NoUpstream)?;
        let upstream_name = upstream
            .name()?
            .ok_or(AppError::NoUpstream)?
            .to_string();
        let target = upstream.get().target().ok_or(AppError::NoUpstream)?;

        let (ahead, behind) = repo.graph_ahead_behind(local, target)?;
        let annotated = repo.find_annotated_commit(target)?;
        let (analysis, _preference) = repo.merge_analysis(&[&annotated])?;

        let report = |outcome| PullReport {
            remotes: vec![remote_name.clone()],
            updated: updated.clone(),
            outcome,
        };

        if analysis.is_up_to_date() {
            return Ok(report(PullOutcome::UpToDate));
        }

        if analysis.is_fast_forward() {
            // Avance rapide : le working directory suit la cible, puis la
            // référence de branche est déplacée. HEAD pointe déjà dessus, donc
            // rien d'autre à faire. La stratégie SAFE refuse d'écraser des
            // modifications locales, et l'erreur remonte telle quelle.
            let object = repo.find_object(target, None)?;
            let mut opts = CheckoutBuilder::new();
            repo.checkout_tree(&object, Some(&mut opts))
                .map_err(map_checkout_error)?;
            repo.reference(
                &format!("refs/heads/{branch_name}"),
                target,
                true,
                &format!("pull: avance rapide vers {upstream_name}"),
            )?;
            return Ok(report(PullOutcome::FastForwarded { commits: behind }));
        }

        // Divergence. En mode « avance rapide seulement », on s'arrête ici sans
        // rien toucher : le fetch, lui, a bien eu lieu et est dans le rapport.
        if mode == PullMode::FastForwardOnly {
            return Ok(report(PullOutcome::Diverged { ahead, behind }));
        }

        // Fusion. `merge` écrit l'index et le working directory, et pose
        // `MERGE_HEAD` : à partir d'ici le dépôt est en état de fusion, que le
        // commit ci-dessous ou `abort_merge` referme.
        let mut opts = CheckoutBuilder::new();
        repo.merge(&[&annotated], None, Some(&mut opts))
            .map_err(map_checkout_error)?;

        let mut index = repo.index()?;
        if index.has_conflicts() {
            // On laisse le dépôt en fusion : les conflits sont dans le working
            // directory, l'utilisateur les résout puis committe (le commit
            // reprendra `MERGE_HEAD` comme second parent) ou abandonne.
            return Ok(report(PullOutcome::Conflicted {
                files: conflicted_paths(&index),
            }));
        }

        let tree_oid = index.write_tree()?;
        let tree = repo.find_tree(tree_oid)?;
        let signature = repo.signature().map_err(|_| AppError::MissingSignature)?;
        let ours = repo.head()?.peel_to_commit()?;
        let theirs = repo.find_commit(target)?;
        repo.commit(
            Some("HEAD"),
            &signature,
            &signature,
            &format!("Merge branch '{upstream_name}' into {branch_name}"),
            &tree,
            &[&ours, &theirs],
        )?;
        repo.cleanup_state()?;

        Ok(report(PullOutcome::Merged { commits: behind }))
    }

    fn abort_merge(&self) -> Result<(), AppError> {
        let repo = self.repo()?;
        // `force` est le sens même de l'abandon : les fichiers en conflit
        // reviennent à HEAD, ce que la stratégie SAFE refuserait justement.
        let mut opts = CheckoutBuilder::new();
        opts.force();
        repo.checkout_head(Some(&mut opts))?;
        repo.cleanup_state()?;
        Ok(())
    }

    fn remote_info(&self, remote: Option<&str>) -> Result<RemoteInfo, AppError> {
        let repo = self.repo()?;
        let name = resolve_remote(&repo, remote)?;
        let remote = repo.find_remote(&name).map_err(|_| AppError::NoRemote)?;
        let url = remote.url().unwrap_or_default().to_string();
        let host = crate::credentials::host_of(&url);
        Ok(RemoteInfo {
            has_credentials: host.as_deref().map(crate::credentials::has).unwrap_or(false),
            uses_http: url.starts_with("http://") || url.starts_with("https://"),
            // Reconnue sur l'URL, donc valable en SSH comme en HTTPS : c'est
            // l'API de la forge qui réclame un jeton, pas le transport Git.
            forge: crate::forge::detect(&url).map(|f| f.kind),
            name,
            url,
            host,
        })
    }

    fn identity(&self) -> Result<Identity, AppError> {
        let repo = self.repo()?;
        // La config du dépôt empile système, globale et locale : c'est elle qui
        // donne l'identité *effective*, celle que `repo.signature()` utilisera.
        let config = repo.config()?;
        // Le niveau local seul, pour distinguer un profil choisi ici d'une valeur
        // héritée de la configuration globale.
        let local = config.open_level(ConfigLevel::Local).ok();
        let is_local = local
            .as_ref()
            .map(|c| c.get_string("user.name").is_ok() || c.get_string("user.email").is_ok())
            .unwrap_or(false);

        Ok(Identity {
            name: config.get_string("user.name").ok(),
            email: config.get_string("user.email").ok(),
            is_local,
        })
    }

    fn set_identity(&self, name: &str, email: &str) -> Result<(), AppError> {
        let repo = self.repo()?;
        let mut local = repo.config()?.open_level(ConfigLevel::Local)?;
        local.set_str("user.name", name)?;
        local.set_str("user.email", email)?;
        Ok(())
    }

    fn clear_identity(&self) -> Result<(), AppError> {
        let repo = self.repo()?;
        let mut local = repo.config()?.open_level(ConfigLevel::Local)?;
        // Absente = déjà le résultat demandé, ce n'est pas une erreur.
        let _ = local.remove("user.name");
        let _ = local.remove("user.email");
        Ok(())
    }

    // ── Surveillance du disque ──────────────────────────────────────────────

    fn watch_roots(&self) -> Result<WatchRoots, AppError> {
        let repo = self.repo()?;
        Ok(WatchRoots {
            workdir: repo.workdir().map(Path::to_path_buf),
            gitdir: repo.path().to_path_buf(),
        })
    }

    fn filter_ignored(&self, paths: Vec<PathBuf>) -> Vec<PathBuf> {
        // Sans dépôt lisible on ne filtre rien : mieux vaut un rafraîchissement
        // de trop que d'avaler un vrai changement.
        let Ok(repo) = self.repo() else { return paths };
        let Some(workdir) = repo.workdir().map(Path::to_path_buf) else {
            return paths;
        };
        paths
            .into_iter()
            .filter(|p| {
                // libgit2 attend un chemin relatif au working directory ; un
                // chemin qui n'en relève pas ne concerne pas ce dépôt.
                let Ok(rel) = p.strip_prefix(&workdir) else {
                    return false;
                };
                // Une erreur (chemin non-UTF-8, dépôt en cours d'écriture) ne
                // doit pas faire disparaître le changement : on le garde.
                !repo.status_should_ignore(rel).unwrap_or(false)
            })
            .collect()
    }
}

// ── Helpers du fetch ────────────────────────────────────────────────────────

/// Fetch d'**un** distant sur un dépôt déjà ouvert : le corps partagé par
/// `fetch`, par le mode « Fetch All » et par le pull, qui commence toujours par
/// là. Renvoie les références déplacées.
fn fetch_one(repo: &Repository, name: &str) -> Result<Vec<FetchedRef>, AppError> {
    let mut remote = repo.find_remote(name).map_err(|_| AppError::NoRemote)?;

    // Les deux closures gardent chacune leur état, et cet état doit rester
    // lisible **après** le fetch. D'où `Rc` plutôt que des emprunts : les
    // callbacks vivent dans les `FetchOptions` jusqu'à la fin de la fonction,
    // ce qui rendrait tout emprunt mutable direct impossible — même écueil
    // que `Diff::foreach` ailleurs dans ce fichier.
    let updated = Rc::new(RefCell::new(Vec::new()));
    let cred_state = Rc::new(Cell::new(CredState::Untouched));

    let mut callbacks = RemoteCallbacks::new();
    {
        let updated = Rc::clone(&updated);
        callbacks.update_tips(move |name, old, new| {
            // `old` est nul quand la référence vient d'apparaître.
            updated.borrow_mut().push(FetchedRef {
                name: name.to_string(),
                old_oid: (!old.is_zero()).then(|| old.to_string()),
                new_oid: new.to_string(),
            });
            true
        });
    }
    {
        let state = Rc::clone(&cred_state);
        let mut attempts = 0u32;
        callbacks.credentials(move |url, username, allowed| {
            attempts += 1;
            credentials(url, username, allowed, attempts, &state)
        });
    }

    let mut options = FetchOptions::new();
    options.remote_callbacks(callbacks);
    // Pas de prune automatique : Git ne le fait pas non plus par défaut, et
    // supprimer des références sans que l'utilisateur l'ait demandé serait une
    // surprise désagréable.

    // Refspecs vides = celles configurées pour ce distant, comme `git fetch`.
    let refspecs: [&str; 0] = [];
    let result = remote.fetch(&refspecs, Some(&mut options), None);
    // Ne pas laisser de connexion ouverte derrière soi, succès ou non.
    let _ = remote.disconnect();

    match result {
        Ok(()) => Ok(updated.borrow().clone()),
        // L'erreur que libgit2 remonte est générique dans les deux cas, alors
        // que la cause exacte est connue ici — et n'appelle pas le même geste.
        Err(_) if cred_state.get() == CredState::NothingToOffer => {
            Err(AppError::NoCredentials)
        }
        Err(_) if cred_state.get() == CredState::Refused => Err(AppError::RemoteAuth),
        Err(e) => Err(fetch_error(e)),
    }
}

/// Détermine quel dépôt distant interroger quand l'appel n'en nomme aucun :
/// celui suivi par la branche courante, sinon `origin`, sinon le premier déclaré.
fn resolve_remote(repo: &Repository, wanted: Option<&str>) -> Result<String, AppError> {
    if let Some(name) = wanted {
        return Ok(name.to_string());
    }

    if let Ok(head) = repo.head() {
        if let Some(branch) = head.shorthand().filter(|_| head.is_branch()) {
            if let Ok(buf) = repo.branch_upstream_remote(&format!("refs/heads/{branch}")) {
                if let Some(name) = buf.as_str() {
                    return Ok(name.to_string());
                }
            }
        }
    }

    // Un seul parcours : `origin` s'il existe, sinon le premier distant déclaré.
    let remotes = repo.remotes()?;
    let mut fallback = None;
    for name in remotes.iter().flatten() {
        if name == "origin" {
            return Ok(name.to_string());
        }
        fallback.get_or_insert(name);
    }
    fallback.map(str::to_string).ok_or(AppError::NoRemote)
}

/// Fournit des identifiants au serveur, dans l'ordre des méthodes qu'il accepte.
///
/// **Rien n'est délégué à un programme externe.** `Cred::credential_helper` a été
/// écarté volontairement : il lance `git credential-<helper>`, ce qui ferait
/// dépendre l'application d'une installation de Git. Tout passe donc par
/// libssh2/libgit2, déjà liés dans le binaire.
///
/// Le callback est rappelé après chaque refus : `attempts` sert à faire défiler
/// les identifiants candidats plutôt qu'à représenter éternellement le même.
fn credentials(
    url: &str,
    username: Option<&str>,
    allowed: CredentialType,
    attempts: u32,
    state: &Cell<CredState>,
) -> Result<Cred, git2::Error> {
    if attempts > MAX_CRED_ATTEMPTS {
        state.set(CredState::Refused);
        return Err(git2::Error::from_str("credentials refused"));
    }

    // En SSH, libgit2 réclame d'abord le nom d'utilisateur seul, puis la clé.
    // Ce n'est pas encore un identifiant : l'état ne bouge pas.
    if allowed.contains(CredentialType::USERNAME) {
        return Cred::username(username.unwrap_or("git"));
    }

    if allowed.contains(CredentialType::SSH_KEY) {
        let user = username.unwrap_or("git");
        // Premier essai : l'agent, s'il détient une identité.
        if attempts == 1 {
            if let Ok(cred) = Cred::ssh_key_from_agent(user) {
                state.set(CredState::Offered);
                return Ok(cred);
            }
        }
        // Puis les clés du disque, une par rappel. Indispensable : libgit2 ne lit
        // pas `~/.ssh/config` et ne cherche pas ces fichiers de lui-même, donc
        // sans ça seuls les utilisateurs dont l'agent est déjà chargé peuvent se
        // connecter.
        if let Some(path) = nth_ssh_key((attempts - 1) as usize) {
            state.set(CredState::Offered);
            return Cred::ssh_key(user, None, &path, None);
        }
        state.set(CredState::NothingToOffer);
        return Err(git2::Error::from_str("no usable SSH key"));
    }

    // HTTPS : les identifiants que l'application a elle-même enregistrés pour
    // cet hôte. Rien n'est lu ailleurs, et aucun programme externe n'est appelé.
    if allowed.contains(CredentialType::USER_PASS_PLAINTEXT) {
        if let Some(creds) = crate::credentials::host_of(url)
            .and_then(|host| crate::credentials::get(&host))
        {
            state.set(CredState::Offered);
            return Cred::userpass_plaintext(&creds.username, &creds.secret);
        }
    }

    // NTLM / Negotiate : libgit2 se débrouille sans identifiant explicite.
    if allowed.contains(CredentialType::DEFAULT) {
        state.set(CredState::Offered);
        return Cred::default();
    }

    state.set(CredState::NothingToOffer);
    Err(git2::Error::from_str(
        "no authentication method available",
    ))
}

/// Ce que le callback d'authentification a pu faire.
///
/// « On n'avait rien à proposer » et « tout ce qu'on a proposé a été refusé »
/// remontent la même erreur générique côté libgit2, alors qu'ils appellent des
/// gestes très différents de l'utilisateur — d'où cet état explicite.
#[derive(Clone, Copy, PartialEq)]
enum CredState {
    /// Le serveur n'a jamais réclamé d'identifiants (échec avant ce stade).
    Untouched,
    /// Aucun identifiant n'a pu être construit.
    NothingToOffer,
    /// Au moins un identifiant a été proposé.
    Offered,
    /// Tout ce qui a été proposé a été refusé.
    Refused,
}

/// Noms conventionnels des clés SSH, dans l'ordre de préférence moderne.
const SSH_KEY_NAMES: [&str; 3] = ["id_ed25519", "id_ecdsa", "id_rsa"];

/// Chemin de la `index`-ième clé SSH existante dans `~/.ssh`.
fn nth_ssh_key(index: usize) -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    nth_ssh_key_in(&Path::new(&home).join(".ssh"), index)
}

/// Ne renvoie que des fichiers **présents**, afin que l'index parcoure des
/// candidats réels : sans ce filtre, un rappel serait gâché sur un emplacement
/// vide et la clé suivante ne serait jamais essayée.
fn nth_ssh_key_in(dir: &Path, index: usize) -> Option<PathBuf> {
    SSH_KEY_NAMES
        .iter()
        .map(|name| dir.join(name))
        .filter(|path| path.is_file())
        .nth(index)
}

/// Classe une erreur de fetch pour que le frontend puisse la distinguer : un
/// réseau absent n'appelle pas la même réaction qu'un refus d'authentification.
fn fetch_error(e: git2::Error) -> AppError {
    match (e.class(), e.code()) {
        (_, ErrorCode::Auth) => AppError::RemoteAuth,
        // `Os` compte : libgit2 range les échecs de socket (hôte injoignable,
        // connexion refusée) sous cette classe, pas sous `Net`. Dans le chemin du
        // fetch, une erreur système est un échec de transport.
        (ErrorClass::Net, _) | (ErrorClass::Http, _) | (ErrorClass::Os, _) => {
            AppError::Network(e.message().to_string())
        }
        _ => AppError::Git(e.message().to_string()),
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
/// même référence, pas deux pastilles distinctes. Les branches distantes sont
/// parcourues **après** les locales, ce qui range les pastilles dans cet ordre
/// sur un commit qui porte les deux (`main` avant `origin/main`).
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

    for item in repo.branches(Some(BranchType::Remote))? {
        let (branch, _kind) = item?;
        let Some(name) = branch.name()? else { continue };
        // Même filtre que `remote_branches` : `<distant>/HEAD` est symbolique,
        // donc sans `target()`, et doublerait la pastille de la branche par
        // défaut du distant.
        let Some(oid) = branch.get().target() else {
            continue;
        };
        map.entry(oid).or_default().push(GraphRef {
            name: name.to_string(),
            kind: GraphRefKind::RemoteBranch,
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

/// Traduit une erreur d'application de stash. Un conflit (le stash toucherait des
/// fichiers déjà modifiés localement) devient une erreur explicite plutôt qu'un
/// message libgit2 brut ; le reste passe tel quel.
fn map_stash_error(e: git2::Error) -> AppError {
    use git2::{ErrorClass, ErrorCode};
    let conflict = matches!(e.code(), ErrorCode::Conflict)
        || matches!(e.class(), ErrorClass::Merge | ErrorClass::Checkout);
    if conflict {
        AppError::StashConflict
    } else {
        AppError::from(e)
    }
}

/// Têtes d'une fusion en cours, vides hors fusion.
fn merge_heads(repo: &mut Repository) -> Result<Vec<Oid>, AppError> {
    if repo.state() != RepositoryState::Merge {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    repo.mergehead_foreach(|oid| {
        out.push(*oid);
        true
    })?;
    Ok(out)
}

/// Chemins en conflit dans l'index, dédoublonnés et triés.
///
/// Une entrée en conflit peut n'avoir que deux de ses trois côtés (ajout des
/// deux côtés, suppression d'un côté) : on prend le premier disponible plutôt
/// que d'en privilégier un, faute de quoi certains conflits n'auraient pas de
/// nom à afficher.
/// Bascule sur une branche **locale** : le working directory suit, puis HEAD.
///
/// Partagé par `checkout_branch` et la fusion, qui doit amener la cible sous HEAD
/// avant d'écrire quoi que ce soit. Stratégie SAFE : libgit2 refuse d'écraser des
/// modifications locales, et l'erreur remonte explicite plutôt que de perdre du
/// travail.
fn checkout_local(repo: &Repository, name: &str) -> Result<(), AppError> {
    let refname = format!("refs/heads/{name}");
    // Échoue tôt si la branche n'existe pas.
    let target = repo.revparse_single(&refname)?;

    let mut opts = CheckoutBuilder::new();
    repo.checkout_tree(&target, Some(&mut opts))
        .map_err(map_checkout_error)?;

    repo.set_head(&refname)?;
    Ok(())
}

fn conflicted_paths(index: &git2::Index) -> Vec<String> {
    let Ok(conflicts) = index.conflicts() else {
        return Vec::new();
    };
    let mut out: Vec<String> = conflicts
        .flatten()
        .filter_map(|c| {
            c.our
                .or(c.their)
                .or(c.ancestor)
                .map(|entry| String::from_utf8_lossy(&entry.path).to_string())
        })
        .collect();
    out.sort();
    out.dedup();
    out
}

/// Supprime un fichier non suivi. Un chemin déjà disparu n'est pas une erreur :
/// le statut a été lu avant la boucle, et le disque a pu bouger entre-temps.
///
/// Les **dossiers sont laissés en place**. Avec la récursion activée, le seul
/// que libgit2 rapporte encore en bloc est un dépôt imbriqué, dans lequel il
/// refuse de descendre — et l'effacer d'un « annuler les changements » serait
/// exactement ce que `git clean -fd` refuse de faire sans un second `-f`.
fn remove_untracked(path: &Path) -> Result<(), AppError> {
    // `symlink_metadata` ne suit pas les liens : un lien vers un dossier est un
    // fichier à supprimer, pas un dossier à préserver.
    let meta = match std::fs::symlink_metadata(path) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e.into()),
    };
    if meta.is_dir() {
        return Ok(());
    }
    std::fs::remove_file(path)?;
    Ok(())
}

/// Remonte de `dir` vers `root` en retirant les dossiers vidés par la
/// suppression, sans jamais toucher `root` lui-même.
///
/// Rien à filtrer : `remove_dir` échoue sur un dossier non vide, ce qui suffit
/// à protéger celui où il ne restait que des fichiers ignorés, et arrête la
/// remontée du même coup.
fn prune_empty_dirs(root: &Path, dir: Option<&Path>) {
    let mut current = dir;
    while let Some(d) = current {
        if d == root || !d.starts_with(root) || std::fs::remove_dir(d).is_err() {
            return;
        }
        current = d.parent();
    }
}

/// Traduit une erreur de checkout. libgit2 refuse d'écraser des modifications
/// locales (stratégie SAFE) : ce refus devient une erreur explicite, le reste
/// passe tel quel.
fn map_checkout_error(e: git2::Error) -> AppError {
    match e.class() {
        ErrorClass::Checkout => AppError::CheckoutConflict,
        _ => AppError::from(e),
    }
}

/// Branche amont d'une branche locale et écart avec elle, quand elle en a une.
///
/// Tout ce qui manque donne `None` — amont non configuré, référence amont
/// disparue avec son distant, branche sans commit. C'est volontairement le même
/// résultat : dans tous ces cas il n'y a rien à comparer, ce qui n'est pas la
/// même chose qu'un écart nul, et le frontend ne montre alors aucun compteur.
///
/// L'écart se lit entre deux références **locales** : il ne dit que ce que le
/// dernier fetch a ramené, jamais l'état courant du serveur.
fn upstream_of(repo: &Repository, branch: &Branch, local: Option<Oid>) -> Option<Upstream> {
    let local = local?;
    let upstream = branch.upstream().ok()?;
    let name = upstream.name().ok()??.to_string();
    let target = upstream.get().target()?;
    let (ahead, behind) = repo.graph_ahead_behind(local, target).ok()?;
    Some(Upstream {
        name,
        ahead,
        behind,
    })
}

/// Distant auquel appartient une référence de `refs/remotes/**`.
///
/// Demandé à libgit2 plutôt que déduit du nom : un nom de distant peut contenir
/// un "/". Le repli sur le premier segment couvre les références orphelines,
/// laissées derrière par un distant supprimé — sans lui, elles disparaîtraient
/// de la liste des branches.
fn remote_name_of(repo: &Repository, reference: &Reference, shorthand: &str) -> String {
    reference
        .name()
        .and_then(|refname| repo.branch_remote_name(refname).ok())
        .and_then(|buf| buf.as_str().map(str::to_string))
        .unwrap_or_else(|| {
            shorthand
                .split('/')
                .next()
                .unwrap_or(shorthand)
                .to_string()
        })
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
    fn local_branches_report_the_gap_with_their_upstream() {
        let (dir, git) = temp_repo();
        fs::write(dir.join("a.txt"), "1\n").unwrap();
        git.stage("a.txt").unwrap();
        git.commit("c1", None, false).unwrap();
        let current = git.info().unwrap().branch.unwrap();

        // Le distant a un commit de plus que nous, et la branche courante le suit.
        let repo = Repository::open(&dir).unwrap();
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        let sig = repo.signature().unwrap();
        let remote_tip = repo
            .commit(None, &sig, &sig, "c2", &head.tree().unwrap(), &[&head])
            .unwrap();
        repo.remote("origin", "https://example.invalid/x.git").unwrap();
        repo.reference("refs/remotes/origin/main", remote_tip, true, "test")
            .unwrap();
        repo.find_branch(&current, BranchType::Local)
            .unwrap()
            .set_upstream(Some("origin/main"))
            .unwrap();

        let gap = |name: &str| {
            git.local_branches()
                .unwrap()
                .into_iter()
                .find(|b| b.name == name)
                .expect("branche absente de la liste")
                .upstream
        };

        // Sans commit local depuis, on est seulement en retard.
        let up = gap(&current).expect("la branche suit origin/main");
        assert_eq!(up.name, "origin/main");
        assert_eq!((up.ahead, up.behind), (0, 1));

        // Un commit local met aussi en avance : les deux compteurs coexistent.
        fs::write(dir.join("b.txt"), "x\n").unwrap();
        git.stage("b.txt").unwrap();
        git.commit("c3", None, false).unwrap();
        let up = gap(&current).unwrap();
        assert_eq!((up.ahead, up.behind), (1, 1));

        // Une branche sans amont n'a rien à comparer : ce n'est pas un écart nul.
        let repo = Repository::open(&dir).unwrap();
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        repo.branch("solo", &head, false).unwrap();
        assert!(gap("solo").is_none());

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn lists_remote_branches_without_the_head_pointer() {
        let (dir, git) = temp_repo();
        fs::write(dir.join("a.txt"), "1\n").unwrap();
        git.stage("a.txt").unwrap();
        git.commit("initial", None, false).unwrap();

        // Simule ce qu'un clone laisse derrière lui : un distant déclaré, ses
        // branches sous `refs/remotes/`, et le pointeur `origin/HEAD`.
        let repo = Repository::open(&dir).unwrap();
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        repo.remote("origin", "https://example.invalid/x.git").unwrap();
        repo.reference("refs/remotes/origin/main", head.id(), true, "test")
            .unwrap();
        repo.reference("refs/remotes/origin/feature/x", head.id(), true, "test")
            .unwrap();
        repo.reference_symbolic("refs/remotes/origin/HEAD", "refs/remotes/origin/main", true, "test")
            .unwrap();

        let branches = git.remote_branches().unwrap();
        // `origin/HEAD` est écarté : il doublerait `origin/main`.
        assert_eq!(
            branches.iter().map(|b| b.name.as_str()).collect::<Vec<_>>(),
            ["origin/feature/x", "origin/main"]
        );
        assert!(branches.iter().all(|b| b.remote == "origin"));
        assert_eq!(branches[0].oid, head.id().to_string());

        // Les deux listes restent disjointes : rien de distant côté local.
        assert!(git
            .local_branches()
            .unwrap()
            .iter()
            .all(|b| !b.name.starts_with("origin/")));

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn checkout_remote_branch_creates_a_tracking_branch() {
        let (dir, git) = temp_repo();
        fs::write(dir.join("a.txt"), "1\n").unwrap();
        git.stage("a.txt").unwrap();
        git.commit("c1", None, false).unwrap();

        // Une branche qui n'existe que côté distant, en avance d'un commit.
        let repo = Repository::open(&dir).unwrap();
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        let sig = repo.signature().unwrap();
        let ahead = repo
            .commit(None, &sig, &sig, "c2", &head.tree().unwrap(), &[&head])
            .unwrap();
        repo.remote("origin", "https://example.invalid/x.git").unwrap();
        repo.reference("refs/remotes/origin/feature/x", ahead, true, "test")
            .unwrap();

        git.checkout_remote_branch("origin/feature/x").unwrap();

        // La branche locale porte le nom sans le distant, et c'est elle HEAD.
        let info = git.info().unwrap();
        assert_eq!(info.branch.as_deref(), Some("feature/x"));
        assert_eq!(info.head.as_deref(), Some(ahead.to_string().as_str()));
        assert!(git
            .local_branches()
            .unwrap()
            .iter()
            .any(|b| b.name == "feature/x" && b.is_head));

        // Elle suit la branche distante dont elle est issue.
        let repo = Repository::open(&dir).unwrap();
        let local = repo.find_branch("feature/x", BranchType::Local).unwrap();
        let upstream = local.upstream().unwrap();
        assert_eq!(upstream.name().unwrap(), Some("origin/feature/x"));

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn checkout_remote_branch_reuses_an_existing_local_branch() {
        let (dir, git) = temp_repo();
        fs::write(dir.join("a.txt"), "1\n").unwrap();
        git.stage("a.txt").unwrap();
        let base = git.commit("c1", None, false).unwrap();

        // `dev` existe en local sur c1, alors que `origin/dev` a un commit de
        // plus. Basculer ne doit **pas** faire avancer la locale : ce serait un
        // pull, pas un checkout.
        let repo = Repository::open(&dir).unwrap();
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        repo.branch("dev", &head, false).unwrap();
        let sig = repo.signature().unwrap();
        let ahead = repo
            .commit(None, &sig, &sig, "c2", &head.tree().unwrap(), &[&head])
            .unwrap();
        repo.remote("origin", "https://example.invalid/x.git").unwrap();
        repo.reference("refs/remotes/origin/dev", ahead, true, "test")
            .unwrap();

        git.checkout_remote_branch("origin/dev").unwrap();

        let info = git.info().unwrap();
        assert_eq!(info.branch.as_deref(), Some("dev"));
        assert_eq!(info.head.as_deref(), Some(base.oid.as_str()));

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

    #[test]
    fn stash_save_stashes_untracked_files_and_keeps_the_description() {
        let (dir, git) = temp_repo();
        fs::write(dir.join("a.txt"), "1\n").unwrap();
        git.stage("a.txt").unwrap();
        git.commit("initial", None, false).unwrap();
        let current = git.info().unwrap().branch.unwrap();

        // Un fichier suivi modifié, un indexé, un jamais suivi : les trois
        // doivent partir, sans quoi le working directory ne ressortirait pas
        // propre.
        fs::write(dir.join("a.txt"), "modifié\n").unwrap();
        fs::write(dir.join("b.txt"), "indexé\n").unwrap();
        git.stage("b.txt").unwrap();
        fs::write(dir.join("neuf.txt"), "nouveau\n").unwrap();

        git.stash_save("mon travail", Some("une description\nsur deux lignes"))
            .unwrap();

        let status = git.status().unwrap();
        assert!(status.staged.is_empty());
        assert!(status.unstaged.is_empty());
        assert!(status.untracked.is_empty());
        assert!(!dir.join("neuf.txt").exists());

        let stashes = git.stashes().unwrap();
        assert_eq!(stashes.len(), 1);
        assert_eq!(stashes[0].branch.as_deref(), Some(current.as_str()));
        // Message relu sur le commit : les retours à la ligne ont survécu, ce
        // qui n'est pas le cas de la version reflog.
        assert!(stashes[0].message.ends_with("mon travail\n\nune description\nsur deux lignes"));

        // Et la remise se dépile bien, non suivis compris.
        git.stash_pop(0).unwrap();
        assert!(dir.join("neuf.txt").exists());

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn stash_save_without_description_keeps_only_the_summary() {
        let (dir, git) = temp_repo();
        fs::write(dir.join("a.txt"), "1\n").unwrap();
        git.stage("a.txt").unwrap();
        git.commit("initial", None, false).unwrap();

        fs::write(dir.join("a.txt"), "modifié\n").unwrap();
        git.stash_save("sans description", Some("   ")).unwrap();

        let stashes = git.stashes().unwrap();
        assert!(stashes[0].message.ends_with("sans description"));

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn stash_save_on_a_clean_worktree_is_a_named_error() {
        let (dir, git) = temp_repo();
        fs::write(dir.join("a.txt"), "1\n").unwrap();
        git.stage("a.txt").unwrap();
        git.commit("initial", None, false).unwrap();

        // Rien à remiser : le NotFound générique de libgit2 devient un
        // discriminant que le frontend peut lire.
        assert!(matches!(
            git.stash_save("rien", None),
            Err(AppError::NothingToStash)
        ));

        fs::remove_dir_all(&dir).ok();
    }

    /// Prépare un dépôt avec un commit initial et `count` stashes empilés. Chaque
    /// stash range une modification distincte de `a.txt` ; l'index 0 est le plus
    /// récent (dernier empilé).
    fn repo_with_stashes(count: usize) -> (PathBuf, Libgit2Backend) {
        let (dir, git) = temp_repo();
        fs::write(dir.join("a.txt"), "base\n").unwrap();
        git.stage("a.txt").unwrap();
        git.commit("initial", None, false).unwrap();

        let mut repo = Repository::open(&dir).unwrap();
        let sig = repo.signature().unwrap();
        for i in 0..count {
            fs::write(dir.join("a.txt"), format!("modif {i}\n")).unwrap();
            repo.stash_save(&sig, &format!("travail {i}"), None).unwrap();
        }
        (dir, git)
    }

    #[test]
    fn stash_apply_keeps_the_stash() {
        let (dir, git) = repo_with_stashes(1);

        // Working directory propre après stash_save.
        assert!(git.status().unwrap().unstaged.is_empty());

        git.stash_apply(0).unwrap();
        // Le changement est de retour dans le working directory…
        assert_eq!(git.status().unwrap().unstaged.len(), 1);
        // …et le stash est toujours là (apply ≠ pop).
        assert_eq!(git.stashes().unwrap().len(), 1);

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn stash_pop_applies_and_removes() {
        let (dir, git) = repo_with_stashes(1);

        git.stash_pop(0).unwrap();
        assert_eq!(git.status().unwrap().unstaged.len(), 1);
        // pop retire le stash de la pile.
        assert!(git.stashes().unwrap().is_empty());

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn stash_drop_removes_without_applying() {
        let (dir, git) = repo_with_stashes(2);
        assert_eq!(git.stashes().unwrap().len(), 2);

        // On retire le plus récent (index 0) : l'autre subsiste et le working
        // directory reste propre (drop n'applique rien).
        git.stash_drop(0).unwrap();
        let remaining = git.stashes().unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].message, "On master: travail 0");
        assert!(git.status().unwrap().unstaged.is_empty());

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn stash_apply_conflict_is_reported() {
        let (dir, git) = repo_with_stashes(1);

        // Rend le working directory conflictuel avec le stash sur le même fichier.
        fs::write(dir.join("a.txt"), "contenu incompatible\n").unwrap();

        assert!(matches!(git.stash_apply(0), Err(AppError::StashConflict)));
        // Le stash n'est pas perdu.
        assert_eq!(git.stashes().unwrap().len(), 1);

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
    fn commit_graph_walks_remote_refs() {
        let (dir, git) = temp_repo();
        fs::write(dir.join("a.txt"), "1\n").unwrap();
        git.stage("a.txt").unwrap();
        git.commit("c1", None, false).unwrap();

        // Un commit qui n'existe **que** côté distant : créé sans mettre à jour
        // aucune référence (`update_ref = None`), puis désigné par
        // `refs/remotes/origin/main`. C'est l'état laissé par un fetch quand le
        // distant a pris de l'avance.
        let repo = Repository::open(&dir).unwrap();
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        let sig = repo.signature().unwrap();
        let remote_only = repo
            .commit(
                None,
                &sig,
                &sig,
                "c2 distant",
                &head.tree().unwrap(),
                &[&head],
            )
            .unwrap();
        repo.remote("origin", "https://example.invalid/x.git").unwrap();
        repo.reference("refs/remotes/origin/main", remote_only, true, "test")
            .unwrap();

        // Sans le parcours de `refs/remotes/*`, ce commit serait invisible.
        let page = git.commit_graph(0, 50).unwrap();
        assert_eq!(page.commits.len(), 2);
        assert_eq!(page.commits[0].oid, remote_only.to_string());

        let badge = page.commits[0]
            .refs
            .iter()
            .find(|r| matches!(r.kind, GraphRefKind::RemoteBranch))
            .expect("la tête distante doit être badgée");
        assert_eq!(badge.name, "origin/main");

        // `origin/HEAD` n'ajoute pas une pastille de plus : elle doublerait
        // celle de `origin/main`.
        repo.reference_symbolic("refs/remotes/origin/HEAD", "refs/remotes/origin/main", true, "test")
            .unwrap();
        let page = git.commit_graph(0, 50).unwrap();
        assert_eq!(page.commits.len(), 2);
        assert_eq!(page.commits[0].refs.len(), 1);

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

    // ── Fetch ───────────────────────────────────────────────────────────────
    //
    // Un dépôt distant sur le disque suffit : libgit2 sait parler le transport
    // local, ce qui teste tout l'enchaînement (résolution du distant, callbacks,
    // rapport) sans réseau ni authentification.

    /// Crée un dépôt « distant » avec un commit, et un clone local qui le suit.
    fn repo_with_remote() -> (PathBuf, PathBuf, Libgit2Backend) {
        let (origin_dir, origin) = temp_repo();
        fs::write(origin_dir.join("a.txt"), "origine\n").unwrap();
        origin.stage("a.txt").unwrap();
        origin.commit("commit distant", None, false).unwrap();

        let (local_dir, local) = temp_repo();
        let repo = Repository::open(&local_dir).unwrap();
        repo.remote("origin", origin_dir.to_str().unwrap()).unwrap();

        (origin_dir, local_dir, local)
    }

    /// Dépôt local relié à un **dépôt nu**. Un push vers un dépôt avec working
    /// directory serait refusé par le distant (sa branche courante), ce que Git
    /// fait aussi : le distant d'un push est nu dans la vraie vie.
    fn repo_with_bare_remote() -> (PathBuf, PathBuf, Libgit2Backend) {
        let origin_dir = unique_dir("origin-bare");
        Repository::init_bare(&origin_dir).unwrap();

        let (local_dir, local) = temp_repo();
        let repo = Repository::open(&local_dir).unwrap();
        repo.remote("origin", origin_dir.to_str().unwrap()).unwrap();

        (origin_dir, local_dir, local)
    }

    /// Dépôt local suivant un distant sur disque, branche de suivi créée : ce
    /// qu'un clone laisse, et le minimum dont un pull a besoin.
    fn repo_tracking_remote() -> (PathBuf, PathBuf, Libgit2Backend, Libgit2Backend, String) {
        let (origin_dir, origin) = temp_repo();
        fs::write(origin_dir.join("a.txt"), "1\n").unwrap();
        origin.stage("a.txt").unwrap();
        origin.commit("c1", None, false).unwrap();
        let branch = origin.info().unwrap().branch.unwrap();

        let (local_dir, local) = temp_repo();
        let repo = Repository::open(&local_dir).unwrap();
        repo.remote("origin", origin_dir.to_str().unwrap()).unwrap();
        local.fetch(None).unwrap();
        local
            .checkout_remote_branch(&format!("origin/{branch}"))
            .unwrap();

        (origin_dir, local_dir, origin, local, branch)
    }

    /// Ajoute un commit au dépôt donné.
    fn commit_file(dir: &Path, git: &Libgit2Backend, file: &str, content: &str, msg: &str) {
        fs::write(dir.join(file), content).unwrap();
        git.stage(file).unwrap();
        git.commit(msg, None, false).unwrap();
    }

    #[test]
    fn pull_fast_forwards_when_the_local_has_not_moved() {
        let (origin_dir, local_dir, origin, local, _) = repo_tracking_remote();
        commit_file(&origin_dir, &origin, "a.txt", "2\n", "c2");

        let report = local.pull(PullMode::FastForwardOrMerge).unwrap();
        assert_eq!(report.remotes, ["origin"]);
        assert!(matches!(
            report.outcome,
            PullOutcome::FastForwarded { commits: 1 }
        ));

        // Le working directory suit, et la branche est sur le commit distant.
        assert_eq!(fs::read_to_string(local_dir.join("a.txt")).unwrap(), "2\n");
        assert_eq!(local.info().unwrap().head, origin.info().unwrap().head);
        // Rien n'a été fusionné : pas d'état de fusion en travers.
        assert!(!local.info().unwrap().merging);

        // Sans mouvement en face, un second pull ne fait rien.
        assert!(matches!(
            local.pull(PullMode::FastForwardOrMerge).unwrap().outcome,
            PullOutcome::UpToDate
        ));

        fs::remove_dir_all(&origin_dir).ok();
        fs::remove_dir_all(&local_dir).ok();
    }

    #[test]
    fn pull_fast_forward_only_refuses_a_divergence() {
        let (origin_dir, local_dir, origin, local, _) = repo_tracking_remote();
        commit_file(&origin_dir, &origin, "a.txt", "2\n", "c2 distant");
        commit_file(&local_dir, &local, "b.txt", "local\n", "c2 local");
        let before = local.info().unwrap().head;

        let report = local.pull(PullMode::FastForwardOnly).unwrap();
        assert!(
            matches!(
                report.outcome,
                PullOutcome::Diverged {
                    ahead: 1,
                    behind: 1
                }
            ),
            "{:?}",
            report.outcome
        );
        // Le fetch, lui, a bien eu lieu : c'est ce qui rend la divergence
        // mesurable, et pourquoi ce n'est pas une erreur.
        assert!(!report.updated.is_empty());
        // Rien n'a bougé en local.
        assert_eq!(local.info().unwrap().head, before);
        assert!(!local.info().unwrap().merging);

        fs::remove_dir_all(&origin_dir).ok();
        fs::remove_dir_all(&local_dir).ok();
    }

    #[test]
    fn pull_merges_when_the_two_sides_touch_different_files() {
        let (origin_dir, local_dir, origin, local, _) = repo_tracking_remote();
        commit_file(&origin_dir, &origin, "a.txt", "2\n", "c2 distant");
        commit_file(&local_dir, &local, "b.txt", "local\n", "c2 local");

        let report = local.pull(PullMode::FastForwardOrMerge).unwrap();
        assert!(
            matches!(report.outcome, PullOutcome::Merged { commits: 1 }),
            "{:?}",
            report.outcome
        );

        // Un commit de fusion : deux parents, et l'état de fusion est refermé.
        let details = local
            .commit_details(&local.info().unwrap().head.unwrap())
            .unwrap();
        assert_eq!(details.parents.len(), 2);
        assert!(!local.info().unwrap().merging);
        // Les deux côtés sont là.
        assert_eq!(fs::read_to_string(local_dir.join("a.txt")).unwrap(), "2\n");
        assert!(local_dir.join("b.txt").exists());

        fs::remove_dir_all(&origin_dir).ok();
        fs::remove_dir_all(&local_dir).ok();
    }

    #[test]
    fn pull_conflict_is_left_to_the_user_then_committed_with_two_parents() {
        let (origin_dir, local_dir, origin, local, _) = repo_tracking_remote();
        commit_file(&origin_dir, &origin, "a.txt", "distant\n", "c2 distant");
        commit_file(&local_dir, &local, "a.txt", "local\n", "c2 local");

        let report = local.pull(PullMode::FastForwardOrMerge).unwrap();
        match report.outcome {
            PullOutcome::Conflicted { files } => assert_eq!(files, ["a.txt"]),
            other => panic!("conflit attendu, obtenu {other:?}"),
        }
        // Le dépôt reste en fusion : c'est ce qui permet d'en sortir.
        assert!(local.info().unwrap().merging);

        // Résolution : le fichier est réécrit puis indexé, et le commit reprend
        // la tête de fusion en second parent.
        fs::write(local_dir.join("a.txt"), "résolu\n").unwrap();
        local.stage("a.txt").unwrap();
        let res = local.commit("Merge distant", None, false).unwrap();
        let details = local.commit_details(&res.oid).unwrap();
        assert_eq!(details.parents.len(), 2);
        // La fusion est refermée : le commit suivant n'en héritera pas.
        assert!(!local.info().unwrap().merging);

        fs::remove_dir_all(&origin_dir).ok();
        fs::remove_dir_all(&local_dir).ok();
    }

    #[test]
    fn abort_merge_restores_head_and_clears_the_merge_state() {
        let (origin_dir, local_dir, origin, local, _) = repo_tracking_remote();
        commit_file(&origin_dir, &origin, "a.txt", "distant\n", "c2 distant");
        commit_file(&local_dir, &local, "a.txt", "local\n", "c2 local");
        let before = local.info().unwrap().head;

        local.pull(PullMode::FastForwardOrMerge).unwrap();
        assert!(local.info().unwrap().merging);

        local.abort_merge().unwrap();
        let info = local.info().unwrap();
        assert!(!info.merging);
        assert_eq!(info.head, before);
        // Le fichier revient à la version locale, marqueurs de conflit compris.
        assert_eq!(
            fs::read_to_string(local_dir.join("a.txt")).unwrap(),
            "local\n"
        );
        assert!(local.status().unwrap().unstaged.is_empty());

        fs::remove_dir_all(&origin_dir).ok();
        fs::remove_dir_all(&local_dir).ok();
    }

    #[test]
    fn discard_all_reverts_tracked_files_and_deletes_untracked_ones() {
        let (dir, git) = temp_repo();
        fs::write(dir.join(".gitignore"), "build/\n").unwrap();
        fs::write(dir.join("a.txt"), "origine\n").unwrap();
        git.stage_all().unwrap();
        git.commit("initial", None, false).unwrap();

        // Un suivi modifié, un neuf déjà indexé, un non suivi au fond d'un
        // dossier, et un ignoré qui n'est pas un changement.
        fs::write(dir.join("a.txt"), "modifié\n").unwrap();
        fs::write(dir.join("b.txt"), "indexé\n").unwrap();
        git.stage("b.txt").unwrap();
        fs::create_dir_all(dir.join("neuf")).unwrap();
        fs::write(dir.join("neuf/c.txt"), "neuf\n").unwrap();
        fs::create_dir_all(dir.join("build")).unwrap();
        fs::write(dir.join("build/out.bin"), "ignoré\n").unwrap();

        git.discard_all().unwrap();

        let st = git.status().unwrap();
        assert!(st.staged.is_empty() && st.unstaged.is_empty() && st.untracked.is_empty());
        assert_eq!(fs::read_to_string(dir.join("a.txt")).unwrap(), "origine\n");
        assert!(!dir.join("b.txt").exists());
        // Le dossier n'existait que pour son fichier : il part avec lui.
        assert!(!dir.join("neuf").exists());
        // L'ignoré survit, et son dossier avec — il n'est pas vide.
        assert_eq!(
            fs::read_to_string(dir.join("build/out.bin")).unwrap(),
            "ignoré\n"
        );

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn discard_paths_reverts_a_tracked_file_and_leaves_the_others_alone() {
        let (dir, git) = temp_repo();
        fs::write(dir.join("a.txt"), "origine\n").unwrap();
        fs::write(dir.join("b.txt"), "origine\n").unwrap();
        git.stage_all().unwrap();
        git.commit("initial", None, false).unwrap();

        // `a.txt` est modifié deux fois : une version indexée, une autre sur le
        // disque. Le discard doit effacer les deux, pas seulement l'une.
        fs::write(dir.join("a.txt"), "indexé\n").unwrap();
        git.stage("a.txt").unwrap();
        fs::write(dir.join("a.txt"), "modifié\n").unwrap();
        fs::write(dir.join("b.txt"), "modifié aussi\n").unwrap();

        git.discard_paths(&["a.txt".to_string()]).unwrap();

        assert_eq!(fs::read_to_string(dir.join("a.txt")).unwrap(), "origine\n");
        let st = git.status().unwrap();
        assert!(st.staged.is_empty());
        // Le voisin n'a pas bougé : le discard est bien limité au chemin.
        assert_eq!(st.unstaged.len(), 1);
        assert_eq!(st.unstaged[0].path, "b.txt");
        assert_eq!(fs::read_to_string(dir.join("b.txt")).unwrap(), "modifié aussi\n");

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn discard_paths_deletes_a_new_file_indexed_or_not() {
        let (dir, git) = temp_repo();
        fs::write(dir.join(".gitignore"), "build/\n").unwrap();
        git.stage_all().unwrap();
        git.commit("initial", None, false).unwrap();

        // Un neuf déjà indexé, un non suivi au fond d'un dossier, et un ignoré
        // dans ce même dossier, qui doit survivre avec son dossier.
        fs::write(dir.join("b.txt"), "indexé\n").unwrap();
        git.stage("b.txt").unwrap();
        fs::create_dir_all(dir.join("neuf/build")).unwrap();
        fs::write(dir.join("neuf/c.txt"), "neuf\n").unwrap();
        fs::write(dir.join("neuf/build/out.bin"), "ignoré\n").unwrap();

        git.discard_paths(&["b.txt".to_string()]).unwrap();
        assert!(!dir.join("b.txt").exists());
        assert!(git.status().unwrap().staged.is_empty());

        git.discard_paths(&["neuf/c.txt".to_string()]).unwrap();
        assert!(!dir.join("neuf/c.txt").exists());
        // Le dossier n'est pas vide — il garde l'ignoré — donc il reste.
        assert_eq!(
            fs::read_to_string(dir.join("neuf/build/out.bin")).unwrap(),
            "ignoré\n"
        );
        assert!(git.status().unwrap().untracked.is_empty());

        // Un chemin qui n'existe nulle part : rien à abandonner, pas d'erreur.
        git.discard_paths(&["nulle-part.txt".to_string()]).unwrap();

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn discard_paths_takes_a_directory_worth_of_files_in_one_go() {
        let (dir, git) = temp_repo();
        fs::create_dir_all(dir.join("src")).unwrap();
        fs::write(dir.join("src/a.txt"), "origine\n").unwrap();
        fs::write(dir.join("autre.txt"), "origine\n").unwrap();
        git.stage_all().unwrap();
        git.commit("initial", None, false).unwrap();

        // Sous `src` : un suivi modifié, un neuf indexé, un non suivi. À côté :
        // un suivi modifié qui ne fait pas partie du lot.
        fs::write(dir.join("src/a.txt"), "modifié\n").unwrap();
        fs::write(dir.join("src/b.txt"), "indexé\n").unwrap();
        git.stage("src/b.txt").unwrap();
        fs::write(dir.join("src/c.txt"), "neuf\n").unwrap();
        fs::write(dir.join("autre.txt"), "modifié\n").unwrap();

        git.discard_paths(&[
            "src/a.txt".to_string(),
            "src/b.txt".to_string(),
            "src/c.txt".to_string(),
        ])
        .unwrap();

        assert_eq!(fs::read_to_string(dir.join("src/a.txt")).unwrap(), "origine\n");
        assert!(!dir.join("src/b.txt").exists());
        assert!(!dir.join("src/c.txt").exists());
        let st = git.status().unwrap();
        assert!(st.staged.is_empty() && st.untracked.is_empty());
        assert_eq!(st.unstaged.len(), 1);
        assert_eq!(st.unstaged[0].path, "autre.txt");

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn discard_paths_on_an_unborn_head_deletes_the_file() {
        let (dir, git) = temp_repo();
        // Aucun commit : même indexé, le fichier n'a nulle part où revenir.
        fs::write(dir.join("a.txt"), "1\n").unwrap();
        git.stage("a.txt").unwrap();

        git.discard_paths(&["a.txt".to_string()]).unwrap();

        assert!(!dir.join("a.txt").exists());
        let st = git.status().unwrap();
        assert!(st.staged.is_empty() && st.untracked.is_empty());

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn discard_all_on_an_unborn_head_empties_index_and_worktree() {
        let (dir, git) = temp_repo();
        // Aucun commit : il n'y a pas d'arbre où revenir, tout est à effacer.
        fs::write(dir.join("a.txt"), "1\n").unwrap();
        git.stage("a.txt").unwrap();
        fs::write(dir.join("b.txt"), "2\n").unwrap();

        git.discard_all().unwrap();

        let st = git.status().unwrap();
        assert!(st.staged.is_empty() && st.unstaged.is_empty() && st.untracked.is_empty());
        assert!(!dir.join("a.txt").exists());
        assert!(!dir.join("b.txt").exists());

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn discard_all_closes_a_merge_in_progress() {
        let (origin_dir, local_dir, origin, local, _) = repo_tracking_remote();
        commit_file(&origin_dir, &origin, "a.txt", "distant\n", "c2 distant");
        commit_file(&local_dir, &local, "a.txt", "local\n", "c2 local");
        let before = local.info().unwrap().head;

        local.pull(PullMode::FastForwardOrMerge).unwrap();
        assert!(local.info().unwrap().merging);

        // Abandonner les changements abandonne aussi la fusion : sans cela, le
        // commit suivant naîtrait avec deux parents sur des conflits disparus.
        local.discard_all().unwrap();
        let info = local.info().unwrap();
        assert!(!info.merging);
        assert_eq!(info.head, before);
        assert_eq!(
            fs::read_to_string(local_dir.join("a.txt")).unwrap(),
            "local\n"
        );
        assert!(local.status().unwrap().unstaged.is_empty());

        fs::remove_dir_all(&origin_dir).ok();
        fs::remove_dir_all(&local_dir).ok();
    }

    #[test]
    fn push_publishes_the_branch_and_sets_its_upstream_once() {
        let (origin_dir, local_dir, git) = repo_with_bare_remote();
        fs::write(local_dir.join("a.txt"), "1\n").unwrap();
        git.stage("a.txt").unwrap();
        git.commit("c1", None, false).unwrap();
        let branch = git.info().unwrap().branch.unwrap();

        // Premier push : la branche n'a pas d'amont, il est posé au passage.
        let report = git.push(None, PushMode::Normal).unwrap();
        assert_eq!(report.remote, "origin");
        assert_eq!(report.branch, branch);
        assert!(report.upstream_set, "le premier push pose le suivi");

        // Le distant a la référence, et le local ne montre plus d'écart.
        let origin = Repository::open(&origin_dir).unwrap();
        assert!(origin
            .find_reference(&format!("refs/heads/{branch}"))
            .is_ok());
        let gap = |git: &Libgit2Backend| {
            git.local_branches()
                .unwrap()
                .into_iter()
                .find(|b| b.name == branch)
                .unwrap()
                .upstream
                .expect("la branche suit le distant après un push")
        };
        let up = gap(&git);
        assert_eq!(up.name, format!("origin/{branch}"));
        assert_eq!((up.ahead, up.behind), (0, 0));

        // Second push : l'amont existe déjà, il n'est pas reposé.
        fs::write(local_dir.join("a.txt"), "2\n").unwrap();
        git.stage("a.txt").unwrap();
        git.commit("c2", None, false).unwrap();
        assert_eq!(gap(&git).ahead, 1);

        let report = git.push(None, PushMode::Normal).unwrap();
        assert!(!report.upstream_set);
        assert_eq!(gap(&git).ahead, 0);

        fs::remove_dir_all(&origin_dir).ok();
        fs::remove_dir_all(&local_dir).ok();
    }

    /// Fait avancer la branche du distant sans que le local en sache rien —
    /// exactement ce qu'un collègue qui pousse produit chez nous.
    fn advance_remote(origin_dir: &PathBuf, branch: &str) -> Oid {
        let origin = Repository::open(origin_dir).unwrap();
        let tip = origin
            .find_reference(&format!("refs/heads/{branch}"))
            .unwrap()
            .peel_to_commit()
            .unwrap();
        let sig = git2::Signature::now("Autre", "autre@example.com").unwrap();
        let ahead = origin
            .commit(None, &sig, &sig, "c2 ailleurs", &tip.tree().unwrap(), &[&tip])
            .unwrap();
        origin
            .reference(&format!("refs/heads/{branch}"), ahead, true, "test")
            .unwrap();
        ahead
    }

    /// Où la branche du distant pointe à cet instant.
    fn remote_tip(origin_dir: &PathBuf, branch: &str) -> Oid {
        Repository::open(origin_dir)
            .unwrap()
            .find_reference(&format!("refs/heads/{branch}"))
            .unwrap()
            .target()
            .unwrap()
    }

    #[test]
    fn force_push_rewrites_the_remote_branch() {
        let (origin_dir, local_dir, git) = repo_with_bare_remote();
        fs::write(local_dir.join("a.txt"), "1\n").unwrap();
        git.stage("a.txt").unwrap();
        git.commit("c1", None, false).unwrap();
        let branch = git.info().unwrap().branch.unwrap();
        git.push(None, PushMode::Normal).unwrap();

        // Le distant part de son côté, et le local du sien : un push ordinaire
        // est refusé (c'est le test voisin), le force passe outre.
        let ahead = advance_remote(&origin_dir, &branch);
        fs::write(local_dir.join("a.txt"), "2\n").unwrap();
        git.stage("a.txt").unwrap();
        let local_tip = git.commit("c2 local", None, false).unwrap();

        let report = git.push(None, PushMode::Force).unwrap();
        assert!(report.forced, "le compte rendu doit dire que c'est une réécriture");

        // La branche distante porte notre commit, et plus le sien.
        let after = remote_tip(&origin_dir, &branch);
        assert_eq!(after.to_string(), local_tip.oid);
        assert_ne!(after, ahead);

        fs::remove_dir_all(&origin_dir).ok();
        fs::remove_dir_all(&local_dir).ok();
    }

    #[test]
    fn force_with_lease_refuses_when_the_remote_moved_behind_our_back() {
        let (origin_dir, local_dir, git) = repo_with_bare_remote();
        fs::write(local_dir.join("a.txt"), "1\n").unwrap();
        git.stage("a.txt").unwrap();
        git.commit("c1", None, false).unwrap();
        let branch = git.info().unwrap().branch.unwrap();
        git.push(None, PushMode::Normal).unwrap();

        // Le distant bouge sans que nous fetchions : notre référence de suivi
        // parle encore de c1, le serveur non. C'est le cas que le bail existe
        // pour attraper.
        let ahead = advance_remote(&origin_dir, &branch);
        fs::write(local_dir.join("a.txt"), "2\n").unwrap();
        git.stage("a.txt").unwrap();
        git.commit("c2 local", None, false).unwrap();

        let err = git.push(None, PushMode::ForceWithLease).unwrap_err();
        match &err {
            AppError::PushLeaseStale(actual) => {
                assert!(
                    ahead.to_string().starts_with(actual),
                    "le message doit nommer là où le distant se trouve : {actual}"
                );
            }
            other => panic!("un bail rompu doit être explicite : {other:?}"),
        }

        // Et surtout : rien n'a été envoyé, le commit d'en face est intact.
        assert_eq!(remote_tip(&origin_dir, &branch), ahead);

        fs::remove_dir_all(&origin_dir).ok();
        fs::remove_dir_all(&local_dir).ok();
    }

    #[test]
    fn force_with_lease_rewrites_when_the_remote_is_where_we_left_it() {
        let (origin_dir, local_dir, git) = repo_with_bare_remote();
        fs::write(local_dir.join("a.txt"), "1\n").unwrap();
        git.stage("a.txt").unwrap();
        git.commit("c1", None, false).unwrap();
        let branch = git.info().unwrap().branch.unwrap();
        git.push(None, PushMode::Normal).unwrap();
        let pushed = remote_tip(&origin_dir, &branch);

        // Personne n'a touché au distant ; c'est notre historique qu'on réécrit —
        // le cas d'un amend ou d'un rebase à republier.
        let amended = git.commit("c1 corrigé", None, true).unwrap();
        assert_ne!(amended.oid, pushed.to_string());

        let report = git.push(None, PushMode::ForceWithLease).unwrap();
        assert!(report.forced);
        assert_eq!(remote_tip(&origin_dir, &branch).to_string(), amended.oid);

        fs::remove_dir_all(&origin_dir).ok();
        fs::remove_dir_all(&local_dir).ok();
    }

    #[test]
    fn push_is_rejected_when_the_remote_moved_ahead() {
        let (origin_dir, local_dir, git) = repo_with_bare_remote();
        fs::write(local_dir.join("a.txt"), "1\n").unwrap();
        git.stage("a.txt").unwrap();
        git.commit("c1", None, false).unwrap();
        let branch = git.info().unwrap().branch.unwrap();
        git.push(None, PushMode::Normal).unwrap();

        // Quelqu'un d'autre a poussé entre-temps : le distant a un commit que le
        // local n'a pas.
        let origin = Repository::open(&origin_dir).unwrap();
        let tip = origin
            .find_reference(&format!("refs/heads/{branch}"))
            .unwrap()
            .peel_to_commit()
            .unwrap();
        let sig = git2::Signature::now("Autre", "autre@example.com").unwrap();
        let ahead = origin
            .commit(None, &sig, &sig, "c2 ailleurs", &tip.tree().unwrap(), &[&tip])
            .unwrap();
        origin
            .reference(&format!("refs/heads/{branch}"), ahead, true, "test")
            .unwrap();

        // Repousser écraserait ce commit : refusé, et sans force pour insister.
        fs::write(local_dir.join("a.txt"), "2\n").unwrap();
        git.stage("a.txt").unwrap();
        git.commit("c2 local", None, false).unwrap();
        let err = git.push(None, PushMode::Normal).unwrap_err();
        assert!(
            matches!(err, AppError::PushRejected(_)),
            "un rejet doit être explicite, pas une erreur générique : {err:?}"
        );

        // Le distant n'a pas bougé.
        let origin = Repository::open(&origin_dir).unwrap();
        let after = origin
            .find_reference(&format!("refs/heads/{branch}"))
            .unwrap()
            .target()
            .unwrap();
        assert_eq!(after, ahead);

        fs::remove_dir_all(&origin_dir).ok();
        fs::remove_dir_all(&local_dir).ok();
    }

    #[test]
    fn fetch_reports_updated_refs_then_nothing() {
        let (origin_dir, local_dir, git) = repo_with_remote();

        // Premier fetch : la branche distante apparaît (pas d'ancien OID).
        let report = git.fetch(None).unwrap();
        assert_eq!(report.remote, "origin");
        assert_eq!(report.updated.len(), 1);
        assert!(report.updated[0].name.starts_with("refs/remotes/origin/"));
        assert!(report.updated[0].old_oid.is_none());

        // Second fetch sans mouvement en face : rien n'est signalé.
        let report = git.fetch(None).unwrap();
        assert!(report.updated.is_empty());

        fs::remove_dir_all(&origin_dir).ok();
        fs::remove_dir_all(&local_dir).ok();
    }

    #[test]
    fn fetch_reports_moved_ref_with_previous_oid() {
        let (origin_dir, local_dir, git) = repo_with_remote();
        git.fetch(None).unwrap();

        // Le distant avance d'un commit.
        let origin = Libgit2Backend::open(&origin_dir).unwrap();
        fs::write(origin_dir.join("a.txt"), "origine 2\n").unwrap();
        origin.stage("a.txt").unwrap();
        origin.commit("second commit distant", None, false).unwrap();

        let report = git.fetch(None).unwrap();
        assert_eq!(report.updated.len(), 1);
        // La référence existait déjà : son OID précédent est renseigné.
        let moved = &report.updated[0];
        assert!(moved.old_oid.is_some());
        assert_ne!(moved.old_oid.as_deref(), Some(moved.new_oid.as_str()));

        fs::remove_dir_all(&origin_dir).ok();
        fs::remove_dir_all(&local_dir).ok();
    }

    #[test]
    fn fetch_without_remote_fails_cleanly() {
        let (dir, git) = temp_repo();
        assert!(matches!(git.fetch(None), Err(AppError::NoRemote)));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn ssh_keys_are_walked_in_preference_order_skipping_absent_ones() {
        let dir = unique_dir("ssh");
        fs::create_dir_all(&dir).unwrap();
        // id_ecdsa volontairement absent : l'index doit l'enjamber.
        fs::write(dir.join("id_rsa"), "x").unwrap();
        fs::write(dir.join("id_ed25519"), "x").unwrap();

        assert_eq!(nth_ssh_key_in(&dir, 0), Some(dir.join("id_ed25519")));
        assert_eq!(nth_ssh_key_in(&dir, 1), Some(dir.join("id_rsa")));
        assert_eq!(nth_ssh_key_in(&dir, 2), None);

        // Aucun candidat : le callback doit conclure « rien à proposer ».
        let empty = unique_dir("ssh-vide");
        fs::create_dir_all(&empty).unwrap();
        assert_eq!(nth_ssh_key_in(&empty, 0), None);

        fs::remove_dir_all(&dir).ok();
        fs::remove_dir_all(&empty).ok();
    }

    #[test]
    fn credentials_without_any_key_reports_nothing_to_offer() {
        let state = Cell::new(CredState::Untouched);
        // Aucune méthode acceptée par le serveur : rien ne peut être proposé.
        let out = credentials("", None, CredentialType::empty(), 1, &state);
        assert!(out.is_err());
        assert!(state.get() == CredState::NothingToOffer);
    }

    #[test]
    fn credentials_give_up_after_the_attempt_cap() {
        let state = Cell::new(CredState::Untouched);
        let out = credentials("", None, CredentialType::USER_PASS_PLAINTEXT, MAX_CRED_ATTEMPTS + 1, &state);
        assert!(out.is_err());
        // Plafond atteint = tout ce qui a été proposé a été refusé.
        assert!(state.get() == CredState::Refused);
    }

    #[test]
    fn identity_is_written_locally_then_cleared() {
        let (dir, git) = temp_repo();

        git.set_identity("Profil Test", "profil@example.com").unwrap();
        let id = git.identity().unwrap();
        assert_eq!(id.name.as_deref(), Some("Profil Test"));
        assert_eq!(id.email.as_deref(), Some("profil@example.com"));
        assert!(id.is_local);

        // Écrit bien dans le dépôt, donc visible par n'importe quel outil Git.
        let local = Repository::open(&dir)
            .unwrap()
            .config()
            .unwrap()
            .open_level(ConfigLevel::Local)
            .unwrap();
        assert_eq!(local.get_string("user.email").unwrap(), "profil@example.com");

        // Après retrait, l'identité n'est plus propre au dépôt : ce qui subsiste
        // vient de la config globale de la machine, dont on ne présume rien.
        git.clear_identity().unwrap();
        assert!(!git.identity().unwrap().is_local);

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn fetch_unreachable_remote_is_a_network_error() {
        let (dir, git) = temp_repo();
        let repo = Repository::open(&dir).unwrap();
        // Port fermé sur la boucle locale : refus immédiat, pas d'attente réseau.
        repo.remote("origin", "https://127.0.0.1:1/x.git").unwrap();

        // libgit2 classe ce refus en `Os`/`GenericError`, pas en `Net` : sans
        // cette prise en compte l'erreur remontait au frontend en `Git`.
        assert!(matches!(git.fetch(None), Err(AppError::Network(_))));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn fetch_on_unknown_remote_fails_cleanly() {
        let (origin_dir, local_dir, git) = repo_with_remote();
        assert!(matches!(git.fetch(Some("amont")), Err(AppError::NoRemote)));
        fs::remove_dir_all(&origin_dir).ok();
        fs::remove_dir_all(&local_dir).ok();
    }

    // ── Fusion de branche à branche ─────────────────────────────────────────

    /// Le mode par défaut du menu, écrit une fois pour ne pas alourdir chaque appel.
    const FF_OR_MERGE: MergeMode = MergeMode::FastForwardOrMerge;

    /// Crée une branche locale sur le commit de HEAD, sans y basculer — il n'y a
    /// pas de création de branche dans le backend, et ces tests n'en demandent pas.
    fn branch_at_head(dir: &Path, name: &str) {
        let repo = Repository::open(dir).unwrap();
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        repo.branch(name, &head, false).unwrap();
    }

    /// Dépôt d'un commit, avec une branche `vieille` restée dessus et un second
    /// commit sur la branche courante. La cible est donc en retard d'un commit.
    fn repo_with_a_lagging_branch() -> (PathBuf, Libgit2Backend, String) {
        let (dir, git) = temp_repo();
        commit_file(&dir, &git, "a.txt", "1\n", "c1");
        branch_at_head(&dir, "vieille");
        commit_file(&dir, &git, "a.txt", "2\n", "c2");
        let current = git.info().unwrap().branch.unwrap();
        (dir, git, current)
    }

    #[test]
    fn merge_fast_forwards_the_target_without_moving_head() {
        let (dir, git, current) = repo_with_a_lagging_branch();
        let head_before = git.info().unwrap().head.clone();

        let report = git.merge_branches(&current, "vieille", FF_OR_MERGE).unwrap();
        assert!(matches!(
            report.outcome,
            MergeOutcome::FastForwarded { commits: 1 }
        ));
        // Toute la raison de distinguer ce cas : la cible n'étant pas la branche
        // courante, il n'y a qu'une référence à déplacer.
        assert!(!report.switched);
        assert_eq!(git.info().unwrap().branch.as_deref(), Some(current.as_str()));
        assert_eq!(git.info().unwrap().head, head_before);
        assert_eq!(fs::read_to_string(dir.join("a.txt")).unwrap(), "2\n");

        // La cible pointe bien sur le commit de la source.
        let branches = git.local_branches().unwrap();
        let target = branches.iter().find(|b| b.name == "vieille").unwrap();
        let source = branches.iter().find(|b| b.name == current).unwrap();
        assert_eq!(target.oid, source.oid);

        // Et rien à refaire : la cible contient désormais la source.
        assert!(matches!(
            git.merge_branches(&current, "vieille", FF_OR_MERGE).unwrap().outcome,
            MergeOutcome::UpToDate
        ));

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn merge_without_fast_forward_always_writes_a_commit() {
        let (dir, git, current) = repo_with_a_lagging_branch();

        // Le cas où l'avance rapide serait possible : c'est là que le mode change
        // tout. La cible doit être checkoutée, un commit ne s'écrivant que sur HEAD.
        let report = git
            .merge_branches(&current, "vieille", MergeMode::NoFastForward)
            .unwrap();
        assert!(matches!(report.outcome, MergeOutcome::Merged { commits: 1 }));
        assert!(report.switched);
        assert_eq!(git.info().unwrap().branch.as_deref(), Some("vieille"));

        // Deux parents, et le contenu de la source : c'est bien `--no-ff`.
        let repo = Repository::open(&dir).unwrap();
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(head.parent_count(), 2);
        assert_eq!(fs::read_to_string(dir.join("a.txt")).unwrap(), "2\n");

        // Rien de neuf à verser : le mode ne fabrique pas un commit pour rien.
        assert!(matches!(
            git.merge_branches(&current, "vieille", MergeMode::NoFastForward)
                .unwrap()
                .outcome,
            MergeOutcome::UpToDate
        ));

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn merge_is_up_to_date_when_the_target_already_contains_the_source() {
        let (dir, git, current) = repo_with_a_lagging_branch();
        let head_before = git.info().unwrap().head.clone();

        // Sens inverse : la branche courante contient déjà la vieille.
        let report = git.merge_branches("vieille", &current, FF_OR_MERGE).unwrap();
        assert!(matches!(report.outcome, MergeOutcome::UpToDate));
        assert!(!report.switched);
        assert_eq!(git.info().unwrap().head, head_before);

        fs::remove_dir_all(&dir).ok();
    }

    /// Dépôt divergent : la branche courante et `autre` portent chacune un commit
    /// que l'autre n'a pas, sur un fichier au choix de l'appelant.
    fn diverged_repo(other_file: &str) -> (PathBuf, Libgit2Backend, String) {
        let (dir, git) = temp_repo();
        commit_file(&dir, &git, "a.txt", "1\n", "c1");
        branch_at_head(&dir, "autre");
        git.checkout_branch("autre").unwrap();
        commit_file(&dir, &git, other_file, "autre\n", "c2 autre");
        let (dir, git, current) = {
            // Retour sur la branche de départ, quel que soit son nom.
            let repo = Repository::open(&dir).unwrap();
            let default = repo
                .branches(Some(BranchType::Local))
                .unwrap()
                .flatten()
                .map(|(b, _)| b.name().unwrap().unwrap().to_string())
                .find(|n| n != "autre")
                .unwrap();
            drop(repo);
            git.checkout_branch(&default).unwrap();
            (dir, git, default)
        };
        commit_file(&dir, &git, "b.txt", "courant\n", "c2 courant");
        (dir, git, current)
    }

    #[test]
    fn merge_switches_to_the_target_and_commits_two_parents() {
        let (dir, git, current) = diverged_repo("c.txt");

        // La courante est fusionnée **dans** `autre` : c'est le sens du geste.
        let report = git.merge_branches(&current, "autre", FF_OR_MERGE).unwrap();
        assert!(matches!(report.outcome, MergeOutcome::Merged { commits: 1 }));
        // Une vraie fusion doit passer par la cible : HEAD y est resté.
        assert!(report.switched);
        assert_eq!(git.info().unwrap().branch.as_deref(), Some("autre"));
        assert!(!git.info().unwrap().merging);

        // Les deux côtés sont là, et le commit porte bien deux parents.
        assert!(dir.join("b.txt").exists() && dir.join("c.txt").exists());
        let repo = Repository::open(&dir).unwrap();
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(head.parent_count(), 2);

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn merge_leaves_the_conflicts_on_the_target() {
        // Les deux côtés touchent `b.txt` : la fusion ne peut pas trancher.
        let (dir, git, current) = diverged_repo("b.txt");

        let report = git.merge_branches(&current, "autre", FF_OR_MERGE).unwrap();
        let files = match report.outcome {
            MergeOutcome::Conflicted { files } => files,
            other => panic!("attendu un conflit, obtenu {other:?}"),
        };
        assert_eq!(files, ["b.txt"]);
        // On reste sur la cible, en fusion : c'est là que le conflit se résout.
        assert!(report.switched);
        assert_eq!(git.info().unwrap().branch.as_deref(), Some("autre"));
        assert!(git.info().unwrap().merging);

        // Une seconde fusion par-dessus écraserait `MERGE_HEAD` : refusée.
        assert!(matches!(
            git.merge_branches(&current, "autre", FF_OR_MERGE),
            Err(AppError::MergeInProgress)
        ));

        // Sortie de secours, comme après un pull qui a conflité.
        git.abort_merge().unwrap();
        assert!(!git.info().unwrap().merging);

        fs::remove_dir_all(&dir).ok();
    }

    /// Le filtre qui décide si un événement du disque atteint l'interface : sans
    /// lui, une compilation dans le dépôt la noierait de rafraîchissements.
    #[test]
    fn filter_ignored_drops_what_the_repository_ignores() {
        let (dir, git) = temp_repo();
        fs::write(dir.join(".gitignore"), "target/\n*.log\n").unwrap();
        fs::create_dir_all(dir.join("target/debug")).unwrap();
        fs::create_dir_all(dir.join("src")).unwrap();

        // La racine vient du backend, comme dans le watcher : sur macOS le
        // dossier temporaire n'est pas le chemin canonique.
        let workdir = git.watch_roots().unwrap().workdir.unwrap();
        let kept = git.filter_ignored(vec![
            workdir.join("src/main.rs"),
            workdir.join("target/debug/build.o"),
            workdir.join("bruit.log"),
            // Hors du dépôt : ne le concerne pas.
            PathBuf::from("/ailleurs/fichier.txt"),
        ]);

        assert_eq!(kept, vec![workdir.join("src/main.rs")]);
        fs::remove_dir_all(&dir).ok();
    }
}
