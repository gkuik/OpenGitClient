# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

OpenGitClient — a lightweight desktop Git client (Tauri 2 + Rust backend, Svelte 5 frontend, libgit2 via `git2-rs`).
Goals: low memory footprint and small binary. Implemented so far: open repo → status → diff → stage/unstage → commit → fetch/push/pull (+ recent repos, local and remote branch lists with double-click checkout and ahead/behind counters, commit graph with commit inspection and an uncommitted-changes row at its top).

The window is a tab bar (open repositories), then the repository bar, over a three-column layout: branches, local and remote (left) · graph *or* diff (center) · file selector (right). The sidebars deliberately mirror GitKraken's layout.

**The tab bar *is* the topbar** — no logo, no "open repository" button: the tabs, a `+` that sits in the same flow right after the last tab, and a settings gear pinned to the right. The gear lives **outside** `.tabs` (which is `flex: 1` and scrolls), so it stays against the right edge however many tabs are open instead of scrolling away with them. Tabs show the repository name only (no branch — the current branch is already in the status panel header). The `+` opens a **new-tab page** rather than the folder dialog (see below). With no tab open at all, `WelcomeScreen` takes the whole body.

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

**There are no *view* tabs** (that's separate from the repository tabs above). The centre shows the graph until a file is opened; the diff then replaces it, and the diff's × brings the graph back. The right column is always the file selector for whatever is being looked at: the commit's file list when a commit is selected, otherwise the working-directory changes + commit box. Selecting a commit therefore hides the commit box — deliberate, to give the graph and diff the full width. That commit box *does* carry two tabs, **Commit | Stash**, splitting the column's width in two: what is being written goes either into a commit or into a stash (see below).

**Code comments and commit messages are in French; the interface is in English.** Match that when editing — and no UI string is ever written in a component: it lives in `src/lib/locales/en.ts` and is read through `t()` (see *The interface is English, and translatable* below). Git vocabulary stays English in every language: commit, stash, stage, fetch, push, pull, merge, branch, HEAD, upstream, fast-forward, diff, pull request.

## Commands

Rust is installed through Homebrew's `rustup` (`/opt/homebrew/opt/rustup/bin`, on the PATH via `~/.zshrc`); there is no `~/.cargo/env` to source.

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

Frontend unit tests (vitest, dev-only dependency — covers the pure modules: `src/lib/graph/layout.ts`, `graph/refs.ts`, `graph/columns.ts`, `graph/timeBuckets.ts`, `tree.ts`, `markdown.ts` and `i18n.svelte.ts`):

```bash
npm test
```

Vite is pinned to port 1420 with `strictPort` (Tauri expects it) — a stale dev server on that port makes `npm run dev` fail.

## Branching: git flow

**Never commit directly on `main` or `develop`.** `main` only receives releases
and hotfixes; `develop` is the integration branch, and it only receives merges.

- **Feature / fix**: branch off `develop` as `feature/<name>` (or `bugfix/<name>`),
  commit there, then merge back into `develop` with `--no-ff` and delete the
  branch. The merge commit keeps the feature visible as one unit in the history.
- **Release**: `release/<x.y.z>` off `develop`; bump the version in the three
  places that carry it (`package.json`, `src-tauri/Cargo.toml`,
  `src-tauri/tauri.conf.json`), then merge into `main` (`--no-ff`, tag `v<x.y.z>`)
  **and** back into `develop`.
- **Hotfix**: `hotfix/<x.y.z>` off `main`, merged into `main` (tagged) and `develop`.

The `gitflow.*` keys are set in the local Git config (`main` / `develop`, the usual
prefixes, tag prefix `v`), so the `git flow` CLI works as is if installed
(`brew install git-flow`) — but nothing requires it; plain `git` does the same.

## Architecture

### The Git abstraction is the central extension point

All Git logic sits behind the `GitBackend` trait in `src-tauri/src/git/mod.rs`. Commands never touch `git2` directly. `git::open_repository()` is the single factory — a future CLI (`git` shell-out) fallback becomes a second impl of this trait with no changes to commands or frontend.

**Adding a Git feature touches this full chain** (all must stay in sync):
`git/mod.rs` (trait method) → `git/libgit2.rs` (impl) → `commands.rs` (Tauri command) → `lib.rs` (`generate_handler!` registration) → `src/lib/api.ts` (typed wrapper) → `src/lib/types.ts` (TS mirror of the DTO) → `src/lib/locales/en.ts` (the strings the feature displays, plus an `error.<Kind>` entry for any new `AppError` variant).

### Backend/frontend contract

- DTOs live in `src-tauri/src/dto.rs` with `#[serde(rename_all = "camelCase")]`; `src/lib/types.ts` is a **hand-maintained mirror** — update both together.
- Every command returns `Result<T, AppError>`. `AppError` (`error.rs`) serializes to `{ kind, message, arg }`; `kind` is a stable discriminant the frontend can branch on **and the key it translates by**, `arg` carrying the variant's payload (a host, a refusal reason) so `{arg}` can be placed anywhere in a translated sentence. The `message` is English and is only a fallback — the one thing displayed for the variants whose payload *is* the message (`Git`, `Io`, `Network`, `CredentialStore`), which have no catalogue entry on purpose. No panics reach the frontend.
- Tauri converts JS camelCase args → Rust snake_case automatically.

### Frontend structure

- `src/lib/api.ts` is the **only** place allowed to call `invoke`. Components never do Git work or call the backend directly.
- `src/lib/stores/repo.svelte.ts` holds **one `RepoStore` instance per open repository** (status/diff/selection/view state), plus `TabsStore` (`export const tabs`) which owns the collection, the active tab, recents and session restore. Every mutating action funnels through the private `run()` helper, which refreshes status and captures errors.
- Frontend is plain Vite + Svelte 5 (runes), **not** SvelteKit — no SSR, no routing.

### The interface is English, and translatable

No component contains a display string. Everything goes through `t("key")`
(`src/lib/i18n.svelte.ts`) and lands in `src/lib/locales/en.ts` — **the English
catalogue is the reference**: `MessageKey` is derived from it, so a second
language is one file typed `Catalog`, where a forgotten key is a compile error,
plus an entry in `LOCALES` and in `CATALOGS`. Nothing else changes; no component
knows which language is on, exactly as none knows which theme is on.

A homemade module rather than a library, for the same reason as `markdown.ts`:
the project ships no runtime dependency, and what a library would really buy —
plural categories and date formats — is already in the webview, under `Intl`.

- **Git vocabulary stays English in every language.** Translating *stage* as
  « indexer » had already moved the interface away from the command line its
  users know. That is a rule about the catalogue's *content*, and it is why so
  many entries look untranslated.
- **A sentence is one entry, never fragments to reassemble.** Word order changes
  between languages, so `"Merge "` + branch + `" into "` + branch would be
  untranslatable. `RichText.svelte` is what makes that hold when a word inside
  the sentence carries markup (`<strong>`, `<code>`): `tParts` renders the whole
  sentence and reports which pieces came from a parameter, and the caller decides
  their tag. That is the only intended caller of `tParts`.
- **A plural is an object, not a `n > 1 ? "s" : ""`.** `Intl.PluralRules` picks
  the form from the `n` parameter; it alone knows a language's categories (two in
  English, four in Polish, and not at the same threshold in French). Hence
  `{ one, other }` values in the catalogue, `other` being the only mandatory one.
- **Dates are `$derived`, not built at mount.** `Intl.DateTimeFormat(i18n.locale, …)`
  in `GraphView` and `CommitDetailsPanel` — both stay mounted across tabs, so a
  formatter frozen at mount would outlive the language.
- **Errors are translated by `kind`, not by their text.** `errorMessage()` looks
  up `error.<kind>` and injects `arg`; two fallbacks, in this order: a `kind`
  with no catalogue entry shows the backend's English message, and an error built
  in the frontend (`localized: true`) is never re-translated — otherwise the
  generic entry for its `kind` would overwrite a message that says more, which is
  exactly the case of the SSH-key advice in `askCredentials`.
- **The language is not persisted in `prefs.json`**, unlike the theme, the text
  size and the sidebar widths. With one catalogue there would be nothing to
  choose, and the setting would be a knob with no effect. `i18n.init()` reads the
  system preference before mounting (nothing to load, so nothing flashes) and
  writes `<html lang>`, which is what speech synthesis and hyphenation read. A
  Settings entry belongs with the second language, not before it.

### Multiple repositories: one tab each

`AppState` holds a `HashMap` of backends, **keyed by the repository's canonical path** — that key *is* the tab id, and it is what `RepoInfo.path` carries. Using the path rather than a generated id means opening an already-open repository can't create a duplicate tab, and the session survives restarts with no id mapping to maintain.

**An open tab is not necessarily a repository.** `+` appends a `NewTab` — the "New tab" page: open a local repository (the only live action; clone and create are rendered disabled, since they have no backend behind them), or pick a recent one. `NewTabView` replaces the three columns while it is the active tab, the tab bar staying above it, exactly as `SettingsView` does for the settings tab.

That tab exists **only in the frontend**, and it has to: a tab's id *is* its repository's canonical path, so a tab without a repository has no id to give the backend. Hence a counter (`new:<n>`), never sent anywhere, and nothing to restore at startup — a landing page has no state worth persisting. `TabsStore.tabs` is therefore a discriminated union (`RepoStore | NewTab | SettingsTab`, on `kind`), which is what forces every site that means *a repository* to say so: `repoTabs` filters them for the event routing, for `set_tab_order` (the backend only knows repositories) and for Settings' host list. `active` still returns a `RepoStore | null` — `null` on a new tab or the settings tab — so the `repo` proxy falls back to `EMPTY_TAB` and no component changed.

**Opening a repository from that page consumes the tab in place**, rather than appending a second one beside it: the store slots into the page's index, and `set_tab_order` is re-sent because the backend has just appended the repository at the end of its own order, unable to guess it landed mid-bar. If the repository is *already* open in another tab, that tab is activated and the page closes — the path that keeps the "one tab per path" rule true.

**Every repository-scoped command takes a `repo_id`.** There is deliberately no "current repository" on the backend: two tabs can't fight over it, and a slow response can't be applied to the wrong tab. Adding a command means threading `repo_id` through the usual chain.

Frontend counterpart, and the reason the twelve components that use `repo` were left untouched: `export const repo` is a **`Proxy` onto the active tab**, not a store of its own. Each property access reads `tabs.activeId` first, so switching tabs invalidates everything that reads `repo` for free. Two consequences:

- methods are re-bound to the target tab on access — never cache `repo.someMethod` or destructure `repo`, capture `tabs.active` instead;
- with no tab open, the proxy falls back to an inert `EMPTY_TAB` so components can read `repo.*` without null checks.

Session (open tabs, **their order**, and the active tab) is persisted next to `recent.json` in `session.json` — with `profiles.json` and `prefs.json` (the Pull button's mode, the theme, the text size, the two sidebar widths and the graph's column layout) rounding out the four state files. Tabs are **not** reopened by Rust at startup: the frontend replays them through `open_repository`, so a repository deleted since last run is silently dropped instead of breaking startup. Display order lives in `AppState.order` (the `HashMap` has none) and `set_tab_order` overwrites it wholesale from the frontend — but defensively: unknown ids are dropped and an open tab missing from the received list is kept at the end, so a stale list can never make a repository vanish from the session.

Tab state stays in memory while the tab is open, so returning to it is instant; only `activate()` re-runs, refreshing status and branches because the working directory may have changed on disk. **`graphScrollTop` lives in the store, not in the DOM** — all tabs share one `GraphView`, so the scroll position has to be saved and restored per tab. `GraphView` guards that restore with a `restoring` flag; do **not** reintroduce `requestAnimationFrame` there, since it is suspended while the window isn't painting and would leave the flag stuck, silently discarding every later scroll.

### Status model: 3 backend categories → 2 UI sections

The backend returns `staged` / `unstaged` / `untracked` separately. The sidebar deliberately merges `unstaged + untracked` into one "Unstaged" section (`repo.unstagedEntries`), matching GitKraken's two-section layout. Staged files are `staged=true`; everything else is `staged=false` — that boolean drives both which diff is requested (HEAD↔index vs index↔worktree) and whether the row's button stages or unstages.

After any refresh, `resyncSelection()` re-locates the selected file, because staging moves it between sections.

### Discarding everything is one reset plus a clean

`discard_all` sits at the right column's header — `↺ Discard all`, against the right edge of the `N changes on <branch>` line. It brings tracked files back to HEAD (`ResetType::Hard`, index and worktree) **and deletes untracked files**. That second half is not an extra: the counter beside the button counts untracked files, so leaving them behind would make the button lie about what it just did — the same reasoning that puts `INCLUDE_UNTRACKED` on `stash_save`.

- **Ignored files are never touched.** They are build output, not changes, and the status the button counts excludes them too. Which is why `recurse_untracked_dirs(true)` is on: it yields untracked files one by one, so an untracked directory holding an ignored file loses only the file. `prune_empty_dirs` then removes what the deletions emptied — `remove_dir` fails on a non-empty directory, so the one still holding an ignored file stops the walk by itself, with nothing to filter.
- **Directories are skipped, deliberately.** With recursion on, the only thing libgit2 still reports whole is a nested repository, which it won't descend into. Erasing someone's nested repo is exactly what `git clean -fd` refuses without a second `-f`.
- **A merge in progress is closed** (`cleanup_state`), as `git reset --hard` does. Without it the merge state would outlive the conflicts and the next commit would silently be born with two parents. That is also why the command returns `RepoInfo`, like `abort_merge`: `merging` drives `MergeBanner`, and the frontend must not have to guess.
- **An unborn HEAD has no tree to return to**: the index is cleared instead, and everything on disk is then untracked, which the second half already handles.

The confirmation is a panel anchored under the button, not a native dialog (no confirm capability is declared) and not the stash menu's two-click pattern — it names the two counts separately, because reverting a tracked file and deleting an untracked one do not cost the same. Nothing is reloaded beyond status and `repoInfo`: no commit was created or moved, so the graph and the branch lists are untouched.

### Discarding one file — or a directory — is the same rule, applied to paths

Right-clicking a file row or a directory row in the right column opens a one-entry menu, **Discard changes**, and `discard_paths(paths)` is `discard_all` narrowed to those paths with the same arbiter — **HEAD decides**: a path present in HEAD comes back to it (one forced `checkout_head` over all of them, since SAFE would refuse to overwrite exactly what is being erased), and a path absent from HEAD is a new file, staged or not, which is removed from the index if it was there (one index write for the lot) and deleted from disk, with `prune_empty_dirs` taking the directories it emptied. A path that exists nowhere is not an error: there is nothing to discard. It does **not** close a merge in progress, unlike `discard_all` — a few files say nothing about the other conflicts — which is why the command returns nothing and `repoInfo` is not reloaded.

- **It takes a batch, not a path.** A directory of the tree holds dozens of files; discarding them one by one would re-open the repository and rewrite the index that many times. One call, one checkout, one index write, one status refresh.
- **A directory discards what its row counts** — the files under it *in that section*, sub-directories included (`collectEntries` in `tree.ts`, pure and tested). A `src` folder in Unstaged knows nothing of the staged files under `src`; they sit in the other section, with their own row and their own menu. Nothing is selected on a directory: it has no diff to show, and its fold is left as it is.
- **The store takes the entries, not the paths.** A staged rename is *two* paths: the old one (in HEAD, to restore) and the new one (absent from HEAD, to delete). The backend only knows paths; `RepoStore.discardFiles(entries)` is where the `R` row becomes one gesture again. If the file in the diff is part of the lot, `resyncSelection` closes the view on noticing it is gone.
- **The right-click on a file selects the row first**, like a left-click: the menu acts on the file being looked at, and the diff in the centre shows what the entry is about to erase. The `ContextMenu` key does the same from the keyboard, on files and directories alike.
- **The request lives in `src/lib/fileMenu.svelte.ts`, the menu in `StatusPanel`** — the `branchMerge` split, for the same reason: the rows are born of a recursion (`TreeRow` around `FileItem`) and the menu is rendered once for the column. `FileItem` and `TreeRow` are only used for the working directory, so a commit's file list never gets this menu.
- **Nothing sits above the entry** — no path, no explanation: the menu opens on the row it concerns. The entry is in the danger colour, armed by a first click and run by the second (the stash-drop pattern), and re-armed on every open so a right-click on another row cannot inherit the previous confirmation.

### A stash is written like a commit, and read back from the commit

The commit box's two tabs share their layout and nothing else. The author selector is **Commit-only**: a stash is signed by the repository's identity like any commit, but that is not something one picks when parking work in progress — showing the selector there would suggest a choice that the tab isn't making. The Stash tab has its own draft (`RepoStore.stashSummary` / `stashBody`, beside the commit's): the commit summary is already edited by the graph's WIP row, where a stash name has no business, and one shared field would let each tab overwrite what the other was writing. Which tab is showing is local to `CommitBox`, unlike the drafts — it is a way of looking at the column, not repository state.

`stash_save` always passes `INCLUDE_UNTRACKED`: the point of stashing is a clean working directory, and untracked files left behind would defeat it. No `KEEP_INDEX` — what was staged is staged again on pop. Its guard is `changeCount`, not `hasStaged`: a stash needs no index.

**The message is built exactly like a commit's** (`summary\n\n body`) and libgit2 stores it in two places that do *not* agree: the stash commit keeps it intact, while the reflog — where `stash_foreach` reads — **replaces every newline with a space**, gluing the description onto the name in one line. So `stashes()` re-reads the message off the commit after the walk (outside the closure, which borrows the repository mutably) and keeps the reflog only for `parse_stash_branch`: the `On <branch>:` prefix is guaranteed there, including for a stash created by another tool.

libgit2 reports "nothing to stash" as a generic `NotFound`, which the error banner would render as nonsense — hence `AppError::NothingToStash`. The graph is *not* reloaded after a stash: `refs/stash` is not one of the globs the revwalk pushes, so history hasn't moved; the status refresh is what makes the WIP row and the file list catch up.

### Graph: backend walks, frontend lays out

The backend returns raw commits (`oid`, `parents`, `refs`) — **lane assignment is presentation, so it lives in `src/lib/graph/layout.ts`**, a pure function with vitest coverage. A future CLI backend therefore has nothing to duplicate.

`GraphView.svelte` splits rendering deliberately: **Canvas 2D draws only the lane geometry** (lines + dots), **DOM draws all text** (virtualized rows). That keeps hover/selection CSS, text selection and keyboard focus while avoiding one DOM node per commit. Three consequences that are easy to break:

- `ROW_H` is applied to rows as an **inline style, never in CSS** — it is the only thing aligning the canvas with the DOM. It is `$derived` from `font.rootPx` (26px at the default size) because the row carries text: frozen, it would clip it at the first size above the default. `draw()` reads it, so the canvas redraws itself.
- The canvas is an overlay with `z-index: 3`, i.e. **above** the rows. Row hover/selection backgrounds span the full width including the gutter; a canvas underneath would be masked by them.
- **The graph is a table**: *Branch / Tag*, *Graph*, *Commit message*, *Author*, *Date*, *SHA*, under a header row carrying their names and, at its right end, a gear opening the column menu (checkboxes, plus *Reset columns*). The model is `src/lib/graph/columns.ts`, pure and tested (normalisation, placement in pixels, drop index, move); `graphColumns.svelte.ts` holds the state. The layout — order, hidden columns, widths — is **one for all repositories**, persisted in `prefs.json` (`GraphColumns` in `dto.rs`, sanitised on read and write by the same rules as the frontend's `normalizeColumns`). Column ids travel as **strings**, not a Rust enum: an unknown one would fail the whole `prefs.json` parse, taking the theme and the rest with it.
- **Header and rows share one `grid-template-columns`, in px, as an inline style** — the same trick as `ROW_H`: it is the only thing keeping them aligned. Widths depend on the layout and the text size, **never on the content** (measured on mounted rows they would shift while scrolling). Stored widths are in **rem**, like the sidebars.
- **Commit message is the elastic column**: never hidden, never sized, it takes what the others leave (down to `MESSAGE_MIN_REM`; past that the table is clipped on the right). Which decides where each resize grip sits: a column left of the message is pulled by its right edge, a column right of it by its left edge — the one touching the message, since the other is glued to the table's edge. Double-click on a grip restores the default width.
- **The graph column is auto-sized until someone sizes it**: with no stored width it follows the lane count (never narrower than its title), and once sized it keeps that width, lanes past its edge simply falling off the canvas, as in GitKraken. Its double-click brings back the auto width. The canvas is positioned on that column (`left` = its x, `top` = the header height) and is not rendered at all while the column is hidden.
- **Moving a column is `TabBar`'s gesture**: pointer events, geometry measured on `pointerdown`, the drop index from the dragged header's *leading* edge against the original midpoints (`dropIndex`). Only the header moves during the drag, with a drop mark; the rows re-order on release. The move is applied to the **full** order (`moveColumn(order, id, beforeId)`), not the visible one, so a hidden column keeps its relative place and comes back where it was.
- **Time separators, GitKraken-style — only while the Date column is hidden**: shown, it already says the same thing row by row. Between two commits of different time buckets, a 1px line carries the new bucket's age (« 3 hours ago », « yesterday ») **inline**, the line breaking for the label at the end of the message column and resuming after it. Separators are **not inside the rows**: they are zero-height flex boxes laid on the boundary (`top = index × ROW_H`) with their children centred on it — inside a row, the label's upper half would be clipped by `overflow: hidden`. They sit above the rows (whose hover background would hide them) and under the canvas (lanes cross them). There must be a row above: on the very first one the label would be cut in half by the scroller's edge. Buckets widen with age — minutes, hours, days, weeks (up to five), months, years — in `graph/timeBuckets.ts`, pure and tested; labels come from `Intl.RelativeTimeFormat` (`numeric: "auto"`), not the catalogue. Each commit is compared to the **previous** one, not to the bucket's start: topological order isn't strictly chronological. `now` ticks every minute; without it « now » would stay « now » all day.
- **Ref badges** are right-aligned in their column (against the graph in the default layout) and **shrink** rather than overflow (`flex: 0 1 auto` + ellipsis); past `MAX_REFS` they are replaced by a `+n` chip, since a badge squeezed down to its icons names nothing.

**One badge per branch, not per ref** — `src/lib/graph/refs.ts`, a pure function with vitest coverage, like the lane layout. The backend sends `main`, `origin/main` and the HEAD mark separately; a branch in sync with its remote said the same thing twice. `groupRefs` merges a remote ref into a local one **when both are on the same commit** — which is exactly what "same level" means, since the grouping happens inside one commit. What is left is the name plus two icons: a screen for "here", a cloud for "on the server". A local branch ahead of (or behind) its remote is on another row by construction, so it keeps its own badge and the icons are what tell the two apart. A `✓` marks the current branch, as in the sidebar.

Two details in there: the remote/local match is on the **suffix** (`origin/feat/x` ends with `/feat/x`), longest wins — splitting on the first `/` would break on a remote name containing one, which is the same reason `remote_branches` asks libgit2 for the remote name. And the badges are **sorted** head → local → remote-only: the column is narrow, so that order decides what survives the `+n` cut.

Pagination is `skip`/`limit` over a revwalk rebuilt on every call (a `Revwalk` borrows the `Repository`, which is re-opened per call). The walk pushes `refs/heads/*`, `refs/remotes/*` and HEAD, so a commit reachable only from a remote branch is in the history like any other. Order is stable only while refs don't move, so the frontend reloads from page 0 after commit/checkout/open — and after a fetch that actually moved something — but **not** after stage/unstage, which don't change history.

**The working directory is the graph's first row**, GitKraken-style: a dashed hollow circle, the summary of the commit being written, and the `✎ / + / −` counts, on top of the history. That summary is not a label but **the commit box's own field** — `RepoStore.commitSummary`, edited from either side, showing `// WIP` as a placeholder while it is empty. It is **entirely frontend** — no backend call, no DTO — because everything it needs is already loaded: `repoInfo.head` for the commit it hangs from (detached HEAD included) and `status` for the counts. Those counts go through `countStatuses` — the very function that fills the file tree's per-directory counters — so an untracked file is a `+` in both places instead of being classified twice; `RepoStore.changeCounts` only dedupes the paths first, since a file can be both staged and modified.

It is threaded **through** the lane algorithm rather than drawn beside it: `layoutGraph(commits, wip)` emits the row as a pseudo-commit whose parent is HEAD, so the existing loop reserves HEAD's column from the top, makes the intermediate rows cross it and lands the line on HEAD's dot — with no special case anywhere else. The visible consequence is deliberate: when HEAD's commit is *not* the topmost one, the current branch takes column 0 and the others shift right, which is exactly what the node claims. Drawing the line separately would have meant re-deriving all of that, badly. That line is **dashed**, like the node, from the node down to HEAD's dot and not a pixel further: `layoutGraph` marks its edges `dashed` (the WIP lane never moves, so following it is one index), and `draw()` anchors the dash offset on each segment's *absolute* y — every row strokes its own piece, so an offset from the viewport would restart the pattern at each row and make it crawl while scrolling.

Four things that look cosmetic and aren't:

- `GraphRow` is a **discriminated union** (`commit` | `wip`), not a `GraphCommit` with an invented oid. A fake oid would be comparable to a real one — selection, ref badges, scroll-into-view all key on oids.
- The row appears only once `repo.loaded` is true. The status lands before the history does, so without that guard the node would flash alone on startup with its line hanging in the void.
- **The commit draft (`commitSummary` / `commitBody`) lives in the tab**, not in `CommitBox`. Two reasons, and the first one predates this row: the commit box is mounted once for every tab, so a local draft followed the user from one repository to the next. The second is that two fields now edit one value, which therefore belongs to neither. `commit()` reads that draft and clears it on success — the reset can't live in a component that isn't the only editor. In the graph row the field's `keydown` **stops propagating**: the row itself listens for Enter and Space to select itself, and its `preventDefault` would swallow every space typed. Enter and Escape only blur — committing needs staged files and stays on the button.
- **WIP selection has no state of its own**: the row is highlighted when `selectedCommitOid === null`, since that is exactly when the right column shows the working directory. `selectWip()` is `clearCommitSelection()` under another name — one truth, nothing to keep in sync, and no toggle on re-click (deselecting would change nothing but the highlight).

`DiffTarget` in the store is a discriminated union (`worktree` | `commit`): one field for both diff sources so they can't contradict each other. `selectedPath`/`selectedStaged` are derived getters over it, which is why the status-panel components needed no changes. **It also drives the centre column** — `null` → graph, set → diff — so there is no tab state to keep in sync.

Two independent selections, don't conflate them: `diffTarget` (centre) and `selectedCommitOid` (right column). Closing the diff keeps the commit open, so the next file of the same commit is one click away; closing the commit (× or re-click in the graph) also drops a `commit`-kind `diffTarget`, since its file selector would be gone.

`CenterPanel` keeps **both** views mounted and toggles `visibility`, never `display: none`: the graph must keep its scroll position and its measured height across a diff.

**A Markdown file can be read rendered.** The diff header carries a Code | Preview toggle for `.md` / `.markdown` only — any other file has nothing but its code to show. The choice (`RepoStore.renderMarkdown`) survives from one file to the next and is per tab, like the selection; it has no effect on a non-Markdown file (`showPreview` = chosen *and* applicable). The rendering is `CommitBody`, the same `{@html}`-free Markdown subset as commit descriptions — a README comes from outside as much as a message does. Its content comes from `file_content(path, source)`, a new command, and **the source is the diff's**: `FileSource` mirrors `DiffTarget` (index for a staged file, worktree otherwise, the commit for a commit file), so a preview never shows the disk while the diff shows the index. The read is capped at 1 MiB and uses Git's binary heuristic (a NUL in the first 8 KB); `text: null` means there is nothing to render — binary, absent from that source, or too large — and the viewer says which. `loadDiff` reloads the preview with the diff, and a late answer for a file that is no longer selected is dropped.

### Fetch and push are the commands that don't do their own work

`fetch` and `push` are the only network calls in the codebase, and the only `GitBackend` methods that block on something outside the machine. `commands::fetch_remote` and `commands::push_branch` therefore **reserve the repo, spawn a thread and return immediately** — running either in the command body would run it under the `AppState` mutex, freezing every tab for its duration and forever on a connection that never answers.

The thread **re-opens its own backend from the path** instead of borrowing the one in `AppState`: the tab id *is* the canonical path and `Libgit2Backend` only stores a `PathBuf`, so it never touches shared state during the network call. It releases the reservation (`AppState::begin_network` / `end_network`) **before** emitting, so the frontend can start the next one the moment it hears back.

**One reservation covers both**, and that's not laziness: libgit2 updates the remote-tracking refs after a push too (`git_remote_update_tips`), so a fetch and a push racing on one repo would fight over `refs/remotes/**` exactly as two fetches would. Hence `NetworkBusy` rather than a fetch-specific error.

Each result comes back as an event — `repo://fetched`, `repo://pushed` — not as a return value; `TabsStore` routes it to the tab named by `repoId`, which is not necessarily the visible one. `core:default` already covers `listen` (via `core:event:default`), so no capability was added.

Push adds three things fetch doesn't need:

- **`push_update_reference` is mandatory, not decorative.** A server can refuse one ref (non-fast-forward, protected branch, hook) while `push()` itself returns `Ok`. Without reading that callback, a rejection would be reported as a success. The client-side refusal is a separate path — libgit2 compares the advertised refs before sending anything and returns `ErrorCode::NotFastForward` — and both funnel into `AppError::PushRejected`.
- **An explicit refspec** (`refs/heads/<b>:refs/heads/<b>`), not the remote's configured ones: only the current branch is published, never every head. The leading `+` appears only for a `PushMode` the user picked entry by entry in the button's context menu — never by default.
- **`PushMode` is an argument, never a preference.** Unlike `PullMode` it is not persisted, not remembered between calls, and the store's `push()` defaults it back to `"normal"`: a force retained from one time to the next would turn the Push button into a trap.
- **`ForceWithLease` is a real lease, not a label.** libgit2 has no such mode, so it is implemented in the `push_negotiation` callback: it fires between the negotiation and the upload, and hands over each ref's *current* value on the server. Comparing that to our `refs/remotes/<remote>/<branch>` and returning an error aborts the push **before a single byte is sent** — which is exactly what `--force-with-lease` promises. A missing remote branch gives a zero oid on both sides, so creating one is not a lease break. Careful with the names: `PushUpdate::src()` is what the server holds *now*, `dst()` the value we want to write — the reverse of the first reading, and the tests are what caught it.
- **A broken lease is its own error** (`PushLeaseStale`, carrying the oid the remote is actually at), not a `PushRejected`: nothing was refused by the server, we refused ourselves, and the answer is to fetch and look at what arrived.
- **`push -u` happens after the push, and only if the branch had no upstream.** Setting it earlier would leave a branch tracking a ref that a failed push never created. `PushReport.upstreamSet` reports whether it happened, since `set_upstream` can still fail on its own (that failure doesn't fail the push — the commits *are* published by then).
- **A branch's first push asks before sending anything** — the upstream bar, GitKraken's word for word: *What remote/branch should "x" push to and pull from?* · remote `<select>` · `/` · name pre-filled with the local one · **Submit** · **Cancel**. It **covers** `RepoBar` — `position: absolute` over the `.top` wrapper in `App.svelte`, full width, nothing below moves — because the question suspends exactly the gesture whose button that bar carries, and showing both would invite a second click (`UpstreamPrompt.svelte`); focus lands on the remote selector, as in GitKraken — the name is right in the common case, the real question is *which remote*. It is the **upstream** that is being decided (push *and* pull), which is why the choice is asked rather than made silently. `RepoStore.push()` opens it when the HEAD branch has `upstream === null` and `list_remotes` returns something; with no remote at all the push goes through and reports `NoRemote` as before. Nothing is sent until Submit: `confirmUpstream` closes the bar and runs the push with the chosen remote and name — the `target` argument of `push`, which drives the refspec (`refs/heads/<local>:refs/heads/<target>`), the lease's expected ref and the upstream set afterwards (`<remote>/<target>`). `PushReport.target` says under which name the branch landed; the bar's report reads *published as* when it differs. The mode chosen when Push was clicked (normal or a force) rides along in `upstreamPrompt.mode`.

Two things inside the libgit2 impl that look optional and aren't:

- **Authentication spawns no external process — the app stays standalone.** `Cred::credential_helper` is deliberately *not* used: it runs `git credential-<helper>`, which would make the app depend on an installed Git. Everything goes through libssh2/libgit2, already linked into the binary.
- **SSH tries the agent, then keys on disk** (`SSH_KEY_NAMES`, newest algorithm first, existing files only). The disk fallback is not optional: libgit2 does not read `~/.ssh/config` and does not look for `~/.ssh/id_*` by itself, so agent-only support locks out anyone whose agent isn't loaded — which is the default on macOS. A passphrase-protected key still fails; a background fetch can't prompt.
- **HTTPS credentials are the app's own** (`credentials.rs`). It never reads entries written by another tool — reading Git's osxkeychain item would work but triggers a macOS authorization prompt, because that item's ACL doesn't list us. Ours does, so re-reading is silent. macOS stores them as a generic password under service `OpenGitClient`, keyed by host (an entry still under the pre-rename service `GitLite` counts as present, is moved on its first read, and is erased along with the new one on forget — otherwise a forgotten token would come back from the old service); other platforms behave as an empty store and say so on save rather than accepting a secret they can't read back.
- **That silence has a condition**: the ACL records the *signing identity* of the app that wrote the entry, not its path. A build signed with a stable identity is recognised from one version to the next; an ad-hoc-signed dev binary has its own hash for identity, which changes on every compile — macOS then asks again, and "Always allow" only authorises the binary of the moment. It is a fact of the dev machine, not of the code, but it is what makes the next point worth having.
- **`has()` never reads the secret.** It searches on attributes only (`load_attributes`, never `load_data`): the ACL guards the data, so an existence check decrypts nothing and raises no prompt. It is asked on every `remote_info` — so on every Settings load — and routing it through `get` used to decrypt the secret just to throw it away. The secret is now decrypted only where it is actually used: the Git transport and a forge's API.
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

Reload after a pull is wider than after a fetch: `repoInfo` first (it decides whether the banner shows, and `branch` may have changed if the pull switched), then the status (this is where conflicted files appear), then the usual remote-ref reload — which also reloads the local branches and the graph, so a non-current branch fast-forwarded in place shows up moved. It's the only remote operation that writes the worktree and index.

### A branch is merged into the one it is dropped on

Dragging a local branch onto another opens a one-entry menu; right-clicking a
local branch opens the same one, **with a Pull entry on top**. Both say the same thing: **the row you landed on
receives the merge** — the dragged branch, or the current one for a right-click.
That is what a branch dropped on another means, and it is GitKraken's convention.
It also means the target is *not* necessarily the checked-out branch, which is
the whole difficulty.

`merge_branches(source, target)` decides on `graph_ahead_behind(source, target)`
rather than `merge_analysis`, which only ever reasons relative to HEAD. Three
cases, in order:

- **`ahead == 0`** — the target already contains the source: nothing moves. A
  branch merged into itself lands here by construction, so there is no self-merge
  error to invent.
- **`behind == 0`** — fast-forward. The reference is moved, and **the worktree is
  checked out only when the target is HEAD**. That is the entire reason for
  distinguishing the case: merging the current branch into a branch that lags
  behind it touches neither HEAD nor a single file on disk. `MergeReport.switched`
  is what tells the frontend whether HEAD moved, because it cannot guess. This is
  also the only case `MergeMode::NoFastForward` removes — see below.
- **otherwise** — a real merge, which **requires the target to be checked out
  first**: Git does not write into an inactive branch. The checkout comes before
  any write, so its SAFE strategy refuses on a dirty worktree and the merge is
  never begun; on conflict we stay on the target, which is where it gets resolved.
  `checkout_local` is shared with `checkout_branch` for exactly that step.

**The menu's two entries are two modes, not a setting.** `MergeMode` is passed per
gesture and **never persisted**, unlike `PullMode`: `NoFastForward` (`git merge
--no-ff`) always writes a commit, so the fusion stays visible in the history, and
the choice depends on which branch is being merged rather than on a global habit.
Its consequence is worth knowing before clicking: a commit is written on HEAD, so
that mode **always** switches to the target, even where a fast-forward would have
moved nothing. Both entries are live; the second one names its effect ("without
fast-forward") and carries a filled junction dot, since that dot *is* the commit
it creates.

The conflict path is the pull's, deliberately: `MERGE_HEAD` set, `MergeBanner`,
`commit()` picking up the second parent, `abort_merge` as the way out — nothing
new to resolve conflicts with. `AppError::MergeInProgress` refuses a second merge
over the first, since `MERGE_HEAD` is unique and overwriting it would lose the
side still to resolve. Nothing is ever forced, and a fast-forward is never
inflated into a merge commit (`--no-ff` is not offered).

**The right-click menu is the branch's menu, the drop menu is a merge gesture** —
`MergeRequest.fromDrop` tells them apart. Right-click adds a **Pull** entry above
the merge entries: it runs `repo.pull(mode, branch)` on the clicked branch with
the Pull button's mode (except *Fetch every remote*, which is not a pull and
falls back to fast-forward-or-merge). Right-clicking the *current* branch opens
the menu too (it used to be refused as a self-merge): Pull alone, the merge
entries being dropped when source and target coincide. A drop keeps the early
return and never shows Pull.

**Pulling a branch that is not checked out** is `pull(Some(branch), mode)`, and
it borrows `merge_branches`' rule rather than the HEAD path's: the branch's own
upstream remote is fetched, then `graph_ahead_behind` decides — up to date,
nothing; behind only, **the ref is moved and nothing on disk is touched**
(`git fetch origin b:b`); diverged, `FastForwardOnly` reports `Diverged`, and
the merge mode **checks the branch out first** (SAFE, so a dirty worktree
refuses before anything is written) and then runs the ordinary merge path.
`PullReport.branch` and `PullReport.switched` are what let the report say where
the commits went and whether HEAD moved — the frontend cannot guess either. The
credentials retry remembers the branch along with the mode (`pullBranch`).

`RepoStore.reloadAfterMerge` runs **on failure too**, and that is not a
precaution: a real merge switches to the target *before* writing, so HEAD may
have moved even though the error came back. It reloads repo info (`merging` drives
the banner, `branch` may have changed), the status (where conflicted files show
up), the local branches and the graph — but not `refs/remotes/**` nor the
stashes, which a merge does not touch.

**The drag's transient state lives in `src/lib/branchMerge.svelte.ts`**, a module
rune — not in `BranchRow`, because the gesture spans two rows (the one held, the
one hovered) born of a recursion, and not in `RepoStore`, because none of it is
repository state and none of it survives the button being released. Pointer events
as in `TabBar`, for the same reasons, plus three of its own:

- **The drop target is found by hit-testing the point** (`elementFromPoint` →
  `[data-branch]`), never by rectangles measured on `pointerdown`. Unlike the tab
  strip, this list scrolls, folds and unfolds under the cursor; `data-branch` is
  the one marker that follows all of that, and only local rows carry it — so a
  remote branch is neither source nor target. Which is also why the label
  following the cursor is `pointer-events: none`: it would otherwise be the thing
  found under the point.
- **A 4px threshold separates the drag from the click**, which selects the
  branch's tip commit. Past it, the trailing `click` is swallowed by
  `consumeClick()` — it targets the row where the gesture *started*, not where it
  ended. The flag is cleared on every `pointerdown`, so a gesture whose click
  never fires (the menu's overlay can take the `mouseup`) cannot eat the next one.
- **Nothing is `preventDefault`ed**, unlike the tab drag: the section already
  carries `user-select: none`, so there is no text selection to kill, and the
  row keeps its native focus.

### Pull requests come from a forge, and nothing else here does

A pull request is not a Git object: it lives in a forge's REST API, not in
`refs/**`. `src-tauri/src/forge/` is therefore to that API what `git/` is to
libgit2 — **the extension point**: `ForgeBackend` (one method, `pull_requests`),
`github.rs` as its first implementation, `detect()` recognising the forge from a
remote URL. A second forge is a second impl and one arm in `detect`, with nothing
to change in the commands or the frontend.

`detect` knows **github.com and any GitHub Enterprise instance whose name says
so** — `github.psa-cloud.com`, `github-eu.acme.fr`. The two differ only by their
API root (`api.github.com` versus `https://<host>/api/v3`), which is why
`ForgeRemote` carries an `api` field and `ForgeKind` has no Enterprise variant.

**The hostname is the only clue we accept to follow.** Nothing in the protocol
distinguishes a GitHub instance from any other domain before you've called it, and
probing at random would mean offering a host's token to a server that may not be a
forge at all. The trade-off is deliberate: an instance named otherwise (`ghe.…`,
`code.…`) is not recognised and gets no section — better than a section stuck on an
error for hosts that never had pull requests.

- **`ureq`, not `reqwest`.** The whole backend is blocking — commands hold a
  `Mutex`, network work goes to a dedicated thread — so an async runtime would be
  pure weight for one HTTP call. Its TLS is what raised the crate's
  `rust-version` from 1.77 to 1.85; nothing else in the project needs that.
- **Two requests per load, not four.** GitKraken's three groups would each be one
  search query, on a much tighter quota (30/min), for a result one listing already
  contains: `GET /user` for the token's identity, then the repository's PRs. The
  backend reports **facts** (`mine` / `assigned` / `reviewing`) and the frontend
  builds the groups — the same split as the graph, whose lanes are laid out from a
  plain list of commits.
- **The thread takes no network reservation**, unlike fetch and push. Those two
  fight over `refs/remotes/**`; reading an API writes nothing at all, so Pull,
  Push and Fetch stay live while PRs load. The result comes back as
  `repo://pull-requests`, routed by `repoId` like the others.
- **The token is the one already stored** — `credentials.rs`, one entry per host,
  what Settings calls an « access token ». It is read at request time and only
  ever fills an `Authorization` header, the same one-way trip as the HTTPS secret
  handed to libgit2. Hence `RemoteInfo.forge`: a repository cloned over **SSH**
  needs no token to fetch but does to read its PRs, and without that flag its host
  would never appear in Settings (the list is filtered on `uses_http`) — the token
  would be impossible to enter.

**Nothing polls.** The watcher knows nothing about PRs — they never touch the
disk — and interrogating the API on a timer would burn the token's quota for a
column nobody is necessarily looking at. Loads happen on tab open, after a fetch
or a push (`reloadRemoteRefs`: someone just asked for news of the remote), on the
section's ↻, and when the « closed » filter changes — that one alone goes back to
the network, drafts being already in the payload.

Two things the failure path decides, and they are not the same decision:

- **`prError`, not the global banner.** Nothing is broken elsewhere; the section
  displays its own message, and one that says what to do — a link into Settings
  for a missing or refused token, a retry for the rest.
- **`prSupported` hides the section for exactly two errors**: no remote at all,
  and a host whose PRs we can't read. Those ask nothing of anyone. Every other
  failure keeps the section in place, because there *are* pull requests behind it
  — we just can't reach them.

The section carries a fourth group, « Others », that GitKraken doesn't have. It
appears only when non-empty, and it exists because the header counts what was
loaded: without it, a colleague's PR that concerns us in no way would be counted
and invisible, and the count would lie.

**Opening a PR in the browser is the only thing the app opens outside itself**, and
the boundary is in Rust, not in the capabilities. `tauri-plugin-opener` is a
dependency but is **not registered**: the webview therefore has no « open this
URL » command at all, only ours, which passes `forge::is_openable` first — https,
and a host recognised by the same rule as `detect`. Adding `opener:allow-open-url` to the capabilities would
hand the whole webview what one menu entry needs.

Everything here is **read-only**: no PR is created, merged, closed or reviewed
from the application, and a click on one only selects its source branch's tip in
the graph — the local branch if it exists, the remote one otherwise, and a message
saying to fetch when neither does.

### The disk is watched, and nothing is fetched for it

An editor saving, a `git checkout` at the terminal, another client: the repository moves under the app's feet, and until now that was only noticed on the next tab activation. `src-tauri/src/watcher.rs` listens to the filesystem and emits `repo://changed`, which `TabsStore` routes to the named tab — the same contract as `repo://fetched`, except nobody asked for it.

**Nothing is ever fetched here.** The watcher only re-reads what is already on disk; a fetch stays an explicit action, since it writes `refs/remotes/**` and would change what "behind" means without anyone deciding to.

- **One watcher for every tab.** `notify` takes several paths on one instance, so it is one thread in total, not one per repository. `AppState::open` registers, `AppState::close` unregisters — putting it there rather than in the command guarantees no tab can exist without it, restored sessions included.
- **The callback never touches `AppState`.** It runs on notify's thread while a command may hold the state's `Mutex`; it only reaches the watcher's own registry, which has its own lock and is never taken in the other direction. Each watched repository owns a backend the watcher opened **itself** from the path — same move as the fetch thread, for the same reason.
- **A missing watcher is not an error.** `RepoWatcher::new` returns `None` if the platform refuses, and the app then behaves exactly as it did before: refresh on tab activation. Same for a single failed `watch()` — losing a tab's live refresh must not stop it from opening.

**Two roots are watched, not one**: the working directory and the git dir. They coincide in the normal case (the recursive watch on the worktree covers its `.git`), but not for a linked worktree or a submodule, where watching the worktree alone would miss every ref movement.

**The filtering is the whole feature.** A build inside the repository emits thousands of events per second; three stages stop them:

1. **A whitelist inside the git dir** — `index`, `HEAD`, `ORIG_HEAD`, `packed-refs`, `refs/**` and the in-progress markers (`MERGE_HEAD` & co). A blacklist would have let through whatever a future Git adds; the whitelist keeps `objects/**` (which floods on every commit *and* every fetch), `index.lock`, `logs/**`, `FETCH_HEAD` and `COMMIT_EDITMSG` out by construction.
2. **The repository's own ignore rules**, through `GitBackend::filter_ignored` — git's rules, not a heuristic on directory names. It takes the **whole batch** in one call: asking per path would re-open the repository thousands of times a second, which is exactly the case it exists for.
3. **A 300 ms debounce**, because one editor save is often three events.

**Two flags rather than one scope**, and they don't cost the same: `worktree` re-reads the status only, `refs` reloads repo info (an external checkout moves `head`, and `merging` drives the banner), both branch lists, the stashes (`refs/stash` is one) and the graph — back to page 0, since its pagination is only stable while refs hold still. A `git checkout` sets both. That split is why typing in an editor never resets a graph scrolled ten pages deep.

Three things on the frontend side that are less obvious than they look:

- **Only the visible tab refreshes itself.** The others keep the note and drain it in `activate()`, which already re-syncs status and branches — ten open repositories have no business re-reading their status on every keystroke in an editor.
- **Nothing is applied while the app's own operation is running** (`busy`, `committing`, `checkingOut`, the three remote flags, `graphLoading`). A pull writes the worktree itself, so its own events would land on top of `reloadAfterPull`; a refresh mid-commit would read a half-written state; a reset to page 0 during infinite scroll would throw away the page in flight. The change waits its turn (`CHANGE_RETRY_MS`) instead of being dropped.
- **Notes accumulate, they don't replace.** Two batches can carry one the worktree and the other the refs, and `applyExternalChange` re-reads `pendingChange` at every loop turn so a batch arriving during an `await` is handled on the next one rather than lost.

The app's own writes come back as events (staging writes `.git/index`), so a redundant refresh follows every local action by ~300 ms. It is idempotent and the debounce collapses it; telling ours apart from someone else's would take a generation counter that would buy nothing visible.

### Ahead/behind is measured against the upstream, and only from the last fetch

`BranchEntry.upstream` carries the branch's upstream name plus `ahead`/`behind`, from one `graph_ahead_behind(local, upstream)` per branch in `local_branches()`.

- **The comparison is against `branch.upstream()`, never a hardcoded `origin/<name>`** — that's what a `push` would actually target, and it's the only version that survives a fork (`upstream/main`), a second remote, or a renamed tracking branch. It's also what the `set_upstream` in `checkout_remote_branch` exists to feed.
- **`upstream` is `Option`, and every missing piece collapses into `None`**: no upstream configured, upstream ref gone with its remote, branch with no commit. The UI draws no badge there, and draws none at zero either — a badge means work pending, never "verified in sync". `↑0` would be a claim the data can't back.
- **Both counters come from one call, so both are shown.** Ahead answers "what would I push"; behind answers "can I fast-forward" — and behind is the half a fetch actually moves.
- **The numbers compare two local refs**, so they're only as fresh as the last fetch. The tooltip says so ("au dernier fetch"); nothing auto-fetches.

That last point is why two reloads that used to be unnecessary now are: `commit()` reloads branches (the current branch just moved a commit ahead — the moment you look at the counter), and `reloadRemoteRefs()` reloads them too (a fetch changes `behind`, and that's *all* it changes locally). Miss either and the badge lies exactly when it matters.

`RepoStore.currentGap` derives the HEAD branch's gap for the repository bar's counters; it's `null` on a detached HEAD, where no local branch is HEAD.

### Author profiles are stored, the choice is not

A profile is a reusable identity (label + name + email), persisted in `profiles.json` next to `recent.json` and `session.json`. **Which profile a repository uses is deliberately not recorded**: applying one writes `user.name` / `user.email` into that repository's *local* Git config, and the active profile is re-derived by matching the identity back against the list.

That is what makes the feature honest. `commit()` already signs with `repo.signature()`, which reads the same config, so nothing special happens at commit time; a commit made from the terminal picks up the same identity; and no stored association can drift from what Git will actually do. Two profiles with identical name and email are interchangeable by construction, which is why matching on that pair is enough.

`Identity.is_local` is the distinction the UI needs: an identity inherited from the global config is *not* a chosen profile. The selector therefore carries a third, purely descriptive entry — "Repository identity" — for a local identity matching no profile; without it the `<select>` would fall back to its first option and claim a profile is active when none is.

The selector is a single full-width `<select>` at the top of the commit box, and it is the *whole* block: the effective identity rides in the option labels (`Label · Name`) rather than in a line beside it. Its last entry, "Manage profiles…", opens Settings — it must reset `event.currentTarget.value` first, since nothing in the derived state changed and Svelte would leave the DOM showing that entry as selected.

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
- **What is in px stays in px on purpose**: icon buttons and their glyphs (the repository bar's 48px squares, the tabs' 30px), and above all the tab bar's `min-height: 49px`, which is measured against `trafficLightPosition` and must not move with the text.

### Sidebar widths are two rem values, dragged on the border

Both side columns are resized by dragging their border, independently of each
other. The width lives in `prefs.json` like the theme and the text size — a
global interface preference, not repository state — and is applied by
`src/lib/layout.svelte.ts` writing `--sidebar-l-w` / `--sidebar-r-w` on
`<html>`. No component reads anything.

**The stored unit is the rem, not the pixel**, even though the gesture that sets
it is measured in pixels: every length in the app scales with the root
font-size, so a width frozen in pixels would truncate branch names the moment
the text size goes up. `layout.setPx()` divides by `font.rootPx` once, and that
is the only place the two units meet.

**The handle is `position: absolute` on the border, not a fourth grid column.**
The grid, the panels and their borders are exactly what they were before the
feature; nothing shifted when it was added. Its `left` / `right` is the same
variable as the column's, so it follows the drag without anyone moving it.

Three things that look incidental and aren't:

- **The body's geometry is measured once, on `pointerdown`** — same reasoning as
  the tab drag: re-reading it per pointer event is a reflow per frame for a
  value that cannot change mid-gesture. Pointer capture is there for the same
  reason too: it guarantees the `pointerup` even released outside the window.
- **The clamp is not just the rem bounds.** `SIDEBAR_W_MIN` / `_MAX` bound each
  column, but a `CENTER_MIN_PX` floor also protects the centre, which has no
  minimum width of its own — on a narrow window two otherwise legal columns
  would crush the graph. `Math.max` keeps the upper bound above the lower one,
  so on a window too narrow for all three it is the centre that gives way, not
  the setting that stops working.
- **`body.resizing` forces the cursor page-wide** (`app.css`). Pointer capture
  keeps the events on the handle, but the pointer still flies over the panels:
  without that rule the cursor would flip back to an arrow the moment it leaves
  the 9px band, and a fast drag would select text on the way.

The write is debounced: a drag emits an event per frame, only its result reaches
`prefs.json`. Arrow keys nudge the same value through the same clamp — the
handle is an ARIA window splitter (`role="separator"` + `tabindex`), which is
what the two `svelte-ignore` directives in the component are about.

### The left sidebar never scrolls — its sections do

`BranchSidebar` is a column that fits, always: `.sections` fills it entirely
(the toolbar that used to sit on top is now `RepoBar`, above the three columns). **The scroll lives in each section's
`.sec-body`**, never in the sidebar as a whole, and the section headers are
plain flow (they used to be `sticky` against the one scroller that no longer
exists).

Heights are distributed by the flex algorithm itself, not by any measuring code:
open sections are `flex: 1 1 0` — an equal share each — capped by
`max-height: max-content`, so flexbox freezes the ones smaller than their share
and hands the leftover to the others. A three-branch LOCAL therefore never
reserves a third of the column, and the long list absorbs what remains, scrolling
inside itself.

- **An open section is a `grid` (`auto minmax(0, 1fr)`), not a flex column, and
  that is load-bearing.** Written as a flex column — `flex: none` header, then
  `flex: 1 1 auto; min-height: 0` body — a section's max-content height is its
  *header's* height in WKWebView: the scrolling body contributes nothing. Every
  section then froze at ~22px with the free space falling through to the pinned
  block. Chromium resolved the same stylesheet correctly, so this is only
  visible in the app, never in a browser preview — measured in both engines,
  which now agree to the pixel.
- **`min-height: 0` on an open section is what makes any of it work.** A flex
  item's automatic minimum is its min-content size, and a scroll container does
  *not* zero out its parent's min-content: without that line the section refuses
  to shrink below its whole list and the sidebar overflows again — which is the
  exact bug this layout replaced. The real floor becomes the header; `minmax(0,
  1fr)` is what lets the body go under its intrinsic height, i.e. scroll.
- **Collapsed sections sink to the bottom** via `order: 1`, and the *first* of
  them carries `margin-top: auto` — one auto margin per collapsed section would
  split the free space and scatter them. That free space only exists when every
  open section is frozen on its content, which is precisely when the gap should
  be there.
- Section heights are **not** draggable, unlike the sidebar widths; if that ever
  changes, it belongs on `SidebarResizer`'s model, not on a new one.

### Every section in both columns is `border · [icon] title · content`

`SectionHeader.svelte` is the single component that draws a section's header, in
`BranchSidebar` (LOCAL / REMOTE / PULL REQUESTS / STASHES), `StatusPanel` (non-indexés /
indexés) and `CommitDetailsPanel` (the commit's file list). The two columns had
drifted apart on every one of these points — icon on the left only, count folded
into the label on the right, bold title one side and dim uppercase the other,
separator line owned by a differently-named class in each file. A new section now
has no style to reinvent.

- **The separator belongs to the header, not to the section.** The header *is*
  the section's first child, so a `border-top` there lands exactly where the
  section starts, and the caller never has to know it exists. `first` removes it
  where the element above already draws one — the repository bar over the left
  column, the panel header over the right one. There is
  **one** line, above: a second one under the title would box the header off from
  the content it announces.
- **Everything sits on the bar's axis, which `align-items: center` alone does not
  give you** — it centres *boxes*, and neither text nor an SVG necessarily fills
  its own. Two consequences: every SVG in the header is `display: block` (inline,
  it would sit on a baseline and its box would gain the descender space below,
  pushing the drawing half a descender up), and the chevron is a **drawn
  triangle, not the `▶` glyph** — that glyph's ink sits half a pixel high in its
  line box, and it was the one element off the axis. A path is centred on its
  `viewBox` by construction, in every font.
- **The gutter is a sum, not a value** — `--sec-gutter: calc(--sec-inset + --row-inset)`
  in `app.css`. A row's content starts after two insets (the body's, which lifts
  the hover chips off the column edge, then the row's own inside its chip), while
  the header does not sit inside `.sec-body` at all, so it must carry both. Three
  independent numbers used to live here and the header landed 3px left of its own
  rows; a section's chevron and its folders' now share one column, at any text
  size. Tree depth adds 12px per level on top, inline in the components.
- **One `Chevron.svelte` for every fold marker**, section headers included: the
  four places that drew one (section header, branch directory, remote node, file
  tree directory) had each written their own and already disagreed — 0.55rem here,
  0.6rem there — and the header's switch to a path made the mismatch plain. Its
  size is in **rem**, unlike the section icons: a chevron marks a fold *in text*
  and follows that text, where a category icon is a fixed badge.
- **Which section is "first" is computed in the component, not in CSS.** The left
  column's collapsed sections are moved to the bottom by `order`, so a
  `section + section` rule would put the line on the wrong one. `firstVisual` is
  the first *open* section — or, if everything is collapsed, the first one at all.
  Both it and `firstClosed` read a list of the sections actually **rendered** and
  name them by id, never by a fixed index: REMOTE is dropped when the repository
  has no remote branch, and an index would keep counting a section that isn't
  there — the separator and the collapsed block's margin would both land one
  section off.
- **Icons are sized from the wrapper, globally.** A snippet keeps the style scope
  of the component that *defined* it, not of the one that renders it, so
  `SectionHeader` reaches its icon through `.ic-slot :global(svg)`. That is what
  makes every section icon the same size whatever `viewBox` its author chose.
- **The count sits against the title, actions against the right edge.** The title
  button carries `flex: 1`, so it also absorbs the empty middle — the collapse
  target is the whole free width of the header, not just the words.
- **The count has no type size of its own**, and that is what aligns it: two
  nearby font sizes give two line-box heights, and centring *boxes* then leaves
  their baselines a quarter-pixel apart — enough for the number to float above
  the title. Inheriting the title's size makes the two boxes identical, in every
  engine. A `align-items: baseline` group would also work, but it leans on the
  baseline a flex item with `overflow: hidden` exposes, which is exactly the kind
  of detail WebKit and Chromium have already disagreed on here. Colour and weight
  are what tell the count from the label.
- Labels are written in normal case and capitalised by CSS, so a new section
  cannot get the casing wrong.
- **A section's text is not selectable** — `user-select: none` on the `<section>`
  itself, so it covers the header and the body in one declaration and reaches
  every child component (`BranchRow`, `FileList`) by inheritance. A section is a
  list you act on: dragging across branch names or file paths would fight the
  click and copy nothing worth having. It is deliberately **not** a rule about
  the sidebars: `CommitDetailsPanel`'s `.meta` block sits outside any section
  precisely so the commit's summary and description stay selectable — they are
  the one thing in that column anyone copies. The same holds for `SettingsView`,
  whose `<section>`s are prose and forms, hence the per-panel rule rather than a
  global `section` selector in `app.css`.

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
- **The context-menu chrome is in `app.css`, not in a component** — `.ctx-overlay`,
  `.ctx-menu`, `.ctx-head`, `.ctx-item`. Three components open menus now (the
  branch column, the PULL REQUESTS section, the repository bar) and the first two
  copies had already drifted apart: 176px against 236px of `min-width`, a hover
  that ignored `:disabled` in one of them. What stays local to a component is
  what distinguishes *its* menu — its width (`.pull-menu`, `.pr-menu`,
  `.merge-menu`, `.filter-menu`), its icons and its bullets. The classes need no
  `:global`: they are written in the components' own markup.
- **Each side column has its own width variable** — `--sidebar-l-w` / `--sidebar-r-w` (`app.css`), which `App.svelte` uses for the left and right grid tracks and `layout.svelte.ts` rewrites. Change the variables, not the grid.
- **Commands are synchronous** and hold a `std::sync::Mutex` guard. Don't make them `async` (guard would be held across await). The corollary for anything blocking — network above all — is a dedicated thread; see the fetch section above.
- Capabilities are minimal on purpose: `core:default` + `dialog:allow-open` + `core:window:allow-start-dragging` only. There is no `fs` plugin — all disk access goes through git2 in Rust. Adding a plugin requires updating `src-tauri/capabilities/default.json`. **`tauri-plugin-opener` is deliberately not registered**: it is called from Rust, so the webview gains no URL-opening command and the capability file stays as it is (see the pull requests section).

## Scope

Out of scope for now, but the architecture must not block them: rebase, hunk-level staging, per-hunk conflict resolution, tags, blame. `fetch`, `push` and `pull` **are** implemented (background thread + `repo://fetched` / `repo://pushed` / `repo://pulled`), authenticating over SSH via the agent or an on-disk key, and over HTTPS with credentials the app stores itself. Pull covers fast-forward and merge; a conflicted merge is left in the worktree for the user to resolve and commit, or to abandon. Push publishes the current branch only and sets its upstream on first push — after asking, in the upstream bar, which remote and under which name; the two force modes exist but only through the button's context menu, entry by entry, each behind an in-menu confirmation. **Pull requests are listed** in the sidebar's PULL REQUESTS section — read from GitHub's API with the host's stored token, grouped as GitKraken groups them (mine, assigned to me, awaiting my review, plus an « Others » group that only shows when it has something in it), filterable on drafts and closed PRs from the funnel in the section header, and never polled. A click selects the source branch's tip in the graph, the context menu opens the PR in the browser, and nothing else acts on them: no creation, no merge, no review. Remote branches are **listed** in the sidebar's REMOTE section — which is not
drawn at all while there is no remote branch to put in it, and comes back on the
first fetch that brings one — **walked** by the graph, whose ref badges show them, and **checked out** into a local tracking branch on double-click; a fetch refreshes the first two. Tags are still nowhere. **The open repositories are watched on disk** (`notify`, one thread for all tabs): what another tool changes shows up on its own, status and graph alike — but only by re-reading the disk, never by fetching. Nothing is auto-*pulled* either.

**The app must stay standalone**: no shelling out to `git`, `ssh`, or a credential helper. Anything Git-related is libgit2/libssh2 in-process, and credentials go through `credentials.rs`. This is what rules out `Cred::credential_helper` (it runs `git credential-<helper>`) and what any new auth path has to satisfy.

The **Settings screen** (gear, far right of the tab bar) holds *Appearance*, *Text size*, *Profiles*, then *Access tokens*: the theme and the text size are picked there (segmented controls — exclusive options, one always active), profiles are created, and tokens entered, replaced and forgotten. **Settings is a tab like any other** — `SettingsTab`, frontend-only for the same reason as `NewTab` (no repository, so no id for the backend), appended at the end of the bar, reorderable, closed by its ×, and not restored at startup. **There is only ever one**: its id is the fixed `"settings"`, and the gear (`TabsStore.openSettings()`, also what *Manage profiles…* and the PR section's link call) activates the existing tab rather than opening a second, the same rule as a repository already open. The gear is no longer a toggle — it stays lit while that tab is shown, and one leaves Settings like any tab. It lists one row per host found among the **open** tabs; the list is built on mount rather than in an `$effect`, which would loop (the load reads the rows it then rewrites, to keep manually added hosts) — and since `App.svelte` unmounts `SettingsView` whenever another tab is shown, coming back to it rebuilds the list, so a repository opened in between shows up.

**Only HTTP(S) remotes appear there — plus every host with a forge behind it**, and `RemoteInfo.uses_http` / `RemoteInfo.forge` are what decide. An SSH remote has a host too, but a token would never be used for its fetches: listing it invites a pointless entry, *unless* its API needs one, which is exactly what a GitHub remote cloned over SSH is. `uses_http` alone still stops `NoCredentials` on an SSH remote from opening the token dialog: that case gets an actionable message about ssh-agent and `~/.ssh` instead. Stashes are **created** from the commit box's Stash tab and **applied / popped / dropped** from the STASHES section (right-click or the ⋮ button). Drop is confirmed inline in the context menu (two clicks), not via a native dialog, since no confirm capability is declared.

**The repository bar** (`RepoBar`, under the tab bar and over the three columns) holds Pull / Push / Fetch, all three working, and all three disabled *together* while any of them runs (`busyRemote`) — the backend holds one reservation for all remote work. Pull and Push carry the current branch's behind/ahead counters. It is a `1fr auto 1fr` grid — repository name, then the buttons, then the report of the last operation — so the buttons sit at the middle of the *window* whatever the length of the name or of the message; `justify-content` on one row would shift them as soon as either grew. It renders only for a repository tab: the welcome screen, the new-tab page and Settings have no bar, which is why it lives in a `.repo` wrapper inside `App.svelte` rather than as a third row of `.app` — a row declared but empty would move those three views down.

**Pull runs the chosen mode, and a right-click on it opens the radio menu that only *picks* that mode** (choosing never fires a network call — a menu click that merged would be a nasty surprise). No chevron: the gesture is the one the stashes and the branches already use, and the three buttons keep the same footprint. Two consequences worth knowing:

- **The menu has to stay reachable while the button is disabled** by a running remote operation — that is exactly when one wants to change what it will do next. WebKit dispatches no mouse event on a disabled `<button>`, so the `contextmenu` handler sits on the frame around it and the disabled button drops to `pointer-events: none`, letting the click fall through to that frame.
- **Nothing on the button announces the menu any more**, the chevron having been its only sign. The tooltip's second line says it instead, and the `ContextMenu` key opens it from the keyboard, as on a stash row.

The mode is a global preference in `prefs.json`, not per-repository. The menu lists four entries and only three are live: **rebase is rendered disabled**, because it has no `PullMode` variant behind it. The enum describes what exists; the menu says what will exist.

**Push carries a right-click menu too, and it is the opposite kind of menu**: its entries *act* rather than pick a default — a force retained across pushes would be a trap, so `PushMode` travels as an argument and falls back to `"normal"` immediately. Two entries, both rewriting the remote branch, both in the danger colour, both armed by a first click and run by a second (the stash-drop pattern, for want of a declared confirm capability): *force push (with lease)*, which sends nothing if the remote moved since the last fetch, and *force push*, which does not look. They are disabled while a remote operation is running, unlike the Pull menu's entries, which only record a choice.

**A local branch is merged into another** from the sidebar — dragged onto it, or
right-clicked — fast-forwarding without a checkout when it can, switching to the
target when it must, and leaving a conflict in the worktree for the same
resolve-or-abandon path as a pull. The menu's second entry forces a merge commit
(`--no-ff`); a merge never forces anything in the `git push --force` sense — that lives on the Push button, and nowhere else. Branch *creation*, renaming and deletion are
still nowhere, and nothing rebases.

The graph is **read-only**: no checkout-from-commit, branch creation or reset from it, and no tags in the ref badges (`collect_refs` reads local and remote branches, nothing else). It does carry an "uncommitted changes" (WIP) row at the top, but that row only *selects* and *types the commit summary* — nothing is staged, discarded or committed from the graph.

**Amend has a backend but no UI**: `GitBackend::commit(.., amend)`, the command and `api.commit`'s parameter all still work and are tested, but the checkbox was removed from the commit box, so `RepoStore.commit` is only ever called with the default `false`.

AI features are intentionally absent — don't add UI for features that have no working backend. **Three destructive operations exist**, and only three: **Discard all changes** and its per-path twin **Discard changes** (the context menu of a file or directory row), both described above, and the **force push** in the Push button's context menu — the first two lose local work, the third can remove commits from a server for everybody. All are confirmed in place, in a panel or in the menu itself, since no confirm capability is declared. Nothing rewrites *local* history (reset, revert, branch deletion). A merge is the exception that isn't one: it only ever adds a commit, or moves a branch forward.
