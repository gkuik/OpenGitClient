# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

GitLite — a lightweight desktop Git client (Tauri 2 + Rust backend, Svelte 5 frontend, libgit2 via `git2-rs`).
Goals: low memory footprint and small binary. Implemented so far: open repo → status → diff → stage/unstage → commit → fetch/push/pull (+ recent repos, local and remote branch lists with double-click checkout and ahead/behind counters, commit graph with commit inspection and an uncommitted-changes row at its top).

The window is a tab bar (open repositories) over a three-column layout: branches, local and remote (left) · graph *or* diff (center) · file selector (right). The sidebars deliberately mirror GitKraken's layout.

**The tab bar *is* the topbar** — no logo, no "open repository" button: the tabs, a `+` that sits in the same flow right after the last tab, and a settings gear pinned to the right. The gear lives **outside** `.tabs` (which is `flex: 1` and scrolls), so it stays against the right edge however many tabs are open instead of scrolling away with them. Tabs show the repository name only (no branch — the current branch is already in the status panel header). With no tab open, `WelcomeScreen` takes the whole body and is the only place the recent-repository list is reachable.

On macOS the window uses `titleBarStyle: "Overlay"` + `hiddenTitle` (`tauri.conf.json`), so the tab bar sits **beside the traffic-light buttons**. `TabBar` reserves 92px on the left for them (they span x=20→80), but only when actually running in the native macOS app (`__TAURI_INTERNALS__` + a Macintosh UA) — in a browser those buttons don't exist and the offset would just be a gap.

**Two coupled values, keep them in sync**: `.tabbar.mac { min-height: 49px }` and `trafficLightPosition: { x: 20, y: 26 }`. Neither side is the naive formula, and both were measured on macOS 26 rather than guessed:

- a traffic light is **14×14**, not 12, and `y` is *not* the button's top. tao sets the title-bar container to `14 + y` tall and leaves the button 9px above its **bottom**, so the button's centre lands at **`y − 2`** below the top of the window — y=26 → centre at 24px. (With the old y=18 the container kept its default 32px height, i.e. the buttons never moved at all and sat at 16px.)
- `box-sizing: border-box` puts the 1px bottom border inside the height, so the bar's visual centre is `(H − 1) / 2` — 49px → 24px. The symmetric vertical padding cancels out and doesn't enter the calculation.

Changing one alone visibly off-centres the buttons — that was the bug in the first two versions.

**Tabs are reordered by dragging them**, with pointer events rather than HTML5 drag & drop — no browser-imposed ghost image, no `DataTransfer` to feed for a purely internal move, and pointer capture guarantees the release event even outside the window. The grabbed tab follows the cursor (clamped to the strip's box, so it never leaves the bar) and the tabs it steps over slide aside to open its landing slot.

**Everything is `transform`; the DOM order is untouched until release.** That is what makes the geometry measured on `pointerdown` (each tab's rect, the real gap between two of them, the strip's bounds) valid for the whole drag. Reordering live would move the captured node on every hover and force a re-measure after each swap, with the dragged tab jumping a full tab-width for one frame. The neighbours' shift is exactly `width + gap` of the grabbed tab, so they are already at their post-drop position — on release, `tabs.move()` and clearing the transforms land in the same update and nothing of theirs moves; only the grabbed tab snaps from the cursor into the gap. The transition on `transform` is scoped to `.tabs.reordering` for that reason: left on permanently, every neighbour would replay in reverse the move the new layout just applied.

**The drop index compares the dragged tab's *leading* edge to the neighbours' midpoints** — its left edge when moving left, its right edge when moving right — never its centre. With variable-width tabs a centre comparison leaves slots unreachable: pushed fully against the left clamp, a wide tab's centre still sits right of a narrow first tab's midpoint, so it can never be dropped in front of it (that was a real bug). The midpoints compared are always those of the *original* layout, never the shifted positions — that is what keeps the decision monotonic, so it can't oscillate.

Two details that go together: the drop index is an *insertion* index in the current list (the dragged tab still counted), which is why `move()` shifts it by one when moving rightwards; and a tab activates on `pointerdown`, not on click — the click lands after the reorder, on whichever tab is then under the cursor. `pointerdown` also calls `preventDefault()` (killing WebKit's text-selection and native drag), which costs the automatic focus, hence the explicit `focus()`. The bar as a whole is `user-select: none`, prefixed included.

The bar carries `data-tauri-drag-region="deep"` so any of its background drags the window. **The `deep` value is load-bearing**: with the bare attribute Tauri only drags when the click target *is* the element carrying it, and the empty space right of the `+` belongs to `.tabs` (`flex: 1`), not to `.tabbar` — so grabbing it did nothing. Tabs and `+` keep their clicks for free: walking up from the target, Tauri stops at the first "clickable" element (`<button>`, or anything with `tabindex` / an interactive `role` — each tab has both) and cancels the drag. Double-clicking the background zooms the window, as on a real title bar. **This needs `core:window:allow-start-dragging` in `capabilities/default.json`** — it is *not* part of `core:default`, and without it the attribute is silently inert and the window simply can't be moved (`allow-internal-toggle-maximize`, for the double-click, *is* in `core:default`).

**There are no *view* tabs** (that's separate from the repository tabs above). The centre shows the graph until a file is opened; the diff then replaces it, and the diff's × brings the graph back. The right column is always the file selector for whatever is being looked at: the commit's file list when a commit is selected, otherwise the working-directory changes + commit box. Selecting a commit therefore hides the commit box — deliberate, to give the graph and diff the full width.

**Code comments, UI strings, and commit messages are in French.** Match that when editing.

## Commands

Rust is installed via rustup; in non-interactive shells run `. "$HOME/.cargo/env"` first.

```bash
npm install                # once
npm run tauri dev          # run the app (starts Vite on :1420, then compiles + launches Rust)
npm run check              # svelte-check — type-checks .svelte/.ts (vite build does NOT type-check)
npm run build              # frontend-only production build → dist/
npm run tauri build        # full release bundle
```

Backend (from `src-tauri/`):

```bash
cargo check                # fast validation
cargo test                 # backend tests (real temp repos created under $TMPDIR)
cargo test full_cycle_stage_diff_commit   # single test by name
```

Frontend unit tests (vitest, dev-only dependency — covers `src/lib/graph/layout.ts`):

```bash
npm test
```

Vite is pinned to port 1420 with `strictPort` (Tauri expects it) — a stale dev server on that port makes `npm run dev` fail.

## Architecture

### The Git abstraction is the central extension point

All Git logic sits behind the `GitBackend` trait in `src-tauri/src/git/mod.rs`. Commands never touch `git2` directly. `git::open_repository()` is the single factory — a future CLI (`git` shell-out) fallback becomes a second impl of this trait with no changes to commands or frontend.

**Adding a Git feature touches this full chain** (all must stay in sync):
`git/mod.rs` (trait method) → `git/libgit2.rs` (impl) → `commands.rs` (Tauri command) → `lib.rs` (`generate_handler!` registration) → `src/lib/api.ts` (typed wrapper) → `src/lib/types.ts` (TS mirror of the DTO).

### Backend/frontend contract

- DTOs live in `src-tauri/src/dto.rs` with `#[serde(rename_all = "camelCase")]`; `src/lib/types.ts` is a **hand-maintained mirror** — update both together.
- Every command returns `Result<T, AppError>`. `AppError` (`error.rs`) serializes to `{ kind, message }`; `kind` is a stable discriminant the frontend can branch on. No panics reach the frontend.
- Tauri converts JS camelCase args → Rust snake_case automatically.

### Frontend structure

- `src/lib/api.ts` is the **only** place allowed to call `invoke`. Components never do Git work or call the backend directly.
- `src/lib/stores/repo.svelte.ts` holds **one `RepoStore` instance per open repository** (status/diff/selection/view state), plus `TabsStore` (`export const tabs`) which owns the collection, the active tab, recents and session restore. Every mutating action funnels through the private `run()` helper, which refreshes status and captures errors.
- Frontend is plain Vite + Svelte 5 (runes), **not** SvelteKit — no SSR, no routing.

### Multiple repositories: one tab each

`AppState` holds a `HashMap` of backends, **keyed by the repository's canonical path** — that key *is* the tab id, and it is what `RepoInfo.path` carries. Using the path rather than a generated id means opening an already-open repository can't create a duplicate tab, and the session survives restarts with no id mapping to maintain.

**Every repository-scoped command takes a `repo_id`.** There is deliberately no "current repository" on the backend: two tabs can't fight over it, and a slow response can't be applied to the wrong tab. Adding a command means threading `repo_id` through the usual chain.

Frontend counterpart, and the reason the twelve components that use `repo` were left untouched: `export const repo` is a **`Proxy` onto the active tab**, not a store of its own. Each property access reads `tabs.activeId` first, so switching tabs invalidates everything that reads `repo` for free. Two consequences:

- methods are re-bound to the target tab on access — never cache `repo.someMethod` or destructure `repo`, capture `tabs.active` instead;
- with no tab open, the proxy falls back to an inert `EMPTY_TAB` so components can read `repo.*` without null checks.

Session (open tabs, **their order**, and the active tab) is persisted next to `recent.json` in `session.json` — with `profiles.json` and `prefs.json` (the Pull button's mode, the theme and the text size) rounding out the four state files. Tabs are **not** reopened by Rust at startup: the frontend replays them through `open_repository`, so a repository deleted since last run is silently dropped instead of breaking startup. Display order lives in `AppState.order` (the `HashMap` has none) and `set_tab_order` overwrites it wholesale from the frontend — but defensively: unknown ids are dropped and an open tab missing from the received list is kept at the end, so a stale list can never make a repository vanish from the session.

Tab state stays in memory while the tab is open, so returning to it is instant; only `activate()` re-runs, refreshing status and branches because the working directory may have changed on disk. **`graphScrollTop` lives in the store, not in the DOM** — all tabs share one `GraphView`, so the scroll position has to be saved and restored per tab. `GraphView` guards that restore with a `restoring` flag; do **not** reintroduce `requestAnimationFrame` there, since it is suspended while the window isn't painting and would leave the flag stuck, silently discarding every later scroll.

### Status model: 3 backend categories → 2 UI sections

The backend returns `staged` / `unstaged` / `untracked` separately. The sidebar deliberately merges `unstaged + untracked` into one "Non indexés" section (`repo.unstagedEntries`), matching GitKraken's two-section layout. Staged files are `staged=true`; everything else is `staged=false` — that boolean drives both which diff is requested (HEAD↔index vs index↔worktree) and whether the row's button stages or unstages.

After any refresh, `resyncSelection()` re-locates the selected file, because staging moves it between sections.

### Graph: backend walks, frontend lays out

The backend returns raw commits (`oid`, `parents`, `refs`) — **lane assignment is presentation, so it lives in `src/lib/graph/layout.ts`**, a pure function with vitest coverage. A future CLI backend therefore has nothing to duplicate.

`GraphView.svelte` splits rendering deliberately: **Canvas 2D draws only the lane geometry** (lines + dots), **DOM draws all text** (virtualized rows). That keeps hover/selection CSS, text selection and keyboard focus while avoiding one DOM node per commit. Three consequences that are easy to break:

- `ROW_H` is applied to rows as an **inline style, never in CSS** — it is the only thing aligning the canvas with the DOM. It is `$derived` from `font.rootPx` (26px at the default size) because the row carries text: frozen, it would clip it at the first size above the default. `draw()` reads it, so the canvas redraws itself.
- The canvas is an overlay with `z-index: 3`, i.e. **above** the rows. Row hover/selection backgrounds span the full width including the gutter; a canvas underneath would be masked by them.
- **Ref badges sit in their own column *left* of the lanes** (GitKraken-style), so a commit carrying three branches no longer pushes its summary out of line with the others. Three coupled values: the row's `padding-left` is `REFS_W + gutterW`, the canvas is offset by `REFS_W`, and the badge container is `position: absolute` at `left: 0` — it is out of the row's flow precisely because the padding already reserves its place. `REFS_W` follows the text size and **nothing else** (168px at the default): derived from the mounted rows it would shift while scrolling, derived from the whole history it would jump on every page loaded. Badges are right-aligned against the graph and **shrink** rather than overflow (`flex: 0 1 auto` + ellipsis); past `MAX_REFS` they are replaced by a `+n` chip, since a badge squeezed down to its icons names nothing.

**One badge per branch, not per ref** — `src/lib/graph/refs.ts`, a pure function with vitest coverage, like the lane layout. The backend sends `main`, `origin/main` and the HEAD mark separately; a branch in sync with its remote said the same thing twice. `groupRefs` merges a remote ref into a local one **when both are on the same commit** — which is exactly what "same level" means, since the grouping happens inside one commit. What is left is the name plus two icons: a screen for "here", a cloud for "on the server". A local branch ahead of (or behind) its remote is on another row by construction, so it keeps its own badge and the icons are what tell the two apart. A `✓` marks the current branch, as in the sidebar.

Two details in there: the remote/local match is on the **suffix** (`origin/feat/x` ends with `/feat/x`), longest wins — splitting on the first `/` would break on a remote name containing one, which is the same reason `remote_branches` asks libgit2 for the remote name. And the badges are **sorted** head → local → remote-only: the column is narrow, so that order decides what survives the `+n` cut.

Pagination is `skip`/`limit` over a revwalk rebuilt on every call (a `Revwalk` borrows the `Repository`, which is re-opened per call). The walk pushes `refs/heads/*`, `refs/remotes/*` and HEAD, so a commit reachable only from a remote branch is in the history like any other. Order is stable only while refs don't move, so the frontend reloads from page 0 after commit/checkout/open — and after a fetch that actually moved something — but **not** after stage/unstage, which don't change history.

**The working directory is the graph's first row**, GitKraken-style: a dashed hollow circle, the summary of the commit being written, and the `✎ / + / −` counts, on top of the history. That summary is not a label but **the commit box's own field** — `RepoStore.commitSummary`, edited from either side, showing `// WIP` as a placeholder while it is empty. It is **entirely frontend** — no backend call, no DTO — because everything it needs is already loaded: `repoInfo.head` for the commit it hangs from (detached HEAD included) and `status` for the counts. Those counts go through `countStatuses` — the very function that fills the file tree's per-directory counters — so an untracked file is a `+` in both places instead of being classified twice; `RepoStore.changeCounts` only dedupes the paths first, since a file can be both staged and modified.

It is threaded **through** the lane algorithm rather than drawn beside it: `layoutGraph(commits, wip)` emits the row as a pseudo-commit whose parent is HEAD, so the existing loop reserves HEAD's column from the top, makes the intermediate rows cross it and lands the line on HEAD's dot — with no special case anywhere else. The visible consequence is deliberate: when HEAD's commit is *not* the topmost one, the current branch takes column 0 and the others shift right, which is exactly what the node claims. Drawing the line separately would have meant re-deriving all of that, badly.

Four things that look cosmetic and aren't:

- `GraphRow` is a **discriminated union** (`commit` | `wip`), not a `GraphCommit` with an invented oid. A fake oid would be comparable to a real one — selection, ref badges, scroll-into-view all key on oids.
- The row appears only once `repo.loaded` is true. The status lands before the history does, so without that guard the node would flash alone on startup with its line hanging in the void.
- **The commit draft (`commitSummary` / `commitBody`) lives in the tab**, not in `CommitBox`. Two reasons, and the first one predates this row: the commit box is mounted once for every tab, so a local draft followed the user from one repository to the next. The second is that two fields now edit one value, which therefore belongs to neither. `commit()` reads that draft and clears it on success — the reset can't live in a component that isn't the only editor. In the graph row the field's `keydown` **stops propagating**: the row itself listens for Enter and Space to select itself, and its `preventDefault` would swallow every space typed. Enter and Escape only blur — committing needs staged files and stays on the button.
- **WIP selection has no state of its own**: the row is highlighted when `selectedCommitOid === null`, since that is exactly when the right column shows the working directory. `selectWip()` is `clearCommitSelection()` under another name — one truth, nothing to keep in sync, and no toggle on re-click (deselecting would change nothing but the highlight).

`DiffTarget` in the store is a discriminated union (`worktree` | `commit`): one field for both diff sources so they can't contradict each other. `selectedPath`/`selectedStaged` are derived getters over it, which is why the status-panel components needed no changes. **It also drives the centre column** — `null` → graph, set → diff — so there is no tab state to keep in sync.

Two independent selections, don't conflate them: `diffTarget` (centre) and `selectedCommitOid` (right column). Closing the diff keeps the commit open, so the next file of the same commit is one click away; closing the commit (× or re-click in the graph) also drops a `commit`-kind `diffTarget`, since its file selector would be gone.

`CenterPanel` keeps **both** views mounted and toggles `visibility`, never `display: none`: the graph must keep its scroll position and its measured height across a diff.

### Fetch and push are the commands that don't do their own work

`fetch` and `push` are the only network calls in the codebase, and the only `GitBackend` methods that block on something outside the machine. `commands::fetch_remote` and `commands::push_branch` therefore **reserve the repo, spawn a thread and return immediately** — running either in the command body would run it under the `AppState` mutex, freezing every tab for its duration and forever on a connection that never answers.

The thread **re-opens its own backend from the path** instead of borrowing the one in `AppState`: the tab id *is* the canonical path and `Libgit2Backend` only stores a `PathBuf`, so it never touches shared state during the network call. It releases the reservation (`AppState::begin_network` / `end_network`) **before** emitting, so the frontend can start the next one the moment it hears back.

**One reservation covers both**, and that's not laziness: libgit2 updates the remote-tracking refs after a push too (`git_remote_update_tips`), so a fetch and a push racing on one repo would fight over `refs/remotes/**` exactly as two fetches would. Hence `NetworkBusy` rather than a fetch-specific error.

Each result comes back as an event — `repo://fetched`, `repo://pushed` — not as a return value; `TabsStore` routes it to the tab named by `repoId`, which is not necessarily the visible one. `core:default` already covers `listen` (via `core:event:default`), so no capability was added.

Push adds three things fetch doesn't need:

- **`push_update_reference` is mandatory, not decorative.** A server can refuse one ref (non-fast-forward, protected branch, hook) while `push()` itself returns `Ok`. Without reading that callback, a rejection would be reported as a success. The client-side refusal is a separate path — libgit2 compares the advertised refs before sending anything and returns `ErrorCode::NotFastForward` — and both funnel into `AppError::PushRejected`.
- **An explicit refspec** (`refs/heads/<b>:refs/heads/<b>`), not the remote's configured ones: only the current branch is published, never every head. No leading `+` anywhere — **force is not offered at all**, not even `--force-with-lease`.
- **`push -u` happens after the push, and only if the branch had no upstream.** Setting it earlier would leave a branch tracking a ref that a failed push never created. `PushReport.upstreamSet` reports whether it happened, since `set_upstream` can still fail on its own (that failure doesn't fail the push — the commits *are* published by then).

Two things inside the libgit2 impl that look optional and aren't:

- **Authentication spawns no external process — the app stays standalone.** `Cred::credential_helper` is deliberately *not* used: it runs `git credential-<helper>`, which would make the app depend on an installed Git. Everything goes through libssh2/libgit2, already linked into the binary.
- **SSH tries the agent, then keys on disk** (`SSH_KEY_NAMES`, newest algorithm first, existing files only). The disk fallback is not optional: libgit2 does not read `~/.ssh/config` and does not look for `~/.ssh/id_*` by itself, so agent-only support locks out anyone whose agent isn't loaded — which is the default on macOS. A passphrase-protected key still fails; a background fetch can't prompt.
- **HTTPS credentials are the app's own** (`credentials.rs`). It never reads entries written by another tool — reading Git's osxkeychain item would work but triggers a macOS authorization prompt, because that item's ACL doesn't list us. Ours does, so re-reading is silent. macOS stores them as a generic password under service `GitLite`, keyed by host; other platforms behave as an empty store and say so on save rather than accepting a secret they can't read back.
- **The secret travels one way.** It enters through `set_credentials` and leaves only towards libgit2. No command returns it, `Credentials` derives no `Debug`, and nothing logs it.
- **A missing credential is a UI event, not an error banner.** `NoCredentials` / `RemoteAuth` open `CredentialsDialog` (via `RepoStore.askCredentials`), which needs the host — hence the `get_remote_info` round trip: only the backend knows which remote a fetch would resolve to. Saving re-runs the fetch straight away.
- **The credential callback is capped** (`MAX_CRED_ATTEMPTS`) and `attempts` *walks the candidates* — libgit2 re-invokes the callback after every refusal, so returning the same credential each time would loop until the cap instead of trying the next key.
- **`CredState` separates "nothing to offer" from "everything was refused."** libgit2 reports both as one generic error, but they ask different things of the user (`NoCredentials` vs `RemoteAuth`).
- **The callbacks share their state through `Rc`**, not borrows, for the same reason `Diff::print` is used over `foreach`: they live inside the `FetchOptions` until the end of the function, so the report they fill has to outlive them.

A fetch only writes `refs/remotes/**` and `FETCH_HEAD` — never the worktree, index or current branch. That's what makes it safe to trigger without asking. **Auto-*pull* would not be.** Both the sidebar's REMOTE section and the graph read those refs, so `onFetched` reloads them — `reloadRemoteRefs()`, and only when the report says a ref actually moved. The graph reload is a full reset to page 0: its pagination is only stable while refs hold still.

### Remote branches: listed, walked, and checked out through a tracking branch

`remote_branches()` reads `refs/remotes/**` off the disk — no network, unlike `fetch`, which is the only thing that moves those refs. Three details it settles rather than guesses:

- **`<remote>/HEAD` is dropped.** It's a *symbolic* ref duplicating the remote's default branch; a symbolic reference has no `target()`, which is exactly what filters it out (and broken refs with it).
- **The remote name comes from libgit2** (`branch_remote_name`), not from splitting the branch name: a remote name may contain a `/`. The fallback to the first segment keeps orphaned refs — left behind by a deleted remote — in the list instead of losing them.
- **`RemoteBranchEntry` has no `is_head`**, because HEAD never points at a remote branch. That absence *is* the frontend's discriminant: `BranchRow` renders both sections, and a leaf carrying a `remote` field is the remote flavour — no flag to thread through the recursion.

`buildRemoteTree` groups by that `remote` field, then builds each group's tree from the **full** name and descends under the remote's node. The display drops the prefix while the fold keys keep it, so collapsing `origin/feature` can't also collapse the `feature` group of the LOCAL section — both share `RepoStore.collapsedBranchDirs`.

Remote rows behave like local ones: click selects the tip commit — which lands somewhere real, since the revwalk pushes `refs/remotes/*` and the tip is badged with a dashed outline (`.ref.remote`) — and double-click checks out.

`checkout_remote_branch("origin/feature/x")` is git's DWIM: strip the remote, create the local `feature/x` at the remote tip, set its upstream, switch to it. Three deliberate choices inside:

- **An existing local branch of that name wins**, and is checked out *as it stands* rather than moved onto the remote tip. Fast-forwarding it would be a pull, which this app doesn't do.
- **The worktree is updated before the branch is created.** Reversing the order would leave a half-made branch behind whenever the checkout hits a conflict; libgit2's SAFE strategy makes that a real case, mapped to `CheckoutConflict` by `map_checkout_error` (shared with the local checkout).
- **A failing `set_upstream` is swallowed.** It fails on an orphaned ref (deleted remote, no refspec), and the switch has already happened by then — reporting an error for a checkout that worked would be a lie. The upstream only matters to the pull/push that don't exist yet.

`RepoStore.checkoutRemoteBranch` has no "already on this branch" guard, unlike its local twin: only the backend knows the local name, and re-checking out costs nothing. Both share `runCheckout()`, since what a checkout invalidates doesn't depend on where the branch came from — and `refs/remotes/**` is untouched, so the REMOTE section is not reloaded.

### Pull: fetch, then integrate — and a way back out

`pull(mode)` always fetches first, then reads the upstream *afterwards* — that ordering is the whole point. What follows depends on `merge_analysis`: up-to-date, fast-forward (checkout the target, move the branch ref; HEAD already points at it), or a real merge.

**A divergence and a conflict are outcomes, not errors.** `PullOutcome` is a discriminated union carrying `Diverged { ahead, behind }` and `Conflicted { files }` alongside the successes. Reporting them as `AppError` would throw away the other half of the result: the fetch *did* run and *did* move refs, which still have to be reloaded. Errors stay for what genuinely stopped everything — no upstream, detached HEAD, auth, network, and a dirty worktree (SAFE checkout refuses to overwrite, mapped to `CheckoutConflict`).

**A conflicted merge changes what `commit()` means, and that's the sharp edge.** With `MERGE_HEAD` set, the resolution commit must carry *both* parents and then `cleanup_state()`. Without that, `commit()` would silently write a one-parent commit, drop the link to the merged branch and leave the repository stuck in merge state — a corrupt history reported as success. Hence `merge_heads()` read at the top of `commit()` (before any borrow, since `mergehead_foreach` takes `&mut Repository`), the extra parents, and one more consequence: the "nothing to commit" guard is **skipped** during a merge, since a merge resolved entirely in favour of "ours" legitimately has HEAD's tree.

**`abort_merge` is not a convenience.** The app has no per-hunk conflict UI, so without it a conflicted pull would strand the user inside the application. It force-checks-out HEAD — the one place `force` is right, since that's exactly what abandoning means — and clears the merge state. `RepoInfo.merging` exists to surface it: `MergeBanner` sits above both right-column views, because a merge concerns the repository, not whatever is being looked at.

Reload after a pull is wider than after a fetch: `repoInfo` first (it decides whether the banner shows), then the status (this is where conflicted files appear), then the usual remote-ref reload. It's the only remote operation that writes the worktree and index.

### Ahead/behind is measured against the upstream, and only from the last fetch

`BranchEntry.upstream` carries the branch's upstream name plus `ahead`/`behind`, from one `graph_ahead_behind(local, upstream)` per branch in `local_branches()`.

- **The comparison is against `branch.upstream()`, never a hardcoded `origin/<name>`** — that's what a `push` would actually target, and it's the only version that survives a fork (`upstream/main`), a second remote, or a renamed tracking branch. It's also what the `set_upstream` in `checkout_remote_branch` exists to feed.
- **`upstream` is `Option`, and every missing piece collapses into `None`**: no upstream configured, upstream ref gone with its remote, branch with no commit. The UI draws no badge there, and draws none at zero either — a badge means work pending, never "verified in sync". `↑0` would be a claim the data can't back.
- **Both counters come from one call, so both are shown.** Ahead answers "what would I push"; behind answers "can I fast-forward" — and behind is the half a fetch actually moves.
- **The numbers compare two local refs**, so they're only as fresh as the last fetch. The tooltip says so ("au dernier fetch"); nothing auto-fetches.

That last point is why two reloads that used to be unnecessary now are: `commit()` reloads branches (the current branch just moved a commit ahead — the moment you look at the counter), and `reloadRemoteRefs()` reloads them too (a fetch changes `behind`, and that's *all* it changes locally). Miss either and the badge lies exactly when it matters.

`RepoStore.currentGap` derives the HEAD branch's gap for the toolbar counters; it's `null` on a detached HEAD, where no local branch is HEAD.

### Author profiles are stored, the choice is not

A profile is a reusable identity (label + name + email), persisted in `profiles.json` next to `recent.json` and `session.json`. **Which profile a repository uses is deliberately not recorded**: applying one writes `user.name` / `user.email` into that repository's *local* Git config, and the active profile is re-derived by matching the identity back against the list.

That is what makes the feature honest. `commit()` already signs with `repo.signature()`, which reads the same config, so nothing special happens at commit time; a commit made from the terminal picks up the same identity; and no stored association can drift from what Git will actually do. Two profiles with identical name and email are interchangeable by construction, which is why matching on that pair is enough.

`Identity.is_local` is the distinction the UI needs: an identity inherited from the global config is *not* a chosen profile. The selector therefore carries a third, purely descriptive entry — "Identité du dépôt" — for a local identity matching no profile; without it the `<select>` would fall back to its first option and claim a profile is active when none is.

The selector is a single full-width `<select>` at the top of the commit box, and it is the *whole* block: the effective identity rides in the option labels (`Libellé · Nom`) rather than in a line beside it. Its last entry, "Gérer les profils…", opens Settings — it must reset `event.currentTarget.value` first, since nothing in the derived state changed and Svelte would leave the DOM showing that entry as selected.

It carries `appearance: none` and paints its own chevron so it can match the summary input exactly (same background, border, radius, font-size and vertical padding). A native `<select>` imposes its own height and blue button, which no amount of padding will align.

Deleting a profile leaves repositories untouched, for the same reason: their identity lives in their own config. `clear_identity` removes both keys but leaves an empty `[user]` section behind — libgit2 has no remove-section call, and Git ignores it.

### The theme is one CSS variable set, swapped by an attribute on `<html>`

Light, dark, or system, chosen in Settings and persisted in `prefs.json` beside the Pull mode. Dark is the base — it lives on `:root` in `app.css` — and light only redefines the same variables under `:root[data-theme="light"]`. **No component knows which theme is on**; they read variables, so a third theme would be one more block in that file and nothing else.

That only holds if nothing hardcodes a colour, which is why the **state colours are tokens too** (`--ok`, `--danger`, `--warn`, `--info`, `--neutral`, each with its `-soft` / `-bg` / `-border` variants, plus `--scrim`, `--shadow-color`, `--scrollbar-thumb`, `--accent-text`). The light values are not the dark ones lightened but a full tone darker: a green that glows on near-black has no contrast left on white. A literal `#4ade80` in a component would be invisible in one of the two themes.

`src/lib/theme.svelte.ts` holds the choice, and keeps two things apart: `mode` is what was *chosen* (including `"system"`), `dark` is what is *applied*. **`data-theme` always carries the resolved value**, never `"system"` — the stylesheet then has a single case to handle. System mode delegates to `prefers-color-scheme` through a `matchMedia` listener, so the app follows a Mac switching appearance while it runs.

`theme.init()` runs in `main.ts` **before mounting**: the system preference is read synchronously, and the persisted choice lands one round trip later. Nothing is cached in the webview to close that gap — persistence stays in Rust, like the recents, the profiles and the Pull mode — so a theme forced against the system flashes for one frame, and only that case.

Two things the CSS cannot reach:

- **The window itself.** `commands::set_theme` also calls `WebviewWindow::set_theme`, and `lib.rs` applies the persisted value at startup, before the window shows. `System` maps to `None` — an absence of instruction, which is what lets the window follow the OS. That is also why switching *back* to system corrects itself through the media listener rather than instantly: while a theme is forced, the webview's `prefers-color-scheme` reports the forced value, so the true system preference is only knowable once Rust has released it.
- **The graph lanes**, painted on a canvas: `LANE_COLORS` / `LANE_COLORS_LIGHT` in `layout.ts` are the one place in the frontend where both themes are spelled out in hex. **Same length, same order** — the colour index travels with each lane and edge and knows nothing about the theme. `GraphView` reads `theme.dark` inside `draw()`, which is what makes the redraw automatic; the commit dot's ring follows the background and its selection halo the opposite.

### Text size is one root `font-size`, in points

Chosen in Settings (11 → 18 pt), persisted in `prefs.json` beside the theme, and applied by `src/lib/font.svelte.ts` writing `font-size` on `<html>`. **Every length in the app is in rem**, so that one value scales the whole interface — spacing included — and no component has anything to read.

**The unit is the point**, Apple's, which is also the CSS pixel at macOS's 1× scale: 13 pt is the system text size, hence the default. But the root font-size is *not* the text size — in this codebase body text is written `0.82rem` (file names, branch names, commit summaries). The root is therefore `calc(13px / 0.82)`, so that ratio lands exactly on the chosen size. That `BODY_RATIO` is the price of not rewriting ninety `font-size` declarations, and it is spelled out in one place on each side (`app.css`, `font.svelte.ts`).

Three consequences worth keeping:

- **The default lives in `app.css`, not in the store.** `font.init()` applies nothing until the preference comes back, so nothing flashes — unlike the theme, which has to be resolved before the first paint. It is also what a browser shows, where there is no backend to answer.
- **The preference travels as a number, not an enum** — unlike `ThemeMode` and `PullMode`. A value out of bounds is clamped (`AppState::font_size`, both on read and write); an unknown *variant* would fail the whole `prefs.json` parse and take the theme and Pull mode down with it. `Prefs::default` is hand-written for the same family of reasons: derived, `u8::default()` would start a file written by an earlier version at 0 pt.
- **What is in px stays in px on purpose**: icon buttons and their glyphs (the sidebar's 56px toolbar squares, the tabs' 30px), and above all the tab bar's `min-height: 49px`, which is measured against `trafficLightPosition` and must not move with the text.

### Commit descriptions render Markdown — without `{@html}`

`src/lib/markdown.ts` parses a **subset** of Markdown into a block tree that `CommitBody.svelte` renders through ordinary Svelte interpolation. **Never replace this with a Markdown library + `{@html}`**: a commit message is third-party content (anyone can write one in a repo you clone) and the webview has `invoke` access, so that would be a live XSS path. It also keeps the zero-runtime-dependency footprint.

Deliberate deviations from CommonMark, each with a test in `markdown.test.ts` — don't "fix" them:

- single newlines are **kept** (as GitHub does for commit messages); reflowing paragraphs would glue `Co-Authored-By:` trailers together;
- `_text_` is **not** emphasis — `commit_graph`, `stage_all` and every other snake_case identifier would be mangled;
- `*text*` requires content that neither starts nor ends with a space, so `refs/heads/* and refs/tags/*` stays literal;
- links render as `<span>`, not `<a>`: there is no `shell:allow-open` capability, so a real link would navigate the webview out of the app.

## Non-obvious constraints

These caused real breakage; don't undo them.

- **`Libgit2Backend` stores only a `PathBuf`** and re-opens `Repository` on every call. `git2::Repository` is not `Sync`, so keeping it in Tauri state would require contortions; `Repository::open` is cheap. Add caching only behind the trait.
- **Use `Diff::print`, not `Diff::foreach`**, to build diffs. `foreach` needs two closures mutably borrowing the same hunks vec → borrow-checker error. `print` uses one callback and distinguishes rows via `line.origin()` (`'F'` file header, `'H'` hunk header, `' '/'+'/'-'` content).
- **`generate_context!` embeds `src-tauri/icons/*` at compile time.** If those files are missing, even `cargo check` fails with a proc-macro panic. Regenerate with `npm run tauri icon <source.png>`.
- **Never put `direction: rtl` on `.path` in `FileItem.svelte`.** It was used for left-side ellipsis but reorders bidi text, rendering `.bob/config.json` as `bob/config.json.` — breaking every dotfile.
- **`html, body` carry `overflow: hidden` + `overscroll-behavior: none`** (`app.css`). This is a desktop app: only inner panels scroll. `overscroll-behavior` specifically kills WKWebView's elastic bounce, which otherwise drags the whole UI.
- **Both side columns share `--sidebar-w`** (`app.css`); `App.svelte` uses it for the left and right grid tracks. Change the variable, not the grid.
- **Commands are synchronous** and hold a `std::sync::Mutex` guard. Don't make them `async` (guard would be held across await). The corollary for anything blocking — network above all — is a dedicated thread; see the fetch section above.
- Capabilities are minimal on purpose: `core:default` + `dialog:allow-open` only. There is no `fs` plugin — all disk access goes through git2 in Rust. Adding a plugin requires updating `src-tauri/capabilities/default.json`.

## Scope

Out of scope for now, but the architecture must not block them: rebase, hunk-level staging, per-hunk conflict resolution, tags, blame. `fetch`, `push` and `pull` **are** implemented (background thread + `repo://fetched` / `repo://pushed` / `repo://pulled`), authenticating over SSH via the agent or an on-disk key, and over HTTPS with credentials the app stores itself. Pull covers fast-forward and merge; a conflicted merge is left in the worktree for the user to resolve and commit, or to abandon. Push publishes the current branch only, sets its upstream on first push, and never forces. Remote branches are **listed** in the sidebar's REMOTE section, **walked** by the graph, whose ref badges show them, and **checked out** into a local tracking branch on double-click; a fetch refreshes the first two. Tags are still nowhere.

**The app must stay standalone**: no shelling out to `git`, `ssh`, or a credential helper. Anything Git-related is libgit2/libssh2 in-process, and credentials go through `credentials.rs`. This is what rules out `Cred::credential_helper` (it runs `git credential-<helper>`) and what any new auth path has to satisfy.

The **Settings screen** (gear, far right of the tab bar) holds *Apparence*, *Taille du texte*, *Profils*, then *Jetons d'accès*: the theme and the text size are picked there (segmented controls — exclusive options, one always active), profiles are created, and tokens entered, replaced and forgotten. It takes over the whole body — over `WelcomeScreen` as well as over an open repository — while the tab bar stays reachable; `TabsStore.settingsOpen` drives it, for the same reason `hasTabs` drives `WelcomeScreen`. It lists one row per host found among the **open** tabs, which is why opening a repository closes Settings: the list is built once on mount rather than in an `$effect`, which would loop (the load reads the rows it then rewrites, to keep manually added hosts).

**Only HTTP(S) remotes appear there**, and `RemoteInfo.uses_http` is what decides. An SSH remote has a host too, but a token would never be used for it — listing it invites a pointless entry. The same flag stops `NoCredentials` on an SSH remote from opening the token dialog: that case gets an actionable message about ssh-agent and `~/.ssh` instead. Stashes can be **applied / popped / dropped** (right-click or the ⋮ button in the STASHES section) but **not created** — `git stash save` has no UI yet. Drop is confirmed inline in the context menu (two clicks), not via a native dialog, since no confirm capability is declared.

The left sidebar's toolbar holds Pull / Push / Fetch, all three working, and all three disabled *together* while any of them runs (`busyRemote`) — the backend holds one reservation for all remote work. Pull and Push carry the current branch's behind/ahead counters.

**Pull is a split button**, GitKraken-style: the button runs the chosen mode, the chevron — placed *inside* the cell against its right edge, not beside it, so the two read as one control and the three toolbar buttons keep the same footprint — opens a radio menu that only *picks* the mode (choosing never fires a network call — a menu click that merged would be a nasty surprise). The mode is a global preference in `prefs.json`, not per-repository. The menu lists four entries and only three are live: **rebase is rendered disabled**, because it has no `PullMode` variant behind it. The enum describes what exists; the menu says what will exist.

The graph is **read-only**: no checkout-from-commit, branch creation or reset from it, and no tags in the ref badges (`collect_refs` reads local and remote branches, nothing else). It does carry an "uncommitted changes" (WIP) row at the top, but that row only *selects* and *types the commit summary* — nothing is staged, discarded or committed from the graph.

**Amend has a backend but no UI**: `GitBackend::commit(.., amend)`, the command and `api.commit`'s parameter all still work and are tested, but the checkbox was removed from the commit box, so `RepoStore.commit` is only ever called with the default `false`.

Destructive operations (discard changes) and AI features are intentionally absent — don't add UI for features that have no working backend.
