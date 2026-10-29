//! Implémentation GitHub de [`ForgeBackend`](super::ForgeBackend).
//!
//! **Une requête par chargement.** GitKraken range les PR en trois groupes (les
//! miennes, celles qui me sont assignées, celles qui attendent ma revue) ; l'API
//! de recherche saurait répondre à chacun, mais ce serait trois appels sur un
//! quota bien plus serré (30 requêtes/minute) pour un résultat qu'une seule
//! liste contient déjà. On demande donc les PR du dépôt et l'identité du jeton,
//! et **le classement se fait sur les données** — côté frontend, comme la mise
//! en page du graph : le backend rapporte, il ne présente pas.
//!
//! **GraphQL plutôt que REST, pour l'état de revue.** La liste REST des PR ne
//! dit pas si une PR est approuvée ou si des modifications sont demandées : il
//! faudrait un `GET …/reviews` par PR, plus les checks de chaque commit. Une
//! seule requête GraphQL rapporte tout — l'identité du jeton (`viewer`) avec —,
//! là où REST en demandait deux sans rien de tout ça. Le chargement accompagne
//! désormais chaque fetch, auto-fetch compris : ce qui coûtait une requête de
//! plus par PR se serait payé chaque minute.

use std::time::Duration;

use serde::Deserialize;

use super::{ForgeAccount, ForgeBackend, ForgeRemote};
use crate::dto::{ChecksState, PullRequestEntry, PullRequestReport, ReviewState};
use crate::error::AppError;

/// GitHub exige un `User-Agent` ; une requête sans en-tête est refusée en 403.
const USER_AGENT: &str = "OpenGitClient";

/// Version d'API épinglée : une réponse dont la forme change sous nos pieds
/// casserait la désérialisation sans prévenir.
const API_VERSION: &str = "2022-11-28";

/// Plafond d'une page. Au-delà, il faudrait paginer — mais une section de barre
/// latérale n'affiche pas cent PR, et les plus fraîches sont en tête.
const PER_PAGE: usize = 100;

/// Plafond des listes imbriquées (assignés, relecteurs, revues). Une PR n'en
/// compte jamais autant, et GraphQL facture la requête à la taille demandée.
const PER_PR: usize = 20;

/// La requête du chargement.
///
/// Deux sources pour l'état de revue, parce qu'aucune ne suffit seule :
/// `reviewDecision` est l'avis de GitHub, mais il reste `null` sur une branche
/// cible qui n'exige pas de revue — le cas de presque tous les dépôts
/// personnels, où une approbation existe pourtant bel et bien. On le complète
/// alors avec les dernières revues tranchées (`latestOpinionatedReviews`,
/// approuvée ou modifications demandées, une par relecteur, de ceux qui ont le
/// droit d'écrire — les seules qui comptent pour fusionner).
const PULL_REQUESTS_QUERY: &str = r#"
query($owner: String!, $name: String!, $first: Int!, $nested: Int!) {
  viewer { login }
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, first: $first, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes {
        number
        title
        url
        updatedAt
        state
        merged
        isDraft
        author { login }
        headRefName
        baseRefName
        assignees(first: $nested) { nodes { login } }
        reviewRequests(first: $nested) {
          nodes { requestedReviewer { ... on User { login } } }
        }
        reviewDecision
        latestOpinionatedReviews(first: $nested, writersOnly: true) { nodes { state } }
        commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
      }
    }
  }
}
"#;

/// Un appel réseau qui ne répond pas ne doit pas laisser le thread en vie
/// indéfiniment (le frontend, lui, reste bloqué sur « Chargement… »).
const TIMEOUT: Duration = Duration::from_secs(20);

pub struct GitHub {
    remote: ForgeRemote,
    /// Jeton d'accès de l'hôte. Il n'a pas de `Debug`, pas de getter, et ne sert
    /// qu'à remplir l'en-tête `Authorization` — même sens unique que le secret
    /// HTTPS confié à libgit2.
    token: String,
}

impl GitHub {
    pub fn new(remote: ForgeRemote, token: String) -> Self {
        Self { remote, token }
    }

    /// Requête GraphQL + désérialisation de sa réponse, en-têtes
    /// d'authentification compris.
    fn graphql<T: serde::de::DeserializeOwned>(
        &self,
        query: &str,
        variables: serde_json::Value,
    ) -> Result<GraphQlResponse<T>, AppError> {
        let mut response = agent()
            .post(&self.remote.graphql_url())
            .header("Authorization", &format!("Bearer {}", self.token))
            .send_json(serde_json::json!({ "query": query, "variables": variables }))
            .map_err(|e| map_error(e, &self.remote.host, Some(&self.remote.slug())))?;
        read_json(&mut response)
    }
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_global(Some(TIMEOUT))
        .user_agent(USER_AGENT)
        .build()
        .into()
}

/// GET authentifié, réponse brute : `account` en lit un en-tête, pas seulement
/// le corps.
fn send(
    agent: &ureq::Agent,
    url: &str,
    token: &str,
) -> Result<ureq::http::Response<ureq::Body>, ureq::Error> {
    agent
        .get(url)
        .header("Authorization", &format!("Bearer {token}"))
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", API_VERSION)
        .call()
}

fn read_json<T: serde::de::DeserializeOwned>(
    response: &mut ureq::http::Response<ureq::Body>,
) -> Result<T, AppError> {
    response
        .body_mut()
        .read_json::<T>()
        .map_err(|e| AppError::Network(format!("Unreadable GitHub response: {e}")))
}

/// Traduit l'erreur de transport en erreur applicative.
///
/// Les trois cas séparés ici ne se règlent pas de la même façon : un jeton
/// refusé se ressaisit, un dépôt invisible demande une *portée* de jeton, et
/// le reste n'est qu'une panne de réseau. Les confondre laisserait
/// l'utilisateur ressaisir un jeton parfaitement valide. `slug` est le dépôt
/// demandé, absent quand la requête ne concerne que le compte.
fn map_error(e: ureq::Error, host: &str, slug: Option<&str>) -> AppError {
    match e {
        ureq::Error::StatusCode(401) | ureq::Error::StatusCode(403) => {
            AppError::ForgeAuth(host.to_string())
        }
        ureq::Error::StatusCode(404) if slug.is_some() => {
            AppError::ForgeNotFound(slug.unwrap_or_default().to_string())
        }
        ureq::Error::StatusCode(code) => AppError::Network(format!("GitHub replied {code}")),
        other => AppError::Network(other.to_string()),
    }
}

/// Compte auquel appartient le jeton, et ses portées.
///
/// Une seule requête, `GET /user` : elle échoue en 401 sur un jeton expiré ou
/// révoqué, et sa réponse porte en en-tête (`X-OAuth-Scopes`) les portées d'un
/// jeton *classique*. Un jeton « fine-grained » n'en publie aucune — ses droits
/// sont par dépôt —, d'où `None` plutôt qu'une liste vide qui dirait « aucune ».
pub fn account(api: &str, host: &str, token: &str) -> Result<ForgeAccount, AppError> {
    let mut response =
        send(&agent(), &format!("{api}/user"), token).map_err(|e| map_error(e, host, None))?;
    let scopes = response
        .headers()
        .get("x-oauth-scopes")
        .and_then(|v| v.to_str().ok())
        .map(parse_scopes);
    let viewer: Account = read_json(&mut response)?;
    Ok(ForgeAccount {
        login: viewer.login,
        scopes,
    })
}

/// `"repo, workflow"` → `["repo", "workflow"]`.
fn parse_scopes(header: &str) -> Vec<String> {
    header
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect()
}

impl ForgeBackend for GitHub {
    fn pull_requests(&self) -> Result<PullRequestReport, AppError> {
        let slug = self.remote.slug();
        let response: GraphQlResponse<PullRequestsData> = self.graphql(
            PULL_REQUESTS_QUERY,
            serde_json::json!({
                "owner": self.remote.owner,
                "name": self.remote.repo,
                "first": PER_PAGE,
                "nested": PER_PR,
            }),
        )?;
        let data = response.into_data(&slug)?;

        // L'identité du jeton, et non le nom d'utilisateur enregistré à côté :
        // c'est elle qui décide de « mes » PR, et elle seule ne peut pas être
        // saisie de travers.
        let viewer = data.viewer.login;
        let pull_requests = data
            .repository
            .pull_requests
            .nodes
            .into_iter()
            .flatten()
            .map(|pr| pr.into_entry(&viewer))
            .collect();

        Ok(PullRequestReport {
            host: self.remote.host.clone(),
            repo: slug,
            viewer,
            pull_requests,
        })
    }
}

// ── Ce que l'API renvoie ────────────────────────────────────────────────────
// Structures locales, distinctes des DTO : le contrat de GitHub n'est pas celui
// du frontend, et les mélanger ferait remonter dans l'interface le moindre
// changement de forme de l'API. Les champs inconnus sont ignorés par serde.

#[derive(Deserialize)]
struct Account {
    login: String,
}

/// Enveloppe de toute réponse GraphQL.
///
/// GitHub répond **200 même en échec** : l'erreur est dans `errors`, et `data`
/// peut être partiel. On garde donc `data` dès qu'il porte le dépôt — un champ
/// que le jeton ne peut pas lire (les checks, pour un jeton « fine-grained »
/// sans cette permission) revient `null` avec une erreur à côté, ce qui ne doit
/// pas faire tomber la liste entière.
#[derive(Deserialize)]
struct GraphQlResponse<T> {
    data: Option<T>,
    #[serde(default)]
    errors: Vec<GraphQlError>,
}

#[derive(Deserialize)]
struct GraphQlError {
    #[serde(rename = "type", default)]
    kind: Option<String>,
    message: String,
}

impl GraphQlResponse<PullRequestsData> {
    /// Les données, ou l'erreur qui dit pourquoi elles manquent — la même
    /// traduction que `map_error` pour REST : un dépôt invisible demande une
    /// portée de jeton, pas une nouvelle saisie.
    fn into_data(self, slug: &str) -> Result<Data, AppError> {
        if let Some(PullRequestsData {
            viewer,
            repository: Some(repository),
        }) = self.data
        {
            return Ok(Data { viewer, repository });
        }
        match self.errors.into_iter().next() {
            Some(e) if e.kind.as_deref() == Some("NOT_FOUND") => {
                Err(AppError::ForgeNotFound(slug.to_string()))
            }
            Some(e) => Err(AppError::Network(format!("GitHub: {}", e.message))),
            None => Err(AppError::ForgeNotFound(slug.to_string())),
        }
    }
}

#[derive(Deserialize)]
struct PullRequestsData {
    viewer: Account,
    repository: Option<Repository>,
}

/// `PullRequestsData` une fois le dépôt trouvé.
struct Data {
    viewer: Account,
    repository: Repository,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Repository {
    pull_requests: Connection<PullRequest>,
}

/// Une liste GraphQL. Ses éléments sont nullables dans le schéma : un nœud
/// illisible pour le jeton vaut `null`, et il est simplement sauté.
#[derive(Deserialize)]
struct Connection<T> {
    #[serde(default = "Vec::new")]
    nodes: Vec<Option<T>>,
}

impl<T> Default for Connection<T> {
    fn default() -> Self {
        Self { nodes: Vec::new() }
    }
}

impl<T> Connection<T> {
    fn items(&self) -> impl Iterator<Item = &T> {
        self.nodes.iter().flatten()
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PullRequest {
    number: u64,
    title: String,
    url: String,
    updated_at: String,
    state: String,
    #[serde(default)]
    merged: bool,
    #[serde(default)]
    is_draft: bool,
    /// `null` quand le compte a été supprimé (« ghost »).
    #[serde(default)]
    author: Option<Account>,
    head_ref_name: String,
    base_ref_name: String,
    #[serde(default)]
    assignees: Connection<Account>,
    #[serde(default)]
    review_requests: Connection<ReviewRequest>,
    #[serde(default)]
    review_decision: Option<String>,
    #[serde(default)]
    latest_opinionated_reviews: Connection<Review>,
    #[serde(default)]
    commits: Connection<CommitNode>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReviewRequest {
    /// Une équipe ou un bot n'a pas de `login` dans notre fragment : la demande
    /// existe, mais elle ne vise pas l'utilisateur du jeton.
    #[serde(default)]
    requested_reviewer: Option<MaybeAccount>,
}

#[derive(Deserialize)]
struct MaybeAccount {
    #[serde(default)]
    login: Option<String>,
}

#[derive(Deserialize)]
struct Review {
    state: String,
}

#[derive(Deserialize)]
struct CommitNode {
    commit: Commit,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Commit {
    #[serde(default)]
    status_check_rollup: Option<Rollup>,
}

#[derive(Deserialize)]
struct Rollup {
    state: String,
}

impl PullRequest {
    fn into_entry(self, viewer: &str) -> PullRequestEntry {
        let author = self.author.map(|u| u.login).unwrap_or_default();
        let requested: Vec<&str> = self
            .review_requests
            .items()
            .filter_map(|r| r.requested_reviewer.as_ref()?.login.as_deref())
            .collect();
        let review = review_state(
            self.review_decision.as_deref(),
            self.latest_opinionated_reviews.items().map(|r| r.state.as_str()),
            !self.review_requests.nodes.is_empty(),
        );
        let checks = self
            .commits
            .items()
            .last()
            .and_then(|c| c.commit.status_check_rollup.as_ref())
            .and_then(|r| checks_state(&r.state));
        PullRequestEntry {
            mine: author == viewer,
            assigned: self.assignees.items().any(|a| a.login == viewer),
            // GitHub retire la demande de revue dès qu'elle est rendue : la
            // liste ne contient donc que ce qui attend *encore* quelque chose.
            reviewing: requested.contains(&viewer),
            merged: self.merged,
            closed: self.state != "OPEN",
            number: self.number,
            title: self.title,
            author,
            source_branch: self.head_ref_name,
            target_branch: self.base_ref_name,
            draft: self.is_draft,
            url: self.url,
            updated_at: self.updated_at,
            review,
            checks,
        }
    }
}

/// Tranche l'état de revue.
///
/// L'avis de GitHub d'abord, quand il en a un. Sinon les revues elles-mêmes :
/// une demande de modifications l'emporte sur une approbation — tant qu'elle
/// n'est pas levée, la PR ne devrait pas être fusionnée —, et une demande de
/// revue encore ouverte dit qu'on attend quelqu'un.
fn review_state<'a>(
    decision: Option<&str>,
    reviews: impl Iterator<Item = &'a str>,
    requested: bool,
) -> Option<ReviewState> {
    match decision {
        Some("APPROVED") => return Some(ReviewState::Approved),
        Some("CHANGES_REQUESTED") => return Some(ReviewState::ChangesRequested),
        Some("REVIEW_REQUIRED") => return Some(ReviewState::ReviewRequired),
        _ => {}
    }
    let mut approved = false;
    for state in reviews {
        match state {
            "CHANGES_REQUESTED" => return Some(ReviewState::ChangesRequested),
            "APPROVED" => approved = true,
            _ => {}
        }
    }
    if approved {
        Some(ReviewState::Approved)
    } else if requested {
        Some(ReviewState::ReviewRequired)
    } else {
        None
    }
}

/// `StatusState` de GitHub → trois états. `EXPECTED` est un check requis qui
/// n'a pas encore rendu compte : il attend, comme `PENDING`.
fn checks_state(state: &str) -> Option<ChecksState> {
    match state {
        "SUCCESS" => Some(ChecksState::Success),
        "FAILURE" | "ERROR" => Some(ChecksState::Failure),
        "PENDING" | "EXPECTED" => Some(ChecksState::Pending),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Réponse minimale de l'API, réduite aux champs qu'on lit. Le reste est
    /// ignoré par serde, ce qui est justement ce qu'on vérifie ici : la forme
    /// complète de GitHub compte des dizaines de champs qu'on n'a pas à suivre.
    const PAYLOAD: &str = r#"{
      "data": {
        "viewer": { "login": "moi" },
        "repository": {
          "pullRequests": {
            "nodes": [
              {
                "number": 12,
                "title": "Ajoute la section PR",
                "url": "https://github.com/o/r/pull/12",
                "updatedAt": "2026-09-01T10:00:00Z",
                "state": "OPEN",
                "merged": false,
                "isDraft": true,
                "author": { "login": "moi" },
                "headRefName": "feat/pr",
                "baseRefName": "main",
                "assignees": { "nodes": [] },
                "reviewRequests": {
                  "nodes": [
                    { "requestedReviewer": { "login": "moi" } },
                    { "requestedReviewer": {} }
                  ]
                },
                "reviewDecision": null,
                "latestOpinionatedReviews": { "nodes": [] },
                "commits": { "nodes": [{ "commit": { "statusCheckRollup": { "state": "PENDING" } } }] },
                "labels": { "nodes": [{ "name": "champ inconnu, ignoré" }] }
              },
              null,
              {
                "number": 11,
                "title": "Approuvée",
                "url": "https://github.com/o/r/pull/11",
                "updatedAt": "2026-08-30T10:00:00Z",
                "state": "OPEN",
                "author": null,
                "headRefName": "fix/x",
                "baseRefName": "main",
                "assignees": { "nodes": [{ "login": "moi" }] },
                "reviewRequests": { "nodes": [] },
                "reviewDecision": null,
                "latestOpinionatedReviews": { "nodes": [{ "state": "APPROVED" }] },
                "commits": { "nodes": [{ "commit": { "statusCheckRollup": null } }] }
              }
            ]
          }
        }
      }
    }"#;

    fn entries(payload: &str) -> Vec<PullRequestEntry> {
        let response: GraphQlResponse<PullRequestsData> =
            serde_json::from_str(payload).expect("désérialisation");
        let data = response.into_data("o/r").expect("données");
        data.repository
            .pull_requests
            .nodes
            .into_iter()
            .flatten()
            .map(|p| p.into_entry(&data.viewer.login))
            .collect()
    }

    #[test]
    fn reads_what_it_needs_and_ignores_the_rest() {
        let prs = entries(PAYLOAD);
        // Le nœud `null` est sauté, pas une erreur.
        assert_eq!(prs.len(), 2);

        assert_eq!(prs[0].number, 12);
        assert_eq!(prs[0].source_branch, "feat/pr");
        assert_eq!(prs[0].target_branch, "main");
        assert!(prs[0].draft);
        assert!(!prs[0].closed && !prs[0].merged);
        assert!(prs[0].mine && prs[0].reviewing && !prs[0].assigned);
        // Une revue demandée, rien de rendu : on attend.
        assert_eq!(prs[0].review, Some(ReviewState::ReviewRequired));
        assert_eq!(prs[0].checks, Some(ChecksState::Pending));

        // Auteur supprimé : chaîne vide, pas un échec.
        assert_eq!(prs[1].author, "");
        assert!(!prs[1].mine && prs[1].assigned && !prs[1].reviewing);
        // `reviewDecision` nul (branche cible sans revue obligatoire), mais une
        // approbation existe : c'est elle qui compte.
        assert_eq!(prs[1].review, Some(ReviewState::Approved));
        assert_eq!(prs[1].checks, None);
    }

    #[test]
    fn github_decision_wins_then_changes_requested_beats_approval() {
        let none = std::iter::empty();
        assert_eq!(
            review_state(Some("CHANGES_REQUESTED"), none, false),
            Some(ReviewState::ChangesRequested)
        );
        assert_eq!(
            review_state(Some("APPROVED"), ["CHANGES_REQUESTED"].into_iter(), false),
            Some(ReviewState::Approved)
        );
        assert_eq!(
            review_state(None, ["APPROVED", "CHANGES_REQUESTED"].into_iter(), true),
            Some(ReviewState::ChangesRequested)
        );
        assert_eq!(review_state(None, std::iter::empty(), false), None);
    }

    #[test]
    fn maps_check_states() {
        assert_eq!(checks_state("SUCCESS"), Some(ChecksState::Success));
        assert_eq!(checks_state("ERROR"), Some(ChecksState::Failure));
        assert_eq!(checks_state("EXPECTED"), Some(ChecksState::Pending));
        assert_eq!(checks_state("NEUTRAL"), None);
    }

    #[test]
    fn graphql_errors_become_app_errors() {
        let missing = r#"{ "data": { "viewer": { "login": "moi" }, "repository": null },
            "errors": [{ "type": "NOT_FOUND", "message": "Could not resolve" }] }"#;
        let response: GraphQlResponse<PullRequestsData> = serde_json::from_str(missing).unwrap();
        assert!(matches!(response.into_data("o/r"), Err(AppError::ForgeNotFound(s)) if s == "o/r"));

        let other = r#"{ "data": null, "errors": [{ "message": "boom" }] }"#;
        let response: GraphQlResponse<PullRequestsData> = serde_json::from_str(other).unwrap();
        assert!(matches!(response.into_data("o/r"), Err(AppError::Network(_))));
    }

    #[test]
    fn parses_the_scopes_header() {
        assert_eq!(parse_scopes("repo, workflow"), ["repo", "workflow"]);
        assert_eq!(parse_scopes(""), Vec::<String>::new());
    }
}
