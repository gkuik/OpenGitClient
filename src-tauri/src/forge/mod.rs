//! Pull requests — la seule partie de l'application qui ne parle pas Git.
//!
//! Une PR n'existe ni dans `refs/**` ni dans libgit2 : elle vit dans l'API d'une
//! forge. Ce module est donc à `git/` ce que `GitBackend` est aux commandes —
//! **le point d'extension** : [`ForgeBackend`] décrit ce qu'on sait demander,
//! `github.rs` en est la première (et pour l'instant unique) implémentation, et
//! une forge de plus sera un second impl sans rien changer aux commandes ni au
//! frontend.
//!
//! Deux règles héritées du reste du backend valent ici aussi :
//!
//! - **rien n'est lancé en dehors du processus** : pas de `gh`, pas de `curl` ;
//!   l'appel HTTP passe par `ureq`, lié dans le binaire comme libgit2 ;
//! - **le jeton ne fait qu'un aller**. Il est relu depuis le trousseau au moment
//!   de la requête et ne ressort jamais vers le frontend, exactement comme le
//!   secret HTTPS que libgit2 reçoit (voir `credentials.rs`).
//!
//! Les jetons sont d'ailleurs **les mêmes** : une entrée par hôte, celle que
//! l'écran Réglages appelle « jeton d'accès ». Un dépôt cloné en SSH n'en a
//! pas besoin pour ses fetch, mais son API en réclame un — d'où
//! [`RemoteInfo::forge`], qui fait apparaître l'hôte dans les Réglages même
//! sans distant HTTP.

pub mod github;

use serde::{Deserialize, Serialize};

use crate::dto::PullRequestReport;
use crate::error::AppError;

/// Forge reconnue derrière un dépôt distant.
///
/// Un seul variant : le type décrit ce qui existe, comme `PullMode` n'a pas de
/// variant `Rebase`. GitLab viendra s'ajouter ici avec son implémentation, pas
/// avant.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ForgeKind {
    GitHub,
}

/// Dépôt tel que la forge le nomme : `owner/repo` sur un hôte.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ForgeRemote {
    pub kind: ForgeKind,
    pub host: String,
    pub owner: String,
    pub repo: String,
    /// Racine de l'API. Elle ne se déduit pas de l'hôte : le service public a la
    /// sienne (`api.github.com`), une instance Enterprise sert la sienne **sous**
    /// son propre domaine (`https://hôte/api/v3`). C'est la seule différence
    /// entre les deux, d'où l'absence de variante dans [`ForgeKind`].
    pub api: String,
}

impl ForgeRemote {
    /// `owner/repo`, tel qu'il s'affiche et tel que l'API l'attend dans ses URLs.
    pub fn slug(&self) -> String {
        format!("{}/{}", self.owner, self.repo)
    }
}

/// Ce qu'on sait demander à une forge. Volontairement minuscule : lister les
/// pull requests, et rien d'autre — on n'en crée pas, on n'en fusionne pas.
pub trait ForgeBackend {
    /// Pull requests **ouvertes** du dépôt, brouillons compris.
    fn pull_requests(&self) -> Result<PullRequestReport, AppError>;
}

/// L'hôte est-il un GitHub ?
///
/// `github.com`, et **toute instance Enterprise dont le nom le dit** :
/// `github.psa-cloud.com`, `github-eu.exemple.fr`. Rien dans le protocole ne
/// distingue une instance GitHub d'un hôte quelconque avant de l'avoir
/// interrogée, et l'interroger au hasard reviendrait à envoyer le jeton d'un
/// hôte à un serveur qui n'est peut-être pas une forge. Le nom est donc le seul
/// indice qu'on accepte de suivre — et il est le bon dans l'immense majorité des
/// installations, qui appellent leur instance « github ».
///
/// La contrepartie est assumée : une instance nommée autrement (`ghe.…`,
/// `code.…`) n'est pas reconnue, et sa section PULL REQUESTS ne s'affiche pas.
/// Mieux vaut ça qu'une section en erreur permanente sur des hôtes qui n'ont
/// jamais eu de pull requests.
fn is_github_host(host: &str) -> bool {
    host == "github.com" || host.split('.').any(|label| label.starts_with("github"))
}

/// Racine de l'API pour un hôte GitHub. Le service public a la sienne, une
/// instance Enterprise sert la sienne sous son propre domaine.
fn api_base(host: &str) -> String {
    if host == "github.com" {
        "https://api.github.com".to_string()
    } else {
        format!("https://{host}/api/v3")
    }
}

/// Reconnaît la forge derrière une URL de dépôt distant, `None` si personne.
///
/// L'hôte vient de `credentials::host_of` — la même analyse que celle qui range
/// les jetons, donc la même clé des deux côtés, port et `user@` retirés compris.
pub fn detect(url: &str) -> Option<ForgeRemote> {
    let host = crate::credentials::host_of(url)?;
    if !is_github_host(&host) {
        return None;
    }
    let (owner, repo) = split_path(url)?;
    Some(ForgeRemote {
        kind: ForgeKind::GitHub,
        api: api_base(&host),
        host,
        owner,
        repo,
    })
}

/// `owner` et `repo` extraits du chemin d'une URL de dépôt, quelle qu'en soit la
/// forme : `https://hôte/o/r.git`, `ssh://git@hôte/o/r`, ou la forme SSH abrégée
/// `git@hôte:o/r.git`.
fn split_path(url: &str) -> Option<(String, String)> {
    let after_scheme = url.split_once("://").map(|(_, rest)| rest).unwrap_or(url);
    // Avec un schéma, le chemin commence au premier `/` ; en forme abrégée, il
    // suit le `:`. Prendre le premier des deux séparateurs couvre les deux cas.
    let start = after_scheme.find(['/', ':'])?;
    let path = after_scheme[start + 1..]
        .trim_start_matches('/')
        .trim_end_matches('/');
    // Les paramètres et l'ancre ne font pas partie du chemin du dépôt.
    let path = path.split(['?', '#']).next()?;
    let path = path.strip_suffix(".git").unwrap_or(path);

    let mut parts = path.split('/').filter(|s| !s.is_empty());
    let owner = parts.next()?.to_string();
    let repo = parts.next()?.to_string();
    // Un segment de plus n'est pas un dépôt GitHub : mieux vaut ne rien
    // reconnaître que d'interroger une API sur une adresse inventée.
    if parts.next().is_some() {
        return None;
    }
    Some((owner, repo))
}

/// Ouvre l'accès à la forge d'un dépôt distant, jeton compris.
///
/// C'est ici que l'absence de jeton devient une erreur nommée plutôt qu'un 401
/// plus loin : la section a un message à afficher, et il n'a rien à voir avec
/// celui d'un jeton refusé.
pub fn open(remote: &ForgeRemote) -> Result<Box<dyn ForgeBackend>, AppError> {
    let token = crate::credentials::get(&remote.host)
        .map(|c| c.secret)
        .ok_or_else(|| AppError::ForgeToken(remote.host.clone()))?;
    match remote.kind {
        ForgeKind::GitHub => Ok(Box::new(github::GitHub::new(remote.clone(), token))),
    }
}

/// L'URL peut-elle être ouverte dans le navigateur du système ?
///
/// Garde-fou de `open_pull_request` : seules les pages web d'une forge reconnue
/// passent. Les URLs viennent pourtant de nos propres réponses — mais c'est
/// justement le genre de chaîne qu'on ne veut pas voir devenir un « ouvre
/// n'importe quoi » si une réponse d'API change de forme.
pub fn is_openable(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else {
        return false;
    };
    let host = rest.split(['/', '?', '#']).next().unwrap_or_default();
    is_github_host(host)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_github_in_every_remote_form() {
        for url in [
            "https://github.com/owner/repo.git",
            "https://github.com/owner/repo",
            "git@github.com:owner/repo.git",
            "ssh://git@github.com/owner/repo.git",
        ] {
            let found = detect(url).unwrap_or_else(|| panic!("non reconnu : {url}"));
            assert_eq!(found.kind, ForgeKind::GitHub);
            assert_eq!(found.slug(), "owner/repo");
        }
    }

    #[test]
    fn detects_an_enterprise_instance_and_its_own_api() {
        let found = detect("https://github.psa-cloud.com/ouw00/app.git").unwrap();
        assert_eq!(found.host, "github.psa-cloud.com");
        assert_eq!(found.slug(), "ouw00/app");
        // L'API d'une instance Enterprise vit sous son propre domaine, là où le
        // service public a la sienne.
        assert_eq!(found.api, "https://github.psa-cloud.com/api/v3");
        assert_eq!(
            detect("https://github.com/o/r.git").unwrap().api,
            "https://api.github.com"
        );
    }

    #[test]
    fn ignores_hosts_it_cannot_serve() {
        // Rien dans le nom ne dit « GitHub » : on n'ira pas interroger au hasard
        // un serveur en lui tendant le jeton de son hôte.
        assert!(detect("https://gitlab.com/owner/repo.git").is_none());
        assert!(detect("https://ghe.exemple.fr/owner/repo.git").is_none());
        // Chemin local : pas d'hôte, donc pas de forge.
        assert!(detect("/Users/moi/depot").is_none());
        // Un segment de trop : ce n'est pas une adresse GitHub.
        assert!(detect("https://github.com/owner/group/repo.git").is_none());
    }

    #[test]
    fn only_forge_pages_can_be_opened() {
        assert!(is_openable("https://github.com/o/r/pull/12"));
        assert!(is_openable("https://github.psa-cloud.com/o/r/pull/12"));
        assert!(!is_openable("http://github.com/o/r/pull/12"));
        assert!(!is_openable("https://exemple.test/o/r/pull/12"));
        assert!(!is_openable("file:///etc/passwd"));
    }
}
