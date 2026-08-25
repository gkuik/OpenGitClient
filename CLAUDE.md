# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

GitLite — a lightweight desktop Git client (Tauri 2 + Rust backend, Svelte 5 frontend, libgit2 via `git2-rs`).
Goals: low memory footprint and small binary. Implemented so far: open repo → status → diff → stage/unstage → commit (+ recent repos, commit amend, local branch list with double-click checkout, commit graph with commit inspection).

Three-column layout: local branches (left) · graph *or* diff (center) · file selector (right). The sidebars deliberately mirror GitKraken's layout.

**There are no tabs.** The centre shows the graph until a file is opened; the diff then replaces it, and the diff's × brings the graph back. The right column is always the file selector for whatever is being looked at: the commit's file list when a commit is selected, otherwise the working-directory changes + commit box. Selecting a commit therefore hides the commit box — deliberate, to give the graph and diff the full width.

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
- `src/lib/stores/repo.svelte.ts` is a single shared runes-based store instance (`export const repo`). It owns repo/status/diff/selection/view state. Every mutating action funnels through the private `run()` helper, which refreshes status and captures errors.
- Frontend is plain Vite + Svelte 5 (runes), **not** SvelteKit — no SSR, no routing.

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

Out of scope for now, but the architecture must not block them: push/pull/fetch, remote auth, merge, hunk-level staging, conflict resolution, tags, rebase, blame. Stashes are **listed only** — creating/applying/dropping them is not implemented.

The graph is **read-only**: no checkout-from-commit, branch creation or reset from it, and no remotes/tags in the ref badges (the backend only reads local branches + HEAD). There is no "uncommitted changes" node at the top of the history.

Destructive operations (discard changes) and AI features are intentionally absent — don't add UI for features that have no working backend.
