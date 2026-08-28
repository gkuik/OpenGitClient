# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

GitLite — a lightweight desktop Git client (Tauri 2 + Rust backend, Svelte 5 frontend, libgit2 via `git2-rs`).
Goals: low memory footprint and small binary. Implemented so far: open repo → status → diff → stage/unstage → commit (+ recent repos, commit amend, local branch list with double-click checkout, commit graph with commit inspection).

The window is a tab bar (open repositories) over a three-column layout: local branches (left) · graph *or* diff (center) · file selector (right). The sidebars deliberately mirror GitKraken's layout.

**The tab bar *is* the topbar** — no logo, no "open repository" button, just the tabs and a `+` that sits in the same flow, right after the last tab. Tabs show the repository name only (no branch — the current branch is already in the status panel header). With no tab open, `WelcomeScreen` takes the whole body and is the only place the recent-repository list is reachable.

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

Session (open tabs, **their order**, and the active tab) is persisted next to `recent.json` in `session.json`. Tabs are **not** reopened by Rust at startup: the frontend replays them through `open_repository`, so a repository deleted since last run is silently dropped instead of breaking startup. Display order lives in `AppState.order` (the `HashMap` has none) and `set_tab_order` overwrites it wholesale from the frontend — but defensively: unknown ids are dropped and an open tab missing from the received list is kept at the end, so a stale list can never make a repository vanish from the session.

Tab state stays in memory while the tab is open, so returning to it is instant; only `activate()` re-runs, refreshing status and branches because the working directory may have changed on disk. **`graphScrollTop` lives in the store, not in the DOM** — all tabs share one `GraphView`, so the scroll position has to be saved and restored per tab. `GraphView` guards that restore with a `restoring` flag; do **not** reintroduce `requestAnimationFrame` there, since it is suspended while the window isn't painting and would leave the flag stuck, silently discarding every later scroll.

### Status model: 3 backend categories → 2 UI sections

The backend returns `staged` / `unstaged` / `untracked` separately. The sidebar deliberately merges `unstaged + untracked` into one "Non indexés" section (`repo.unstagedEntries`), matching GitKraken's two-section layout. Staged files are `staged=true`; everything else is `staged=false` — that boolean drives both which diff is requested (HEAD↔index vs index↔worktree) and whether the row's button stages or unstages.

After any refresh, `resyncSelection()` re-locates the selected file, because staging moves it between sections.

### Graph: backend walks, frontend lays out

The backend returns raw commits (`oid`, `parents`, `refs`) — **lane assignment is presentation, so it lives in `src/lib/graph/layout.ts`**, a pure function with vitest coverage. A future CLI backend therefore has nothing to duplicate.

`GraphView.svelte` splits rendering deliberately: **Canvas 2D draws only the lane geometry** (lines + dots), **DOM draws all text** (virtualized rows). That keeps hover/selection CSS, text selection and keyboard focus while avoiding one DOM node per commit. Two consequences that are easy to break:

- `ROW_H` is applied to rows as an **inline style, never in CSS** — it is the only thing aligning the canvas with the DOM.
- The canvas is an overlay with `z-index: 3`, i.e. **above** the rows. Row hover/selection backgrounds span the full width including the gutter; a canvas underneath would be masked by them.

Pagination is `skip`/`limit` over a revwalk rebuilt on every call (a `Revwalk` borrows the `Repository`, which is re-opened per call). Order is stable only while refs don't move, so the frontend reloads from page 0 after commit/checkout/open — but **not** after stage/unstage, which don't change history.

`DiffTarget` in the store is a discriminated union (`worktree` | `commit`): one field for both diff sources so they can't contradict each other. `selectedPath`/`selectedStaged` are derived getters over it, which is why the status-panel components needed no changes. **It also drives the centre column** — `null` → graph, set → diff — so there is no tab state to keep in sync.

Two independent selections, don't conflate them: `diffTarget` (centre) and `selectedCommitOid` (right column). Closing the diff keeps the commit open, so the next file of the same commit is one click away; closing the commit (× or re-click in the graph) also drops a `commit`-kind `diffTarget`, since its file selector would be gone.

`CenterPanel` keeps **both** views mounted and toggles `visibility`, never `display: none`: the graph must keep its scroll position and its measured height across a diff.

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
- **Commands are synchronous** and hold a `std::sync::Mutex` guard. Don't make them `async` (guard would be held across await).
- Capabilities are minimal on purpose: `core:default` + `dialog:allow-open` only. There is no `fs` plugin — all disk access goes through git2 in Rust. Adding a plugin requires updating `src-tauri/capabilities/default.json`.

## Scope

Out of scope for now, but the architecture must not block them: push/pull/fetch, remote auth, merge, hunk-level staging, conflict resolution, tags, rebase, blame. Stashes can be **applied / popped / dropped** (right-click or the ⋮ button in the STASHES section) but **not created** — `git stash save` has no UI yet. Drop is confirmed inline in the context menu (two clicks), not via a native dialog, since no confirm capability is declared.

The graph is **read-only**: no checkout-from-commit, branch creation or reset from it, and no remotes/tags in the ref badges (the backend only reads local branches + HEAD). There is no "uncommitted changes" node at the top of the history.

Destructive operations (discard changes) and AI features are intentionally absent — don't add UI for features that have no working backend.
