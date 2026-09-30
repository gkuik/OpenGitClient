//! Implémentation GitHub de [`ForgeBackend`](super::ForgeBackend).
//!
//! **Deux requêtes par chargement, pas quatre.** GitKraken range les PR en trois
//! groupes (les miennes, celles qui me sont assignées, celles qui attendent ma
//! revue) ; l'API de recherche saurait répondre à chacun, mais ce serait trois
//! appels sur un quota bien plus serré (30 requêtes/minute) pour un résultat
//! qu'une seule liste contient déjà. On demande donc les PR du dépôt, plus
//! l'identité du jeton, et **le classement se fait sur les données** — côté
//! frontend, comme la mise en page du graph : le backend rapporte, il ne
//! présente pas.

use std::time::Duration;

use serde::Deserialize;

use super::{ForgeBackend, ForgeRemote};
use crate::dto::{PullRequestEntry, PullRequestReport};
use crate::error::AppError;

/// GitHub exige un `User-Agent` ; une requête sans en-tête est refusée en 403.
const USER_AGENT: &str = "OpenGitClient";

/// Version d'API épinglée : une réponse dont la forme change sous nos pieds
/// casserait la désérialisation sans prévenir.
const API_VERSION: &str = "2022-11-28";

/// Plafond d'une page. Au-delà, il faudrait paginer — mais une section de barre
/// latérale n'affiche pas cent PR, et les plus fraîches sont en tête.
const PER_PAGE: usize = 100;

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

    fn agent(&self) -> ureq::Agent {
        ureq::Agent::config_builder()
            .timeout_global(Some(TIMEOUT))
            .user_agent(USER_AGENT)
            .build()
            .into()
    }

    /// GET + désérialisation JSON, en-têtes d'authentification compris.
    fn get<T: serde::de::DeserializeOwned>(&self, agent: &ureq::Agent, url: &str) -> Result<T, AppError> {
        let mut response = agent
            .get(url)
            .header("Authorization", &format!("Bearer {}", self.token))
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", API_VERSION)
            .call()
            .map_err(|e| self.map_error(e))?;
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
    /// l'utilisateur ressaisir un jeton parfaitement valide.
    fn map_error(&self, e: ureq::Error) -> AppError {
        match e {
            ureq::Error::StatusCode(401) | ureq::Error::StatusCode(403) => {
                AppError::ForgeAuth(self.remote.host.clone())
            }
            ureq::Error::StatusCode(404) => AppError::ForgeNotFound(self.remote.slug()),
            ureq::Error::StatusCode(code) => {
                AppError::Network(format!("GitHub replied {code}"))
            }
            other => AppError::Network(other.to_string()),
        }
    }
}

impl ForgeBackend for GitHub {
    fn pull_requests(&self) -> Result<PullRequestReport, AppError> {
        let agent = self.agent();

        // L'identité du jeton, et non le nom d'utilisateur enregistré à côté :
        // c'est elle qui décide de « mes » PR, et elle seule ne peut pas être
        // saisie de travers.
        let api = &self.remote.api;
        let viewer: Account = self.get(&agent, &format!("{api}/user"))?;

        let url = format!(
            "{api}/repos/{}/pulls?state=open&per_page={PER_PAGE}&sort=updated&direction=desc",
            self.remote.slug()
        );
        let raw: Vec<PullRequest> = self.get(&agent, &url)?;

        let pull_requests = raw
            .into_iter()
            .map(|pr| pr.into_entry(&viewer.login))
            .collect();

        Ok(PullRequestReport {
            host: self.remote.host.clone(),
            repo: self.remote.slug(),
            viewer: viewer.login,
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

#[derive(Deserialize)]
struct GitRef {
    /// `ref` est un mot-clé Rust : renommé, mais c'est bien le nom de branche.
    #[serde(rename = "ref")]
    name: String,
}

#[derive(Deserialize)]
struct PullRequest {
    number: u64,
    title: String,
    html_url: String,
    updated_at: String,
    state: String,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    merged_at: Option<String>,
    #[serde(default)]
    user: Option<Account>,
    head: GitRef,
    base: GitRef,
    #[serde(default)]
    assignees: Vec<Account>,
    #[serde(default)]
    requested_reviewers: Vec<Account>,
}

impl PullRequest {
    fn into_entry(self, viewer: &str) -> PullRequestEntry {
        let author = self.user.map(|u| u.login).unwrap_or_default();
        PullRequestEntry {
            mine: author == viewer,
            assigned: self.assignees.iter().any(|a| a.login == viewer),
            // GitHub retire la demande de revue dès qu'elle est rendue : la
            // liste ne contient donc que ce qui attend *encore* quelque chose.
            reviewing: self.requested_reviewers.iter().any(|a| a.login == viewer),
            // `state` vaut « closed » pour une PR fusionnée comme pour une PR
            // abandonnée ; seule la date de fusion les distingue.
            merged: self.merged_at.is_some(),
            closed: self.state != "open",
            number: self.number,
            title: self.title,
            author,
            source_branch: self.head.name,
            target_branch: self.base.name,
            draft: self.draft,
            url: self.html_url,
            updated_at: self.updated_at,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Réponse minimale de l'API, réduite aux champs qu'on lit. Le reste est
    /// ignoré par serde, ce qui est justement ce qu'on vérifie ici : la forme
    /// complète de GitHub compte des dizaines de champs qu'on n'a pas à suivre.
    const PAYLOAD: &str = r#"[
      {
        "number": 12,
        "title": "Ajoute la section PR",
        "html_url": "https://github.com/o/r/pull/12",
        "updated_at": "2026-09-01T10:00:00Z",
        "state": "open",
        "draft": true,
        "merged_at": null,
        "user": { "login": "moi" },
        "head": { "ref": "feat/pr" },
        "base": { "ref": "main" },
        "assignees": [],
        "requested_reviewers": [{ "login": "moi" }],
        "labels": [{ "name": "champ inconnu, ignoré" }]
      },
      {
        "number": 11,
        "title": "Fusionnée",
        "html_url": "https://github.com/o/r/pull/11",
        "updated_at": "2026-08-30T10:00:00Z",
        "state": "closed",
        "merged_at": "2026-08-30T11:00:00Z",
        "user": { "login": "quelquun" },
        "head": { "ref": "fix/x" },
        "base": { "ref": "main" },
        "assignees": [{ "login": "moi" }],
        "requested_reviewers": []
      }
    ]"#;

    #[test]
    fn reads_what_it_needs_and_ignores_the_rest() {
        let list: Vec<PullRequest> = serde_json::from_str(PAYLOAD).expect("désérialisation");
        let prs: Vec<PullRequestEntry> = list.into_iter().map(|p| p.into_entry("moi")).collect();

        assert_eq!(prs[0].number, 12);
        assert_eq!(prs[0].source_branch, "feat/pr");
        assert_eq!(prs[0].target_branch, "main");
        assert!(prs[0].draft);
        // Ouverte : ni fermée ni fusionnée, et c'est la nôtre.
        assert!(!prs[0].closed && !prs[0].merged);
        assert!(prs[0].mine && prs[0].reviewing && !prs[0].assigned);

        // `state` vaut « closed » dans les deux cas : seule la date de fusion
        // distingue une PR fusionnée d'une PR abandonnée.
        assert!(prs[1].closed && prs[1].merged);
        assert!(!prs[1].mine && prs[1].assigned);
    }
}
