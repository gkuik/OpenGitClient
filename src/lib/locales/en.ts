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
  "action.done": "Done",
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
  "tabbar.busy": "A remote operation is running in this repository",
  "tabbar.unseen.ok": "A remote operation finished while you were away",
  "tabbar.unseen.neutral": "A remote operation finished while you were away",
  "tabbar.unseen.warn": "A remote operation finished while you were away, and needs a look",
  "tabbar.unseen.danger": "A remote operation failed while you were away",

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
  // Menu contextuel d'une ligne — fichier ou dossier, une seule entrée.
  "status.file.menu.discard": "Discard changes",
  "status.file.menu.discard.confirm": "Confirm: discard changes",

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
  // Nom d'un stash lancé depuis la barre du dépôt sans nom saisi : celui de Git.
  "stash.default": "WIP on {branch}",

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
  "graph.col.refs": "Branch / Tag",
  "graph.col.graph": "Graph",
  "graph.col.message": "Commit message",
  "graph.col.author": "Author",
  "graph.col.date": "Date",
  "graph.col.sha": "SHA",
  "graph.col.move": "Drag to move the column",
  "graph.col.resize": "Drag to resize — double-click to restore the default width",
  "graph.columns": "Columns",
  "graph.columns.hint": "Show or hide columns",
  "graph.columns.reset": "Reset columns",
  // Menu contextuel d'une rangée du graph — une seule entrée.
  "graph.menu.createBranch": "Create branch here…",
  "graph.menu.createTag": "Create tag here…",

  // ── Diff ──────────────────────────────────────────────────────────────────
  "diff.pick": "Select a file to show its diff.",
  "diff.close": "Close the view",
  "diff.loading": "Loading the diff…",
  "diff.binary": "Binary file — no diff to show.",
  "diff.empty": "No difference to show.",
  // Bascule Code | Preview, offerte sur un Markdown seulement.
  "diff.view.code": "Code",
  "diff.view.code.hint": "Show the diff",
  "diff.view.preview": "Preview",
  "diff.view.preview.hint": "Render the Markdown as it reads",
  "diff.preview.loading": "Loading the file…",
  "diff.preview.binary": "Binary file — nothing to render.",
  "diff.preview.unavailable": "Nothing to render: the file is absent here, or too large for a preview.",
  "diff.tag.staged": "staged",
  "diff.tag.modified": "modified",
  "diff.tag.untracked": "new file",
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
  "toolbar.pull": "Pull",
  "toolbar.pop": "Pop",
  "toolbar.pop.hint": "Apply the latest stash and remove it: {name}",
  "toolbar.pop.nothing": "No stash to pop",
  "toolbar.tag": "Tag",
  "toolbar.tag.hint": "Create a tag on HEAD",
  "toolbar.stageAll": "Stage all",
  "toolbar.stageAll.hint": "Stage every unstaged change",
  "toolbar.stageAll.nothing": "Nothing to stage",
  "toolbar.unstageAll": "Unstage all",
  "toolbar.unstageAll.hint": "Unstage everything",
  "toolbar.unstageAll.nothing": "Nothing to unstage",
  "toolbar.discardAll": "Discard all",
  "toolbar.forge": "GitHub",
  "toolbar.forge.hint": "Open the repository on GitHub, in your browser",
  "toolbar.forge.none": "No GitHub remote for this repository",
  "toolbar.finder": "Finder",
  "toolbar.finder.hint": "Reveal the repository folder in the Finder",
  "toolbar.terminal": "Terminal",
  "toolbar.terminal.hint": "Open a terminal in the repository folder, with {app}",
  "toolbar.terminal.none": "No supported terminal found",
  "toolbar.editor": "Editor",
  "toolbar.editor.hint": "Open the repository folder in {app}",
  "toolbar.editor.none": "No supported editor found",
  "toolbar.external.settings": "Choose another one in Settings › External tools",
  "toolbar.separator": "Separator",
  "toolbar.space": "Space",
  "toolbar.customize": "Customize toolbar…",
  "toolbar.custom.title": "Customize toolbar",
  "toolbar.custom.palette": "Drag your favourite items into the toolbar…",
  "toolbar.custom.default": "… or drag the default set into the toolbar.",
  "toolbar.custom.add.hint": "Drag into the toolbar, or click to add at the end",
  "toolbar.custom.default.hint": "Drag into the toolbar, or click, to restore the default set",
  "toolbar.custom.hint":
    "Drag an item within the toolbar to move it, out of it to remove it. Press Escape or Done when finished.",
  "toolbar.custom.empty": "Drag items here",
  "toolbar.custom.remove.hint": "Drag to move, drag out or press Delete to remove",
  "toolbar.custom.flowOff": "Shown only in repositories where Git Flow is enabled",
  "toolbar.push": "Push",
  "toolbar.push.hint": "Publish the current branch to the remote",
  "toolbar.push.menu": "These rewrite the remote branch",
  "toolbar.push.menu.hint": "Right-click for the force options",
  "toolbar.push.lease": "Force push (with lease)",
  "toolbar.push.lease.hint":
    "Rewrites the remote branch, but only if it is still where the last fetch saw it — nothing is sent if someone pushed in the meantime",
  "toolbar.push.lease.confirm": "Confirm: force push (with lease)",
  "toolbar.push.force": "Force push",
  "toolbar.push.force.hint":
    "Rewrites the remote branch whatever it now holds — commits pushed by someone else are lost, with no way back",
  "toolbar.push.force.confirm": "Confirm: force push",
  // Barre d'upstream, avant le premier push d'une branche. La question est
  // celle de GitKraken, mot pour mot : elle dit « push to *and pull from* »
  // parce que c'est le suivi qui se décide, pas seulement la cible d'un envoi.
  "push.upstream.question": "What remote/branch should \"{branch}\" push to and pull from?",
  "push.upstream.remote": "Remote",
  "push.upstream.name": "Name of the branch on the remote",
  "push.upstream.submit": "Submit",
  "toolbar.branch": "Branch",
  "toolbar.branch.hint": "Create a branch from HEAD and check it out",
  // Barre de création d'une branche, par-dessus la barre du dépôt.
  "branch.create.label": "New branch from {from}",
  "branch.create.name": "Name of the new branch",
  "branch.create.submit": "Create branch",
  "branch.rename.label": "Rename {from} to",
  "branch.rename.submit": "Rename",
  "toolbar.stash": "Stash",
  "toolbar.stash.hint":
    "Stash every change, untracked files included — under the name typed in the Stash tab, or “WIP on <branch>”",
  "toolbar.stash.nothing": "Nothing to stash",
  "toolbar.fetch": "Fetch",
  "toolbar.fetch.hint": "Fetch the refs of the remote",
  "toolbar.status.fetching": "Fetching…",
  "toolbar.status.pushing": "Pushing…",
  "toolbar.status.pulling": "Pulling…",
  "toolbar.status.merging": "Merging…",
  "toolbar.status.pushingTag": "Pushing the tag…",
  "toolbar.status.deletingRemoteBranch": "Deleting the remote branch…",
  "toolbar.status.autoFetching": "Auto-fetching…",
  "toolbar.fetch.auto": { one: "Auto-fetch every minute", other: "Auto-fetch every {n} minutes" },
  "toolbar.fetch.auto.off": "Auto-fetch off",
  "toolbar.fetch.auto.paused": "Auto-fetch paused: the remote asks for credentials — Fetch to enter them",
  "toolbar.fetch.auto.noRemote": "Auto-fetch paused: no remote",
  "toolbar.fetch.last": "Last fetch: {when}",

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
  // Pull, dans le même menu, pour n'importe quelle branche locale.
  "branches.pull.other.hint":
    "Moves this branch forward without checking it out; switches to it only if a merge is needed",
  "branches.pull.busy": "A remote operation is already running",
  "branches.menu.createBranch": "Create branch from here…",
  "branches.menu.checkout": "Checkout",
  "branches.menu.checkout.head": "Already the current branch",
  "branches.menu.push": "Push",
  "branches.menu.push.hint": "Publish {branch} to its upstream — or ask where, on its first push",
  "branches.menu.createTag": "Create tag here…",
  "branches.menu.rename": "Rename…",
  "branches.menu.copy": "Copy branch name",
  "branches.menu.openForge": "Open on GitHub",
  "branches.menu.openForge.none": "Not published: this branch has no upstream",
  "branches.menu.finish.busy": "Not available while another operation runs",
  "branches.menu.delete": "Delete branch",
  "branches.menu.delete.hint": "Delete the local branch. The remote branch, if any, stays.",
  "branches.menu.delete.confirm": "Click again to delete {branch}",
  "branches.menu.delete.force": "{branch} is not merged — click to delete it anyway and lose its commits",
  "branches.menu.delete.force.hint":
    "Neither its upstream nor HEAD contain this branch: its own commits would no longer be reachable",
  "branches.menu.delete.head": "The current branch can't be deleted: switch to another one first",
  "branches.menu.deleteRemote": "Delete on {remote}",
  "branches.menu.deleteRemote.hint":
    "Delete the branch on {remote}, for everyone who fetches from it. A local branch tracking it stays.",
  "branches.menu.deleteRemote.confirm": "Click again to delete {branch} on {remote}",
  "branches.remote.notForge": "This remote is not on GitHub",

  // ── Colonne de gauche : stashes ───────────────────────────────────────────
  "stashes.title": "Stashes",
  "stashes.empty": "No stash.",
  "stashes.actions": "Stash actions",
  "stashes.apply": "Apply",
  "stashes.pop": "Pop (apply and drop)",
  "stashes.drop": "Drop",
  "stashes.drop.confirm": "Confirm the drop",

  // ── Colonne de gauche : tags ──────────────────────────────────────────────
  "tags.title": "Tags",
  "tags.empty": "No tag.",
  "tags.hint":
    "{name} — click to see its commit, double-click to check it out (detached HEAD)",
  "tags.menu.checkout": "Check out (detached HEAD)",
  "tags.menu.push": "Push to the remote",
  "tags.menu.push.hint": "Publishes this tag; refused if the remote holds a different tag of that name",
  "tags.menu.delete": "Delete locally",
  "tags.menu.delete.confirm": "Confirm: delete locally",
  "tags.menu.delete.hint": "Removes the tag from this repository only; the remote keeps it",
  "tags.menu.deleteRemote": "Delete on the remote",
  "tags.menu.deleteRemote.confirm": "Confirm: delete on the remote",
  "tags.menu.deleteRemote.hint":
    "Removes the tag from the remote, for everyone who fetches from it; the local tag stays",
  "tags.menu.busy": "A remote operation is already running",

  // ── Dialogue de création d'un tag ─────────────────────────────────────────
  "tag.dialog.title": "Create a tag",
  "tag.dialog.on": "On {oid} — {summary}",
  "tag.dialog.onOid": "On {oid}",
  "tag.dialog.name": "Name",
  "tag.dialog.message": "Message (optional)",
  "tag.dialog.message.hint":
    "With a message, the tag is annotated: it records who tagged, when and why. Without one, it is a lightweight tag — a plain name on the commit.",
  "tag.dialog.submit": "Create tag",
  "tag.dialog.busy": "Creating…",

  // ── Colonne de gauche : pull requests ─────────────────────────────────────
  "pr.title": "Pull requests",
  "pr.group.mine": "My pull requests",
  "pr.group.assigned": "Assigned to me",
  "pr.group.review": "Awaiting my review",
  "pr.group.others": "Others",
  "pr.empty": "No pull request.",
  "pr.settings": "Open the settings to enter a token",
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
    "No credentials saved for this host. OpenGitClient keeps them in the system keychain and shares them with no other tool.",
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

  // ── Paramètres du dépôt ───────────────────────────────────────────────────
  "repoSettings.open": "Repository settings",
  "repoSettings.open.hint": "Settings of this repository: display name, identity, remotes",
  "repoSettings.open.menu": "Repository settings…",
  "repoSettings.back": "Back to the graph",
  "repoSettings.title": "Repository settings",
  "repoSettings.alias": "Display name",
  "repoSettings.alias.intro":
    "The name shown in the tab, the repository bar and the recent list. Only OpenGitClient knows it: the folder is not renamed. Leave it empty to show the folder's name, {folder}.",
  "repoSettings.alias.reset": "Use the folder's name",
  "repoSettings.identity": "Identity",
  "repoSettings.identity.intro":
    "Who the commits of this repository are signed by. A profile or a custom identity is written into the repository's own {config}, where any Git tool reads it; {global} removes it, and the repository falls back on your global configuration.",
  "repoSettings.identity.aria": "Identity of this repository",
  "repoSettings.identity.current": "Commits are signed {who}",
  "repoSettings.identity.local": "Set in this repository",
  "repoSettings.identity.inherited": "Inherited from the global configuration",
  "repoSettings.identity.none": "No Git identity configured: committing will fail until one is set.",
  "repoSettings.identity.custom": "Custom identity",
  "repoSettings.identity.manage": "Manage profiles…",
  "repoSettings.remotes": "Remotes",
  "repoSettings.remotes.intro":
    "The servers this repository fetches from and pushes to, read from and written to its {config}. Nothing is fetched here: a new remote shows its branches after the next fetch.",
  "repoSettings.remotes.empty": "No remote: this repository is local only.",
  "repoSettings.remotes.name": "Name",
  "repoSettings.remotes.name.placeholder": "origin",
  "repoSettings.remotes.url": "URL",
  "repoSettings.remotes.url.placeholder": "https://github.com/owner/repo.git",
  "repoSettings.remotes.pushUrl": "Pushes go to {url}",
  "repoSettings.remotes.add": "Add a remote",
  "repoSettings.remotes.delete.confirm": "Remove it",
  "repoSettings.remotes.delete.hint":
    "Removes the remote and its remote branches from this repository. Nothing is deleted on the server: adding it back and fetching brings everything back.",

  // ── Git Flow ──────────────────────────────────────────────────────────────
  "flow.menu": "Git Flow",
  "flow.menu.hint": "Start a work branch, or finish the current one",
  "flow.new.feature": "New feature",
  "flow.new.bugfix": "New bugfix",
  "flow.new.release": "New release",
  "flow.new.hotfix": "New hotfix",
  "flow.new.hint.feature": "Create a feature/ branch from {base} and switch to it",
  "flow.new.hint.bugfix": "Create a bugfix/ branch from {base} and switch to it",
  "flow.new.hint.release": "Create a release/ branch from {base} and switch to it",
  "flow.new.hint.hotfix": "Create a hotfix/ branch from {base} and switch to it",
  "flow.finish.feature": "Finish feature",
  "flow.finish.bugfix": "Finish bugfix",
  "flow.finish.release": "Finish release",
  "flow.finish.hotfix": "Finish hotfix",
  "flow.finish.hint": "Merge {branch} into {targets}, then delete it",
  "flow.finish.dirty": "Commit or stash your changes before finishing a branch",
  "flow.start.feature": "New feature from {from}",
  "flow.start.bugfix": "New bugfix from {from}",
  "flow.start.release": "New release from {from}",
  "flow.start.hotfix": "New hotfix from {from}",
  "flow.start.name.feature": "Feature name",
  "flow.start.name.bugfix": "Bugfix name",
  "flow.start.name.release": "Version",
  "flow.start.name.hotfix": "Version",
  "flow.finishBar.label": "Merge {branch} into {targets}, then delete it",
  "flow.finishBar.tag": "Tag",
  "flow.finishBar.tag.hint": "Tag set on {branch} after the merge. Leave it empty for no tag.",
  "flow.finishBar.message": "Tag message (optional)",
  "flow.finishBar.submit": "Finish",
  "flow.finish.running": "Finishing {branch}…",
  "flow.finish.conflict": {
    one: "Conflict while merging into {target}: resolve the file and commit — the finish then resumes on its own.",
    other: "Conflicts while merging into {target}: resolve the {n} files and commit — the finish then resumes on its own.",
  },
  "flow.finish.aborted": "Merge aborted: the finish is cancelled. The branch is still there.",
  "flow.finished.feature": "Feature {branch} finished",
  "flow.finished.bugfix": "Bugfix {branch} finished",
  "flow.finished.release": "Release {branch} finished",
  "flow.finished.hotfix": "Hotfix {branch} finished",
  "flow.noBase": "Branch {branch} exists neither locally nor on a remote",
  "repoSettings.flow": "Git Flow",
  "repoSettings.flow.intro":
    "Branches with a role: {main} for production, {develop} for integration, and work branches started from them — features and bugfixes from the second, releases too, hotfixes from the first. Enabled, the repository bar gets one button per kind of work branch, which turns into its Finish when you are on one, and the graph pins the branches below in fixed columns. This setting is OpenGitClient's only: the git flow command line knows nothing of it.",
  "repoSettings.flow.enable": "Enable Git Flow",
  "repoSettings.flow.main": "Production branch",
  "repoSettings.flow.develop": "Development branch",
  "repoSettings.flow.order": "Graph columns",
  "repoSettings.flow.order.intro":
    "The first one is the leftmost column. A name pins one branch; a name ending with {star} pins a group ({example}). Branches listed nowhere — features first — come after, as before.",
  "repoSettings.flow.order.empty": "No pinned column: the graph is laid out as usual.",
  "repoSettings.flow.order.add": "Branch or group, e.g. stage or release/*",
  "repoSettings.flow.order.up": "Move up — one column further left",
  "repoSettings.flow.order.down": "Move down — one column further right",
  "repoSettings.flow.order.remove": "Remove",
  "repoSettings.flow.order.reset": "Reset columns",

  // ── Redimensionnement des colonnes ────────────────────────────────────────
  "layout.resize.left": "Resize the branches column",
  "layout.resize.right": "Resize the changes column",

  // ── Paramètres ────────────────────────────────────────────────────────────
  "settings.title": "Settings",
  "settings.appearance": "Appearance",
  "settings.appearance.aria": "Interface theme",
  "settings.appearance.intro":
    "The theme applies to the whole application. {system} follows the system appearance and switches with it, even while OpenGitClient is running.",
  "settings.theme.light": "Light",
  "settings.theme.dark": "Dark",
  "settings.theme.system": "System",
  "settings.font": "Text size",
  "settings.font.intro":
    "The body text size, in points — Apple's unit. {default} is the size of the macOS system text, and OpenGitClient's default. The rest of the interface is expressed in proportion: headings, secondary mentions and spacings follow the text.",
  "settings.font.size": "{size} pt",
  "settings.graph": "Graph",
  "settings.graph.intro":
    "How a line is drawn when it changes column — a merge, or a branch leaving and joining another. The default is {rounded}.",
  "settings.graph.aria": "Graph line style",
  "settings.graph.rounded": "Rounded corners",
  "settings.graph.sharp": "Sharp corners",
  "settings.graph.curve": "Curves",
  "settings.graph.diagonal": "Diagonals",
  "settings.graph.roundness": "Roundness",
  "settings.graph.roundness.hint": "Only for rounded corners and curves",
  "settings.graph.roundness.reset": "Reset",
  "settings.graph.roundness.reset.hint": "Back to the default roundness, {n} %",
  "settings.graph.neon": "Neon effect",
  "settings.graph.neon.off": "Off",
  "settings.graph.neon.on": "On",
  "settings.graph.neon.hint": "Lines and dots glow in their own colour",
  "settings.autoFetch": "Auto-fetch",
  "settings.autoFetch.intro":
    "The repository on screen fetches all of its remotes in the background at this interval. Only remote branches and tags move — {nothing}. A remote asking for credentials pauses it until the next Fetch.",
  "settings.autoFetch.intro.nothing": "nothing is pulled, merged or checked out",
  "settings.autoFetch.interval": "Interval",
  "settings.autoFetch.every": { one: "Every minute", other: "Every {n} minutes" },
  "settings.autoFetch.off": "Off",
  "settings.autoFetch.reset": "Reset",
  "settings.autoFetch.reset.hint": "Back to the default, every minute",
  "settings.external": "External tools",
  "settings.external.intro":
    "The applications the repository bar's Terminal and Editor buttons open, on the repository folder. Only the ones installed on this Mac and known to open a folder are listed.",
  "settings.external.editor": "Editor",
  "settings.external.terminal": "Terminal",
  "settings.external.none": "None found",
  "settings.profiles": "Profiles",
  "settings.profiles.intro":
    "A profile is an author identity: a name and an address. Choosing one for a repository writes {name} and {email} into its local configuration — so commits made outside OpenGitClient use it too. The choice is made in the commit box, on the right, or in the repository's settings. {note}, their identity living in their own configuration.",
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
    "One token per host, used for HTTPS repositories. OpenGitClient keeps it in the system keychain and shares it with no other tool. {never}: replacing it means entering a new one. SSH repositories are not listed: they authenticate with a key, through the agent or from {ssh}. A GitHub host is the exception, even cloned over SSH: its token is not used for the transport but to read the pull requests, and it needs the {scope} scope.",
  "settings.tokens.intro.never": "It is never shown again",
  "settings.tokens.empty":
    "No host to configure among the open tabs. Add a host below to prepare a token in advance.",
  "settings.tokens.stored": "Token saved",
  "settings.tokens.none": "No token",
  "settings.tokens.set": "Set",
  "settings.tokens.replace": "Replace",
  "settings.tokens.username": "Username",
  "settings.tokens.secret": "Access token",
  "settings.tokens.create": "Create a token on {host}",
  "settings.tokens.test": "Test",
  "settings.tokens.test.title": "Checks that the server accepts the saved credentials, without sending anything",
  "settings.tokens.test.running": "Testing…",
  "settings.tokens.test.account": "Connected as {login}",
  "settings.tokens.test.scopes": {
    one: "Connected as {login}, but the token lacks the {scopes} scope",
    other: "Connected as {login}, but the token lacks the {scopes} scopes",
  },
  "settings.tokens.test.remote": "The remote {remote} of {repo} accepted the credentials",
  "settings.tokens.test.anonymous":
    "The remote {remote} of {repo} answered without asking for credentials: they were not tested",
  "settings.tokens.create.title":
    "Opens the token creation page in your browser, with the repo and workflow scopes already ticked",
  "settings.tokens.forget": "Forget",
  "settings.tokens.forget.confirm": "Confirm the removal",
  "settings.tokens.addHost": "Add a host",

  // ── Comptes rendus des opérations distantes ───────────────────────────────
  "op.fetch.upToDate": "{where}: already up to date",
  "op.fetch.updated": {
    one: "{where}: {n} ref updated",
    other: "{where}: {n} refs updated",
  },
  "op.autoFetch.updated": {
    one: "Auto-fetch · {where}: {n} ref updated",
    other: "Auto-fetch · {where}: {n} refs updated",
  },
  "op.autoFetch.paused": "Auto-fetch paused: the remote asks for credentials",
  "op.pull.fastForwarded": {
    one: "{where}: {n} commit fetched (fast-forward)",
    other: "{where}: {n} commits fetched (fast-forward)",
  },
  "op.pull.fastForwarded.branch": {
    one: "{where}: {branch} fast-forwarded by {n} commit, without checking it out",
    other: "{where}: {branch} fast-forwarded by {n} commits, without checking it out",
  },
  "op.pull.merged": {
    one: "{where}: {n} commit merged",
    other: "{where}: {n} commits merged",
  },
  "op.pull.merged.switched": {
    one: "{where}: switched to {branch}, {n} commit merged",
    other: "{where}: switched to {branch}, {n} commits merged",
  },
  "op.pull.conflicted": {
    one: "Merge conflict: {n} file to resolve",
    other: "Merge conflict: {n} files to resolve",
  },
  "op.pull.diverged": "Diverged: {ahead} local, {behind} on the other side — merge not requested",
  "op.push.published": "{remote}: {branch} published",
  "op.push.forced": "{remote}: {branch} rewritten (force push)",
  "op.push.published.upstream": "{remote}: {branch} published, upstream set",
  "op.push.published.as": "{remote}: {branch} published as {target}, upstream set",
  "op.stash.saved": "Stashed as “{name}”",
  "op.branch.created": "{branch} created and checked out",
  "op.tag.pushed": "{remote}: tag {tag} published",
  "op.tag.deleted": "{remote}: tag {tag} deleted",
  "op.branch.deleted": "Branch {branch} deleted",
  "op.branch.renamed": "Branch {branch} renamed to {name}",
  "op.copied": "Copied {text}",
  "op.remoteBranch.deleted": "{remote}: branch {branch} deleted",
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
  "error.ForgeUnsupported": "Only GitHub repositories are supported for now",
  "error.DetachedHead": "No current branch (detached HEAD)",
  "error.NoUpstream": "The current branch tracks no remote branch: nothing to pull",
  "error.PushLeaseStale":
    "Force push refused: the remote branch has moved since the last fetch (it is now at {arg}). Fetch and look at what arrived before forcing again.",
  "error.BranchExists": "A branch named {arg} already exists",
  "error.InvalidBranchName": "“{arg}” is not a valid branch name",
  "error.TagExists": "A tag named {arg} already exists",
  "error.InvalidTagName": "“{arg}” is not a valid tag name",
  "error.BranchNotMerged": "Branch {arg} is not merged: deleting it would lose commits",
  "error.BranchCheckedOut": "Branch {arg} is checked out: switch to another branch before deleting it",
  "error.RemoteDeleteRejected": "The remote refused to delete the branch ({arg}). It may be protected.",
  "error.RemoteExists": "A remote named {arg} already exists",
  "error.InvalidRemoteName": "“{arg}” is not a valid remote name",
  "error.RemoteNotFound": "No remote named {arg}",
  "error.EmptyRemoteUrl": "A remote needs a URL",
  "error.TagRejected":
    "Tag push refused by the remote ({arg}). It may already hold a different tag of that name.",
  "error.PushRejected":
    "Push refused: the remote has moved ahead ({arg}). Fetch, then integrate its commits before pushing again.",
};
