# OpenGitClient

Client Git desktop léger — **Tauri 2** (backend Rust) + **Svelte 5** (frontend),
Git via **libgit2** (`git2-rs`). Objectif : faible empreinte mémoire et binaire
réduit. L'application est **autonome** : elle ne lance jamais `git`, `ssh` ni un
credential helper — tout passe par libgit2 / libssh2, liés au binaire.

L'interface est en anglais (traduisible), la disposition reprend celle de
GitKraken : branches à gauche, graph ou diff au centre, fichiers à droite.

## Fonctionnalités

- **Plusieurs dépôts**, un onglet chacun, réordonnables par glisser ; la session
  (onglets, ordre, onglet actif) est restaurée au lancement. Le `+` ouvre une page
  « New tab » : ouvrir un dépôt local ou un dépôt récent.
- **Statut, diff, stage / unstage, commit** : fichiers en arbre ou en liste, diff
  unifié, rendu Markdown au choix pour les `.md`.
- **Discard** d'un fichier, d'un dossier ou de tout le répertoire de travail, avec
  confirmation sur place.
- **Stash** : créé depuis l'onglet Stash de la zone de commit, appliqué / pop /
  supprimé depuis la section STASHES.
- **Graph de commits** : toutes les branches locales et distantes, lanes colorées,
  pastilles de branches, ligne « WIP » pour les changements en cours, inspection
  d'un commit et de ses fichiers.
- **Branches** locales et distantes : checkout par double-clic (une branche
  distante crée sa branche de suivi), compteurs ahead / behind par rapport à
  l'upstream, **merge** par glisser-déposer d'une branche sur une autre ou par clic
  droit (fast-forward ou `--no-ff`).
- **Fetch, pull, push** en arrière-plan, sans bloquer les autres onglets. Pull en
  fast-forward seul ou avec merge ; un conflit est laissé dans le répertoire de
  travail, à résoudre et commiter, ou à abandonner. Au premier push, l'application
  demande sur quel remote et sous quel nom publier. Force push (avec ou sans lease)
  depuis le clic droit sur Push, avec confirmation.
- **Authentification** : SSH via l'agent ou une clé de `~/.ssh`, HTTPS avec des
  identifiants que l'application range elle-même dans le trousseau macOS.
- **Pull requests GitHub** (github.com et GitHub Enterprise) listées en lecture
  seule, groupées comme dans GitKraken.
- **Surveillance du disque** : ce qu'un autre outil modifie dans le dépôt apparaît
  tout seul, sans aucun fetch automatique.
- **Profils d'auteur**, **thème** clair / sombre / système, **taille du texte** et
  largeur des colonnes réglables.

## Architecture

```
src/                         Frontend Svelte 5 (Vite, SPA, runes — pas de SvelteKit)
  lib/api.ts                 Seul point d'accès au backend (invoke typé)
  lib/types.ts               Miroir des DTO Rust, maintenu à la main
  lib/stores/repo.svelte.ts  RepoStore (un par onglet) + TabsStore
  lib/graph/                 Lanes du graph et regroupement des pastilles (purs, testés)
  lib/locales/en.ts          Catalogue des textes de l'interface, lus via t()
  lib/components/            Composants de l'interface
src-tauri/                   Backend Rust
  src/git/mod.rs             Trait GitBackend (couche d'accès Git abstraite)
  src/git/libgit2.rs         Implémentation git2-rs (libgit2)
  src/forge/                 Trait ForgeBackend + implémentation GitHub
  src/commands.rs            Commandes Tauri (délèguent au backend)
  src/state.rs               Dépôts ouverts, récents, session, profils, préférences
  src/credentials.rs         Identifiants HTTPS et jetons (trousseau macOS)
  src/watcher.rs             Surveillance des dépôts ouverts sur le disque
  src/dto.rs                 Structs sérialisées vers le front
  src/error.rs               AppError sérialisable (aucun panic ne remonte)
```

Le trait `GitBackend` isole toute la logique Git : un autre backend serait une
seconde implémentation du trait, sans toucher aux commandes ni au frontend. Le
détail des choix de conception est dans [`CLAUDE.md`](CLAUDE.md).

## Prérequis

- **Rust** stable, via `rustup` — par exemple `brew install rustup` puis
  `rustup default stable`, ou https://rustup.rs
- **Node.js** ≥ 18 + npm
- **macOS** : Xcode Command Line Tools (`xcode-select --install`), nécessaires à
  la compilation de libgit2 (vendored par le crate `git2`).
- Dépendances système Tauri : https://tauri.app/start/prerequisites/

## Lancer en développement

```bash
npm install
npm run tauri dev
```

`tauri dev` démarre Vite (port 1420) puis compile et lance l'app Rust. Le premier
build est long (compilation de libgit2 + Tauri) ; les suivants sont rapides.

## Build de production

```bash
npm run tauri build
```

## Icônes

La source est `src-tauri/icons/app-icon.png` (1024×1024, tuile arrondie au
format macOS). Après l'avoir modifiée, régénérer toutes les tailles :

```bash
npm run tauri icon src-tauri/icons/app-icon.png
```

## Tests

```bash
npm test                          # modules purs du frontend (vitest)
npm run check                     # vérification de types (svelte-check)
cd src-tauri && cargo test        # backend (dépôts temporaires réels)
```

## Hors périmètre pour l'instant

Rebase, stage par hunk, résolution de conflits hunk par hunk, tags, blame ;
création, renommage et suppression de branches ; tout ce qui réécrit l'historique
local (reset, revert). Le graph est en lecture seule, les pull requests aussi (ni
création, ni merge, ni review). L'architecture est prévue pour accueillir ces
fonctionnalités sans refactor.
