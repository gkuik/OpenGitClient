//! Objets de transfert (DTO) sérialisés vers le frontend.
//!
//! Chaque struct est le miroir exact d'un type TS dans `src/lib/types.ts`.
//! `rename_all = "camelCase"` fait la conversion snake_case → camelCase.

use serde::{Deserialize, Serialize};

use crate::error::AppError;

/// Statut d'un fichier, dérivé des flags libgit2.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FileStatus {
    Modified,
    Added,
    Deleted,
    Renamed,
    Typechange,
    Conflicted,
    Untracked,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub path: String,
    /// Ancien chemin en cas de renommage, sinon `None`.
    pub old_path: Option<String>,
    pub status: FileStatus,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoStatus {
    pub staged: Vec<FileEntry>,
    pub unstaged: Vec<FileEntry>,
    pub untracked: Vec<FileEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoInfo {
    /// Chemin canonique du dépôt. Sert aussi d'**identifiant d'onglet** : c'est
    /// la valeur à repasser en `repoId` dans toutes les autres commandes.
    pub path: String,
    pub name: String,
    pub branch: Option<String>,
    pub is_detached: bool,
    pub head: Option<String>,
    /// Fusion en cours (conflits à résoudre, ou commit de fusion à créer).
    /// Le frontend s'en sert pour afficher la sortie de secours : sans elle,
    /// un conflit laisserait l'utilisateur coincé dans l'application.
    pub merging: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DiffLineKind {
    Context,
    Addition,
    Deletion,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    pub kind: DiffLineKind,
    pub content: String,
    pub old_lineno: Option<u32>,
    pub new_lineno: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiffHunk {
    pub header: String,
    pub lines: Vec<DiffLine>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub path: String,
    pub is_binary: bool,
    pub hunks: Vec<DiffHunk>,
}

/// D'où lire un fichier : la version que le diff affiché compare. Le même
/// discriminant que `DiffTarget` côté frontend, pour qu'un aperçu montre
/// toujours ce que le diff montre — jamais le disque quand on regarde l'index.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum FileSource {
    /// Le fichier tel qu'il est sur le disque (diff index ↔ working directory).
    Worktree,
    /// La version indexée (diff HEAD ↔ index).
    Index,
    /// La version dans un commit donné.
    Commit { oid: String },
}

/// Contenu d'un fichier, pour l'aperçu rendu.
///
/// `text` est absent quand il n'y a rien à rendre : fichier binaire, absent de
/// la source (supprimé, ou jamais dans ce commit), ou trop gros pour un aperçu
/// — `binary` distingue le premier cas, qui mérite un mot différent.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    pub text: Option<String>,
    pub binary: bool,
}

#[derive(Debug, Serialize)]
pub struct CommitResult {
    pub oid: String,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct RecentRepo {
    pub path: String,
    pub name: String,
}

/// Session à restaurer au lancement : onglets ouverts et onglet actif.
///
/// Les entrées sont des chemins canoniques, qui servent aussi d'identifiants
/// d'onglet. Le frontend les rouvre un par un et ignore ceux qui échouent.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub tabs: Vec<String>,
    pub active: Option<String>,
}

/// Branche locale. `name` est le nom complet ("fix/EDIAG6-811"), qui sert aussi
/// de clé de checkout ; le frontend le découpe sur "/" pour l'arborescence.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchEntry {
    pub name: String,
    /// Vrai si c'est la branche actuellement checkoutée.
    pub is_head: bool,
    /// Commit de tête. Vide si la branche n'a pas encore de commit (HEAD non né) ;
    /// le frontend s'en sert pour sélectionner ce commit dans le graph.
    pub oid: String,
    /// Branche amont et écart avec elle. **Absent** quand la branche n'en suit
    /// aucune : « rien à comparer » n'est pas « à jour », et le frontend
    /// n'affiche de compteur que dans le premier cas.
    pub upstream: Option<Upstream>,
}

/// Branche amont d'une branche locale, et l'écart qui l'en sépare.
///
/// Les deux compteurs viennent d'un seul appel à `graph_ahead_behind` et ne
/// valent que pour l'état **local** des références : ils datent du dernier
/// fetch, pas de ce que le serveur contient à l'instant présent.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Upstream {
    /// Nom de la branche amont ("origin/main").
    pub name: String,
    /// Commits que le local a en plus : ce qu'un push enverrait.
    pub ahead: usize,
    /// Commits que l'amont a en plus : ce qu'un pull ramènerait.
    pub behind: usize,
}

/// Branche distante (`refs/remotes/**`).
///
/// `name` est le nom complet, distant inclus ("origin/feature/x") ; il commence
/// toujours par `remote` suivi d'un "/", ce dont le frontend se sert pour
/// regrouper les branches par distant. Pas de `is_head` ici : aucune branche
/// distante n'est checkoutée, HEAD ne pointe que sur du local.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteBranchEntry {
    pub name: String,
    /// Distant auquel elle appartient ("origin").
    pub remote: String,
    /// Commit de tête.
    pub oid: String,
}

/// Nature d'une référence pointant sur un commit du graph.
///
/// Les tags ne sont pas encore lus par le backend ; branches locales et
/// distantes le sont, et se distinguent ici pour que la pastille le montre.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GraphRefKind {
    Head,
    LocalBranch,
    RemoteBranch,
}

/// Référence (branche, HEAD) attachée à un commit, pour l'affichage des pastilles.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphRef {
    pub name: String,
    pub kind: GraphRefKind,
}

/// Commit tel que consommé par le graph.
///
/// On transporte les `parents` bruts : l'assignation des lanes (présentation) est
/// faite côté frontend, ce qui garde le trait `GitBackend` purement Git.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphCommit {
    pub oid: String,
    /// OID abrégé (7 caractères), pour l'affichage.
    pub short_oid: String,
    pub summary: String,
    pub author_name: String,
    /// Date d'auteur, en secondes Unix UTC.
    pub timestamp: i64,
    pub parents: Vec<String>,
    pub refs: Vec<GraphRef>,
}

/// Page d'historique. `has_more` évite au frontend un aller-retour supplémentaire
/// pour découvrir qu'il est arrivé au bout.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitGraphPage {
    pub commits: Vec<GraphCommit>,
    pub has_more: bool,
}

/// Détail complet d'un commit, avec la liste des fichiers qu'il modifie.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitDetails {
    pub oid: String,
    pub short_oid: String,
    pub summary: String,
    /// Corps du message (tout ce qui suit la ligne vide), sinon `None`.
    pub body: Option<String>,
    pub author_name: String,
    pub author_email: String,
    pub timestamp: i64,
    pub parents: Vec<String>,
    /// Fichiers modifiés par rapport au premier parent. On réutilise `FileEntry`
    /// pour que le frontend affiche les mêmes badges que dans le panneau de statut.
    pub files: Vec<FileEntry>,
}

/// Entrée de la pile de stash (`stash@{index}`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StashEntry {
    /// Position dans la pile — 0 = le plus récent.
    pub index: usize,
    /// Message brut tel que stocké par Git.
    pub message: String,
    /// Branche sur laquelle le stash a été créé, extraite du message.
    pub branch: Option<String>,
    pub oid: String,
}

/// Référence distante déplacée par un `fetch`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchedRef {
    /// Nom complet de la référence ("refs/remotes/origin/main").
    pub name: String,
    /// OID avant le fetch ; `None` si la référence vient d'apparaître.
    pub old_oid: Option<String>,
    pub new_oid: String,
}

/// Résultat d'un `fetch`. `updated` vide = le distant n'a pas bougé.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchReport {
    /// Dépôt distant réellement interrogé (résolu si l'appel n'en nommait aucun).
    pub remote: String,
    pub updated: Vec<FetchedRef>,
}

/// Charge utile de l'événement `repo://fetched`.
///
/// Le fetch tourne sur un thread dédié : son résultat ne peut pas être la valeur
/// de retour de la commande, il remonte par cet événement. Exactement l'un des
/// deux champs est renseigné.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchEvent {
    /// Onglet concerné — le frontend en a besoin pour router le résultat, un
    /// fetch pouvant aboutir alors qu'un autre onglet est affiché.
    pub repo_id: String,
    pub report: Option<FetchReport>,
    pub error: Option<AppError>,
}

/// Résultat d'un push.
///
/// Il n'y a pas de compteur de commits envoyés : le nombre exact est celui que
/// la pastille `↑` de la branche affichait avant, et elle retombe à zéro au
/// rechargement — le dire deux fois inviterait les deux valeurs à diverger.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PushReport {
    /// Distant réellement poussé (résolu par le backend si non précisé).
    pub remote: String,
    /// Branche poussée — toujours la branche courante.
    pub branch: String,
    /// Nom de la branche sur le distant. Égal à `branch` sauf si la barre
    /// d'upstream en a demandé un autre au premier push ; le compte rendu le
    /// dit alors, parce que « publiée » ne suffit plus à dire où.
    pub target: String,
    /// Vrai si le suivi vient d'être posé, c'est-à-dire au premier push de la
    /// branche (`push -u`).
    pub upstream_set: bool,
    /// Vrai si la branche distante a été **réécrite** plutôt qu'avancée. Le
    /// compte rendu doit le dire : « publiée » et « réécrite » ne racontent pas
    /// le même événement à qui relira l'historique du distant.
    pub forced: bool,
}

/// Charge utile de l'événement `repo://pushed`, jumelle de [`FetchEvent`] : le
/// push tourne lui aussi sur un thread dédié.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PushEvent {
    pub repo_id: String,
    pub report: Option<PushReport>,
    pub error: Option<AppError>,
}

/// Ce que le bouton Pull exécute, choisi dans son menu déroulant et persisté.
///
/// Il n'y a **pas** de variante `Rebase` : elle n'aurait aucune implémentation
/// derrière elle. Le menu affiche bien l'entrée, mais désactivée — le type, lui,
/// ne décrit que ce qui existe.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PullMode {
    /// Récupère les références de **tous** les distants, sans rien intégrer.
    FetchAll,
    /// N'intègre que par avance rapide ; en cas de divergence, ne touche à rien.
    FastForwardOnly,
    /// Avance rapide si possible, fusion sinon.
    FastForwardOrMerge,
}

impl Default for PullMode {
    /// Le défaut de GitKraken, et le geste le plus courant.
    fn default() -> Self {
        Self::FastForwardOrMerge
    }
}

/// Comment le push traite la branche distante.
///
/// Contrairement à [`PullMode`], ce n'est **pas** une préférence persistée, et
/// c'est délibéré : un force retenu d'une fois sur l'autre transformerait le
/// bouton Push en piège. Le mode est choisi au coup par coup, dans le menu
/// contextuel du bouton, et retombe à [`PushMode::Normal`] aussitôt après.
///
/// Les deux forces ne diffèrent que par une vérification, mais elle change tout :
/// `ForceWithLease` refuse d'envoyer si la branche distante n'est plus là où le
/// dernier fetch l'a vue — c'est-à-dire si quelqu'un a poussé entre-temps —, là
/// où `Force` écrase ce qui s'y trouve sans regarder.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PushMode {
    /// `git push` : le distant refuse tout ce qui n'est pas une avance rapide.
    #[default]
    Normal,
    /// `git push --force-with-lease` : réécrit, mais seulement si le distant est
    /// resté sur la référence de suivi que nous connaissons.
    ForceWithLease,
    /// `git push --force` : réécrit quoi qu'il y ait en face.
    Force,
}

/// Thème de l'interface, choisi dans les paramètres et persisté.
///
/// `System` n'est **pas** une troisième palette : c'est l'absence de choix, que
/// le frontend résout en clair ou sombre selon `prefers-color-scheme`. C'est
/// aussi ce que reçoit la fenêtre native — `set_theme(None)` la laisse suivre le
/// système, là où `Some(...)` la fige.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ThemeMode {
    #[default]
    System,
    Light,
    Dark,
}

/// Taille du corps de texte, en **points** — l'unité des recommandations
/// d'Apple, et celle du pixel CSS à l'échelle 1× de macOS. 13 pt est la taille
/// du texte système sur macOS, donc le défaut ici.
///
/// La préférence voyage en nombre plutôt qu'en énumération, et c'est délibéré :
/// une valeur hors bornes se ramène dans l'intervalle (voir
/// `AppState::font_size`), là où une variante inconnue ferait échouer la lecture
/// de *tout* `prefs.json`, emportant le thème et le mode du Pull avec elle.
pub const FONT_SIZE_DEFAULT: u8 = 13;
pub const FONT_SIZE_MIN: u8 = 11;
pub const FONT_SIZE_MAX: u8 = 18;

/// Largeurs des deux colonnes latérales, en **rem**.
///
/// Le rem plutôt que le pixel, pour la même raison que `--sidebar-w` l'était
/// déjà : toutes les longueurs de l'interface étant relatives à la racine, une
/// largeur figée en pixels tronquerait les noms de branches dès qu'on grossit
/// le texte. Le glissement, lui, se mesure en pixels — c'est le frontend qui
/// divise par la taille de la racine avant d'envoyer.
///
/// Comme la taille du texte, la valeur voyage en nombre et se ramène dans ses
/// bornes des deux côtés : `prefs.json` est éditable à la main, et une colonne
/// de 400 rem masquerait l'application entière, réglage compris.
pub const SIDEBAR_W_DEFAULT: f32 = 18.9;
pub const SIDEBAR_W_MIN: f32 = 12.0;
pub const SIDEBAR_W_MAX: f32 = 40.0;

/// Les deux largeurs voyagent ensemble : elles se lisent et s'écrivent d'un
/// bloc, et c'est ce qui garantit qu'un `prefs.json` ne peut pas en contenir
/// une sans l'autre.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SidebarWidths {
    pub left: f32,
    pub right: f32,
}

impl Default for SidebarWidths {
    fn default() -> Self {
        Self {
            left: SIDEBAR_W_DEFAULT,
            right: SIDEBAR_W_DEFAULT,
        }
    }
}

impl SidebarWidths {
    /// Ramène les deux largeurs dans les bornes. `is_finite` n'est pas une
    /// précaution de style : `f32::clamp` laisse passer un NaN, qui donnerait
    /// une `grid-template-columns` invalide — donc une colonne disparue.
    pub fn clamped(self) -> Self {
        Self {
            left: clamp_sidebar(self.left),
            right: clamp_sidebar(self.right),
        }
    }
}

fn clamp_sidebar(w: f32) -> f32 {
    if w.is_finite() {
        w.clamp(SIDEBAR_W_MIN, SIDEBAR_W_MAX)
    } else {
        SIDEBAR_W_DEFAULT
    }
}

/// Résultat d'un pull : ce qui a été récupéré, puis ce qui en a été fait.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullReport {
    /// Distants interrogés — un seul, sauf en `FetchAll`.
    pub remotes: Vec<String>,
    /// Références distantes déplacées par le fetch qui précède l'intégration.
    pub updated: Vec<FetchedRef>,
    /// Branche tirée. Absente en `FetchAll`, qui n'intègre rien.
    pub branch: Option<String>,
    /// Vrai si le pull a basculé sur la branche tirée : une branche non
    /// courante qui ne pouvait pas avancer rapidement a dû être checkoutée
    /// pour recevoir la fusion. Le frontend ne peut pas le deviner.
    pub switched: bool,
    pub outcome: PullOutcome,
}

/// Ce qu'un pull a fait du côté local.
///
/// Une divergence et un conflit ne sont **pas** des erreurs : le fetch qui les
/// précède a réussi et a déplacé des références, qu'il faut recharger. Les
/// remonter en `AppError` perdrait cette moitié-là du résultat.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum PullOutcome {
    /// Mode `FetchAll` : rien n'est intégré, par définition.
    FetchedOnly,
    /// L'amont n'a rien que le local n'ait déjà.
    UpToDate,
    /// Avance rapide : la branche a simplement été déplacée.
    FastForwarded { commits: usize },
    /// Fusion créée, sans conflit.
    Merged { commits: usize },
    /// Fusion interrompue par des conflits : le working directory les porte, à
    /// l'utilisateur de les résoudre puis de committer (ou d'abandonner).
    Conflicted { files: Vec<String> },
    /// Les deux côtés ont divergé et le mode choisi refuse de fusionner.
    Diverged { ahead: usize, behind: usize },
}

/// Ce que le menu de fusion propose. Deux entrées, deux variantes : le type ne
/// décrit que ce qui existe (pas de `Squash`, qui n'a rien derrière lui).
///
/// Contrairement à [`PullMode`], ce n'est **pas** une préférence persistée : le
/// choix se fait au coup par coup dans le menu, parce qu'il ne veut pas dire la
/// même chose selon la branche qu'on fusionne — un correctif versé dans une
/// branche d'intégration n'appelle pas le même geste qu'une branche de travail
/// qu'on veut voir dans l'historique.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MergeMode {
    /// Avance rapide quand la cible est strictement en retard, fusion sinon.
    FastForwardOrMerge,
    /// Toujours un commit de fusion, même quand une avance rapide suffirait
    /// (`git merge --no-ff`) : la fusion reste visible dans l'historique.
    NoFastForward,
}

/// Résultat d'une fusion de branche à branche — le glisser-déposer et le menu
/// contextuel de la section LOCAL, pas le pull.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeReport {
    /// Branche fusionnée (celle qu'on a déposée, ou la branche courante).
    pub source: String,
    /// Branche qui reçoit la fusion (celle sur laquelle on a déposé).
    pub target: String,
    /// HEAD a-t-il changé de branche ? Une avance rapide sur une branche qui
    /// n'est pas la courante ne déplace qu'une référence : ni HEAD ni le working
    /// directory ne bougent. Une vraie fusion, elle, doit basculer sur la cible —
    /// Git n'écrit pas dans une branche inactive — et y reste.
    pub switched: bool,
    pub outcome: MergeOutcome,
}

/// Ce qu'une fusion a fait de la cible.
///
/// Un conflit n'est **pas** une erreur, pour la même raison que dans
/// [`PullOutcome`] : le dépôt est en état de fusion, avec les fichiers à
/// résoudre dans le working directory, et le frontend doit pouvoir le dire.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum MergeOutcome {
    /// La cible contient déjà tout ce que la source apporte.
    UpToDate,
    /// La cible était strictement en retard : sa référence a simplement avancé.
    FastForwarded { commits: usize },
    /// Commit de fusion créé, sans conflit.
    Merged { commits: usize },
    /// Fusion interrompue par des conflits : à l'utilisateur de les résoudre puis
    /// de committer (ou d'abandonner), depuis la cible sur laquelle on est resté.
    Conflicted { files: Vec<String> },
}

/// Charge utile de l'événement `repo://pulled`, jumelle de [`FetchEvent`].
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullEvent {
    pub repo_id: String,
    pub report: Option<PullReport>,
    pub error: Option<AppError>,
}

/// Charge utile de l'événement `repo://changed` : le dépôt a bougé sur le
/// disque sous l'effet d'un autre outil (éditeur, terminal, autre client Git).
///
/// Deux drapeaux plutôt qu'une portée unique, parce que les deux recharges
/// n'ont pas le même prix et qu'un même lot peut concerner les deux : écrire un
/// fichier ne touche pas aux références, mais un `git checkout` fait les deux.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeEvent {
    /// Onglet concerné : le changement peut viser un dépôt qui n'est pas affiché.
    pub repo_id: String,
    /// Le working directory ou l'index ont changé → statut à relire.
    pub worktree: bool,
    /// Les références ont bougé (`HEAD`, `refs/**`, état de fusion) → branches,
    /// graph et infos du dépôt à recharger.
    pub refs: bool,
}

/// Dépôt distant d'un onglet, tel que le frontend en a besoin pour demander des
/// identifiants : `host` est la clé sous laquelle ils sont rangés.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteInfo {
    pub name: String,
    pub url: String,
    /// `None` si l'URL n'expose pas d'hôte exploitable (chemin local).
    pub host: Option<String>,
    /// Des identifiants sont-ils déjà enregistrés pour cet hôte ?
    pub has_credentials: bool,
    /// Le distant est-il joint en HTTP(S) ? C'est ce qui décide si un jeton
    /// stocké s'applique : en SSH l'authentification passe par une clé, et
    /// proposer d'y saisir un mot de passe n'aurait aucun effet.
    pub uses_http: bool,
    /// Forge reconnue derrière ce distant, s'il y en a une.
    ///
    /// Elle dit deux choses au frontend : que la section PULL REQUESTS a
    /// quelque chose à afficher, et qu'un jeton vaut la peine d'être enregistré
    /// pour cet hôte **même en SSH** — l'API en réclame un là où un fetch se
    /// contente d'une clé. Sans ce champ, un dépôt cloné en SSH n'apparaîtrait
    /// pas dans la liste des Réglages, filtrée sur `uses_http`.
    pub forge: Option<crate::forge::ForgeKind>,
}

/// Profil d'auteur : une identité Git réutilisable d'un dépôt à l'autre.
///
/// Sérialisé dans `profiles.json` à côté des récents et de la session, d'où le
/// `Deserialize`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    /// Identifiant stable, généré à la création — le libellé, lui, peut changer.
    pub id: String,
    /// Nom court affiché dans le sélecteur ("Perso", "Travail"…).
    pub label: String,
    pub name: String,
    pub email: String,
}

/// Identité sous laquelle un dépôt commite.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Identity {
    pub name: Option<String>,
    pub email: Option<String>,
    /// Définie dans le dépôt lui-même plutôt qu'héritée de la config globale.
    /// C'est ce qui distingue « profil choisi » de « valeur par défaut ».
    pub is_local: bool,
}

// ── Pull requests ───────────────────────────────────────────────────────────

/// Une pull request, telle que la section de la barre latérale l'affiche.
///
/// Les trois drapeaux `mine` / `assigned` / `reviewing` sont **des faits, pas des
/// groupes** : ils disent le rapport entre la PR et l'utilisateur du jeton, et
/// c'est le frontend qui en tire les trois listes de la section — de la même
/// façon qu'il tire les couloirs du graph d'une simple liste de commits. Une
/// même PR peut porter deux de ces drapeaux, et n'en porter aucun : elle est
/// alors dans le dépôt sans être dans aucun des trois groupes.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestEntry {
    pub number: u64,
    pub title: String,
    /// Auteur, tel que la forge le nomme. Chaîne vide si le compte a disparu.
    pub author: String,
    /// Branche d'où vient la PR — celle qu'un clic essaie de retrouver en local.
    pub source_branch: String,
    /// Branche qui recevrait la fusion.
    pub target_branch: String,
    pub draft: bool,
    /// Fermée (fusionnée ou abandonnée). Toujours faux tant que le filtre
    /// « fermées » du menu n'est pas coché : elles ne sont pas demandées.
    pub closed: bool,
    /// Fermée **par une fusion**, ce que `closed` seul ne dit pas.
    pub merged: bool,
    /// Page web de la PR : c'est elle qu'ouvre le menu contextuel.
    pub url: String,
    /// Dernière mise à jour, en ISO 8601 tel que la forge la renvoie.
    pub updated_at: String,
    /// Ouverte par l'utilisateur du jeton.
    pub mine: bool,
    /// Assignée à l'utilisateur du jeton.
    pub assigned: bool,
    /// Sa revue est demandée et pas encore rendue.
    pub reviewing: bool,
}

/// Réponse d'un chargement de pull requests.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestReport {
    /// Hôte interrogé — la clé du jeton, que le message d'erreur nomme.
    pub host: String,
    /// Dépôt tel que la forge le nomme (`owner/repo`).
    pub repo: String,
    /// Identité du jeton : c'est par rapport à elle que « mes » PR sont miennes.
    pub viewer: String,
    pub pull_requests: Vec<PullRequestEntry>,
}

/// Charge utile de l'événement `repo://pull-requests`, jumelle de [`FetchEvent`].
///
/// Comme le fetch, l'appel part sur un thread dédié — mais pour une autre raison
/// que la sienne : il ne touche à aucune référence, il ne prend donc **pas** la
/// réservation réseau du dépôt et ne gèle ni Pull, ni Push, ni Fetch.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestEvent {
    pub repo_id: String,
    pub report: Option<PullRequestReport>,
    pub error: Option<AppError>,
}
