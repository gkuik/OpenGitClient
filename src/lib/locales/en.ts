/*
  Catalogue anglais — la langue par défaut, et la **référence** : c'est de cet
  objet que `MessageKey` est déduit, donc une autre langue est un fichier de la
  même forme, typé `Catalog`, où toute clé manquante est une erreur de
  compilation (voir `i18n.svelte.ts`).

  Trois règles tenues ici :

  - **Le vocabulaire Git reste en anglais**, quelle que soit la langue : commit,
    stash, stage, fetch, push, pull, merge, branch, HEAD, upstream,
    fast-forward, diff, pull request. Traduire « stage » en « indexer » avait
    déjà éloigné l'interface de la ligne de commande que l'utilisateur connaît.
  - **Une phrase est une entrée**, jamais des morceaux à recoller : l'ordre des
    mots change d'une langue à l'autre. Ce qui porte une mise en forme au milieu
    d'une phrase passe par `RichText`, qui rend les paramètres en `<strong>` ou
    `<code>` sans découper le texte.
  - **Un pluriel est un objet**, pas un `n > 1 ? "s" : ""` : le choix de la forme
    revient à `Intl.PluralRules`, seul à connaître les catégories d'une langue
    (l'anglais en a deux, le français aussi mais pas au même seuil, le polonais
    quatre).
*/
export const en = {
  // ── Communs ───────────────────────────────────────────────────────────────
  "action.cancel": "Cancel",
  "action.confirm": "Confirm",
  "action.close": "Close",
  "action.save": "Save",
  "action.saving": "Saving…",
  "action.retry": "Retry",
  "action.add": "Add",
  "action.edit": "Edit",
  "action.delete": "Delete",
  "common.loading": "Loading…",
  "common.noRepo": "No repository open.",
  "common.notAvailable": "Not available yet",
  "common.closeMenu": "Close menu",
  "common.recent": "Recent",

  // ── Écran d'accueil ───────────────────────────────────────────────────────
  "welcome.open": "Open a repository…",

  // ── Page « nouvel onglet » ────────────────────────────────────────────────
  "newTab.title": "New tab",
  "newTab.subtitle": "Open, clone or create a repository.",
  "newTab.open.label": "Open a local repository",
  "newTab.open.hint": "Choose a folder that is already versioned",
  "newTab.clone.label": "Clone a repository",
  "newTab.create.label": "Create a repository",
  "newTab.soon": "Coming soon",

  // ── Barre d'onglets ───────────────────────────────────────────────────────
  "tabbar.newTab": "New tab",
  "tabbar.closeTab": "Close tab",
  "tabbar.settings": "Settings",

  // ── Bandeau de fusion ─────────────────────────────────────────────────────
  "merge.banner.title": "Merge in progress.",
  "merge.banner.text":
    "Resolve the conflicting files, stage them, then commit — the commit will carry both branches.",
  "merge.banner.abort": "Abort the merge",
  "merge.banner.confirm": "Confirm abort",

  // ── Colonne de droite : changements en cours ──────────────────────────────
  "status.changes": { one: "{n} change", other: "{n} changes" },
  "status.on": "on",
  "status.detachedHead": "detached HEAD",
  "status.discardAll": "↺ Discard all",
  "status.discardAll.hint": "Discard every pending change",
  "status.discard.title": "Discard all changes?",
  "status.discard.tracked": {
    one: "{n} tracked file will go back to its last committed state.",
    other: "{n} tracked files will go back to their last committed state.",
  },
  "status.discard.untracked": {
    one: "{n} untracked file will be deleted from disk.",
    other: "{n} untracked files will be deleted from disk.",
  },
  "status.discard.warning": "Nothing can be recovered afterwards.",
  "status.sort.asc": "Sorted A→Z",
  "status.sort.desc": "Sorted Z→A",
  "status.sort.toggle": "Reverse the sort order",
  "status.view.path": "☰ Path",
  "status.view.tree": "⊟ Tree",
  "status.unstaged": "Unstaged",
  "status.staged": "Staged",
  "status.stageAll": "Stage all",
  "status.unstageAll": "Unstage all",
  "status.file.stage": "Stage",
  "status.file.unstage": "Unstage",

  // ── Boîte de commit ───────────────────────────────────────────────────────
  "commit.tab.commit": "Commit",
  "commit.tab.stash": "Stash",
  "commit.author.aria": "Author profile",
  "commit.author.global": "Global config",
  "commit.author.repository": "Repository identity",
  "commit.author.manage": "Manage profiles…",
  "commit.author.none": "No Git identity configured",
  "commit.summary.placeholder": "Commit summary",
  "commit.body.placeholder": "Description (optional)",
  "commit.needStaged": "Stage files to enable committing.",
  "commit.button": "Commit",
  "commit.button.busy": "Working…",
  "stash.name.placeholder": "Stash name",
  "stash.nothing": "Nothing to stash.",
  "stash.button": "Stash",
  "stash.button.busy": "Working…",

  // ── Colonne de droite : détail d'un commit ────────────────────────────────
  "commitDetails.label": "Commit",
  "commitDetails.close": "Close the commit",
  "commitDetails.loading": "Loading the commit…",
  "commitDetails.files": "Files",
  "commitDetails.noFile": "No file changed.",
  "commitDetails.firstParent": "vs first parent",

  // ── Graph ─────────────────────────────────────────────────────────────────
  "graph.loading": "Loading the history…",
  "graph.empty": "No commit.",
  "graph.wip.summary": "Summary of the next commit",
  "graph.counts.modified": "{n} modified",
  "graph.counts.added": "{n} added",
  "graph.counts.deleted": "{n} deleted",
  "graph.ref.local": "local",

  // ── Diff ──────────────────────────────────────────────────────────────────
  "diff.pick": "Select a file to show its diff.",
  "diff.close": "Close the view",
  "diff.loading": "Loading the diff…",
  "diff.binary": "Binary file — no diff to show.",
  "diff.empty": "No difference to show.",
  "diff.tag.staged": "staged",
  "diff.tag.modified": "modified",
  "diff.tag.commit": "commit {oid}",

  // ── Colonne de gauche : barre d'outils ────────────────────────────────────
  "toolbar.pull.fetchAll": "Fetch every remote",
  "toolbar.pull.fetchAll.hint": "Fetches the refs of every remote, integrating nothing",
  "toolbar.pull.fastForwardOrMerge": "Pull (fast-forward if possible)",
  "toolbar.pull.fastForwardOrMerge.hint": "Fast-forward when it is possible, merge otherwise",
  "toolbar.pull.fastForwardOnly": "Pull (fast-forward only)",
  "toolbar.pull.fastForwardOnly.hint":
    "Only integrates by fast-forward; leaves everything untouched when the branches diverge",
  "toolbar.pull.rebase": "Pull (rebase)",
  "toolbar.pull.rebase.hint": "Not available yet: conflict resolution has to come first",
  "toolbar.pull.menu": "Default action for this button",
  "toolbar.pull.menu.hint": "Right-click to choose what this button does",
  "toolbar.push": "Push",
  "toolbar.push.hint": "Publish the current branch to the remote",
  "toolbar.fetch": "Fetch",
  "toolbar.fetch.hint": "Fetch the refs of the remote",
  "toolbar.status.fetching": "Fetching…",
  "toolbar.status.pushing": "Pushing…",
  "toolbar.status.pulling": "Pulling…",
  "toolbar.status.merging": "Merging…",

  // ── Colonne de gauche : branches ──────────────────────────────────────────
  "branches.local": "Local",
  "branches.remote": "Remote",
  "branches.empty": "No branch.",
  "branches.hint.local":
    "{name} — click to see its last commit, double-click to check it out, drag onto another branch to merge",
  "branches.hint.remote":
    "{name} — click to see its last commit, double-click to check it out (a local tracking branch is created if needed)",
  "branches.gap.ahead": { one: "{n} commit to push", other: "{n} commits to push" },
  "branches.gap.behind": { one: "{n} to fetch", other: "{n} to fetch" },
  "branches.gap.hint": "{gap} — {upstream}, as of the last fetch",

  // ── Colonne de gauche : fusion de branches ────────────────────────────────
  "branches.merge.head":
    "{target} receives the merge; we switch to it as soon as a commit has to be written there.",
  "branches.merge.item": "Merge {source} into {target}",
  "branches.merge.item.hint":
    "Fast-forward when the target is simply behind, merge commit otherwise",
  "branches.merge.noFastForward": "Merge without fast-forward",
  "branches.merge.noFastForward.hint":
    "Always a merge commit, even where a fast-forward would do — the merge stays visible in the history",
  "branches.merge.busy": "An operation is running, or a merge is still to be finished",

  // ── Colonne de gauche : stashes ───────────────────────────────────────────
  "stashes.title": "Stashes",
  "stashes.empty": "No stash.",
  "stashes.actions": "Stash actions",
  "stashes.apply": "Apply",
  "stashes.pop": "Pop (apply and drop)",
  "stashes.drop": "Drop",
  "stashes.drop.confirm": "Confirm the drop",

  // ── Colonne de gauche : pull requests ─────────────────────────────────────
  "pr.title": "Pull requests",
  "pr.group.mine": "My pull requests",
  "pr.group.assigned": "Assigned to me",
  "pr.group.review": "Awaiting my review",
  "pr.group.others": "Others",
  "pr.search": "Search a pull request",
  "pr.filter": "Filter the pull requests",
  "pr.filter.head": "What this section shows",
  "pr.filter.drafts": "Drafts",
  "pr.filter.drafts.hint": "Drafts are already loaded: hiding them asks nothing of the server",
  "pr.filter.closed": "Closed and merged",
  "pr.filter.closed.hint":
    "Closed pull requests are not requested by default: ticking this starts a new load",
  "pr.empty": "No pull request.",
  "pr.noMatch": "No pull request matches.",
  "pr.settings": "Open the settings to enter a token",
  "pr.reload": "Reload the pull requests",
  "pr.reload.repo": "Reload the pull requests of {repo}",
  "pr.actions": "Pull request actions",
  "pr.open": "Open on GitHub",
  "pr.state.open": "open",
  "pr.state.draft": "draft",
  "pr.state.closed": "closed",
  "pr.state.merged": "merged",
  "pr.branchMissing": "{branch}: branch missing locally, run a Fetch",

  // ── Dialogue d'identifiants ───────────────────────────────────────────────
  "credentials.title": "Credentials for {host}",
  "credentials.note":
    "No credentials saved for this host. GitLite keeps them in the system keychain and shares them with no other tool.",
  "credentials.refused":
    "The saved credentials were refused by the server. Enter them again — an access token may have expired.",
  "credentials.username": "Username",
  "credentials.secret": "Password or access token",
  "credentials.submit": "Save and retry",
  "credentials.ssh.refused":
    "SSH key refused by {host}. Check that the public key is registered there.",
  "credentials.ssh.none":
    "No usable SSH key for {host}: load it into ssh-agent, or place it in ~/.ssh (id_ed25519, id_ecdsa, id_rsa).",
  "credentials.none": "No usable credentials for {url}",

  // ── Redimensionnement des colonnes ────────────────────────────────────────
  "layout.resize.left": "Resize the branches column",
  "layout.resize.right": "Resize the changes column",

  // ── Paramètres ────────────────────────────────────────────────────────────
  "settings.title": "Settings",
  "settings.appearance": "Appearance",
  "settings.appearance.aria": "Interface theme",
  "settings.appearance.intro":
    "The theme applies to the whole application. {system} follows the system appearance and switches with it, even while GitLite is running.",
  "settings.theme.light": "Light",
  "settings.theme.dark": "Dark",
  "settings.theme.system": "System",
  "settings.font": "Text size",
  "settings.font.intro":
    "The body text size, in points — Apple's unit. {default} is the size of the macOS system text, and GitLite's default. The rest of the interface is expressed in proportion: headings, secondary mentions and spacings follow the text.",
  "settings.font.size": "{size} pt",
  "settings.profiles": "Profiles",
  "settings.profiles.intro":
    "A profile is an author identity: a name and an address. Choosing one for a repository writes {name} and {email} into its local configuration — so commits made outside GitLite use it too. The choice is made in the commit box, on the right. {note}, their identity living in their own configuration.",
  "settings.profiles.intro.note": "Deleting a profile changes nothing for the repositories using it",
  "settings.profiles.empty": "No profile yet.",
  "settings.profiles.add": "Add a profile",
  "settings.profiles.label": "Label",
  "settings.profiles.label.placeholder": "Personal",
  "settings.profiles.name": "Name",
  "settings.profiles.name.placeholder": "First Last",
  "settings.profiles.email": "Email address",
  "settings.tokens": "Access tokens",
  "settings.tokens.intro":
    "One token per host, used for HTTPS repositories. GitLite keeps it in the system keychain and shares it with no other tool. {never}: replacing it means entering a new one. SSH repositories are not listed: they authenticate with a key, through the agent or from {ssh}. A GitHub host is the exception, even cloned over SSH: its token is not used for the transport but to read the pull requests, and it needs the {scope} scope.",
  "settings.tokens.intro.never": "It is never shown again",
  "settings.tokens.empty":
    "No host to configure among the open tabs. Add a host below to prepare a token in advance.",
  "settings.tokens.stored": "Token saved",
  "settings.tokens.none": "No token",
  "settings.tokens.set": "Set",
  "settings.tokens.replace": "Replace",
  "settings.tokens.username": "Username",
  "settings.tokens.secret": "Access token",
  "settings.tokens.forget": "Forget",
  "settings.tokens.forget.confirm": "Confirm the removal",
  "settings.tokens.addHost": "Add a host",

  // ── Comptes rendus des opérations distantes ───────────────────────────────
  "op.fetch.upToDate": "{where}: already up to date",
  "op.fetch.updated": {
    one: "{where}: {n} ref updated",
    other: "{where}: {n} refs updated",
  },
  "op.pull.fastForwarded": {
    one: "{where}: {n} commit fetched (fast-forward)",
    other: "{where}: {n} commits fetched (fast-forward)",
  },
  "op.pull.merged": {
    one: "{where}: {n} commit merged",
    other: "{where}: {n} commits merged",
  },
  "op.pull.conflicted": {
    one: "Merge conflict: {n} file to resolve",
    other: "Merge conflict: {n} files to resolve",
  },
  "op.pull.diverged": "Diverged: {ahead} local, {behind} on the other side — merge not requested",
  "op.push.published": "{remote}: {branch} published",
  "op.push.published.upstream": "{remote}: {branch} published, upstream set",
  "op.merge.upToDate": "{target} already contains {source}",
  "op.merge.fastForwarded": {
    one: "{source} → {target}: {n} commit (fast-forward)",
    other: "{source} → {target}: {n} commits (fast-forward)",
  },
  "op.merge.merged": {
    one: "{source} merged into {target}: {n} commit",
    other: "{source} merged into {target}: {n} commits",
  },

  // ── Erreurs du backend, retrouvées par leur `kind` ────────────────────────
  //
  // Rust envoie déjà un message anglais ; ces entrées sont ce qui le rend
  // traduisible, `{arg}` reprenant le paramètre que la variante porte. Les
  // `kind` sans entrée ici (Git, Io, Network, CredentialStore) affichent le
  // message du backend tel quel : il *est* le contenu, pas un gabarit.
  "error.NotARepository": "This folder is not a valid Git repository",
  "error.NoRepoOpen": "No repository open",
  "error.NothingToCommit": "Nothing to commit (no staged change)",
  "error.NothingToAmend": "No commit to amend",
  "error.MissingSignature": "Missing Git signature: set user.name and user.email",
  "error.CheckoutConflict": "Cannot switch branch: local changes would be overwritten",
  "error.CommitNotFound": "Commit not found",
  "error.StashConflict": "Cannot apply the stash: it conflicts with local changes",
  "error.NothingToStash": "Nothing to stash (no local change)",
  "error.MergeInProgress":
    "A merge is already in progress: finish it or abort it before starting another one",
  "error.NoRemote": "No remote configured",
  "error.RemoteAuth": "Authentication refused by the remote",
  "error.NoCredentials": "No credentials available for this remote",
  "error.NetworkBusy": "A network operation is already running on this repository",
  "error.ForgeToken": "No access token saved for {arg}",
  "error.ForgeAuth": "Token refused by {arg}: it may have expired, or lack the “repo” scope",
  "error.ForgeNotFound": "Repository {arg} not found: it is private, or the token cannot reach it",
  "error.ForgeUnsupported": "Pull requests are only read from GitHub for now",
  "error.DetachedHead": "No current branch (detached HEAD)",
  "error.NoUpstream": "The current branch tracks no remote branch: nothing to pull",
  "error.PushRejected":
    "Push refused: the remote has moved ahead ({arg}). Fetch, then integrate its commits before pushing again.",
};
