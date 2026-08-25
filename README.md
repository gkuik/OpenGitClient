# GitLite

Client Git desktop léger — **Tauri 2** (backend Rust) + **Svelte 5** (frontend).
Objectif : faible empreinte mémoire et binaire réduit.

Couvert à ce jour :
**ouvrir un dépôt → voir le statut → voir les diffs → stage/unstage → commit**,
plus les branches locales, les stashes (en lecture) et le **graph de commits**
avec inspection d'un commit.

## Architecture

```
src/                     Frontend Svelte 5 (Vite, SPA, runes)
  lib/api.ts             Point d'accès unique au backend (invoke typé)
  lib/types.ts           Types miroir des DTO Rust
  lib/stores/            État runes partagé (repo.svelte.ts)
  lib/graph/layout.ts    Assignation des lanes du graph (fonction pure, testée)
  lib/components/        RepoSelector, StatusPanel, FileItem, CenterPanel,
                         GraphView, CommitDetailsPanel, DiffViewer, CommitBox…
src-tauri/               Backend Rust
  src/git/mod.rs         Trait GitBackend (couche d'accès Git abstraite)
  src/git/libgit2.rs     Implémentation git2-rs (libgit2)
  src/commands.rs        Commandes Tauri (délèguent au backend)
  src/state.rs           État partagé + persistance des récents
  src/dto.rs             Structs sérialisées vers le front
  src/error.rs           AppError sérialisable (zéro panic remonté)
```

Le trait `GitBackend` isole toute la logique Git : un futur **fallback CLI** (`git`
en shell-out) sera une seconde implémentation du trait, sans toucher au reste.

## Prérequis

- **Rust** stable (`rustup`) — https://rustup.rs
- **Node.js** ≥ 18 + npm
- **macOS** : Xcode Command Line Tools (`xcode-select --install`) — nécessaire à la
  compilation de libgit2 (vendored par le crate `git2`).
- Dépendances système Tauri : voir https://tauri.app/start/prerequisites/

## Lancer en développement

```bash
npm install
npm run tauri dev
```

`tauri dev` démarre Vite (port 1420) puis compile et lance l'app Rust. Le premier
build est long (compilation de libgit2 + Tauri) ; les suivants sont rapides.

## Générer les icônes (avant `tauri build`)

Le bundle référence des icônes dans `src-tauri/icons/`. Génère-les depuis une image
source (PNG carré, idéalement 1024×1024) :

```bash
npm run tauri icon chemin/vers/logo.png
```

## Build de production

```bash
npm run tauri build
```

## Recette manuelle

1. **Ouvrir** un dépôt Git → nom + branche affichés. Un dossier non-Git → bandeau
   d'erreur « Ce dossier n'est pas un dépôt Git valide ». Le dépôt réapparaît dans « Récents ».
2. Modifier / créer / supprimer des fichiers → le statut les classe en indexés /
   modifiés / non suivis avec les bons badges (M / A / D / R / ?).
3. **Cliquer** un fichier → diff unifié coloré (+ vert / − rouge).
4. **Stage / unstage** (par fichier ou tout d'un coup) → le fichier change de section.
5. **Commit** : bouton actif seulement si des changements sont indexés et un titre saisi.
   Après commit : statut rafraîchi, champs vidés.
6. **Graph** (colonne centrale par défaut) : l'historique de toutes les branches
   locales, lanes colorées, pastilles de branches, HEAD mis en évidence,
   chargement par lots au scroll.
7. **Cliquer un commit** → son détail prend la place des changements en cours à
   droite. Cliquer un de ses fichiers → le diff `commit ↔ premier parent`
   remplace le graph au centre, le détail restant à droite pour enchaîner sur un
   autre fichier. La croix du diff ramène au graph ; celle du détail (ou un
   reclic sur le commit) rend la main aux changements en cours.

## Tests

```bash
npm test                          # algorithme de lanes (vitest)
cd src-tauri && cargo test        # backend (dépôts temporaires réels)
```

## Hors périmètre de cette itération

Push/pull/fetch, merge, stage par hunk, conflits, tags, rebase, blame. Le graph est
en lecture seule (ni checkout de commit, ni création de branche, ni remotes/tags
dans les pastilles). L'architecture est prévue pour les accueillir sans refactor.
