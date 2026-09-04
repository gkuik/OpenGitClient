//! Stockage des identifiants HTTPS des dépôts distants.
//!
//! **L'application possède ses propres entrées.** Elle ne lit jamais celles
//! écrites par un autre outil et ne lance aucun processus externe : c'est la
//! contrainte « standalone » qui a fait écarter `Cred::credential_helper`
//! (lequel exécute `git credential-<helper>`).
//!
//! Sur macOS, l'entrée vit dans le trousseau, rangée sous notre propre nom de
//! service. Comme c'est nous qui la créons, la relire ne déclenche aucune
//! autorisation système — au contraire d'une entrée créée par Git.
//!
//! Le secret ne fait qu'un aller : il entre par [`store`] et ne ressort que vers
//! libgit2, jamais vers le frontend.

use serde::{Deserialize, Serialize};

use crate::error::AppError;

/// Nom de service de nos entrées. Volontairement distinct de tout ce que Git
/// écrit, pour qu'on ne puisse pas toucher aux identifiants d'un autre outil.
const SERVICE: &str = "GitLite";

/// Identifiants d'un hôte.
///
/// Pas de `Debug` dérivé : le secret ne doit apparaître dans aucune trace.
#[derive(Serialize, Deserialize)]
pub struct Credentials {
    pub username: String,
    pub secret: String,
}

/// Hôte d'une URL de dépôt distant — la clé sous laquelle on range l'entrée.
///
/// Analyse écrite à la main : tirer une bibliothèque d'URL entière pour extraire
/// un nom d'hôte serait disproportionné vu l'objectif d'empreinte réduite.
/// Le port et les informations d'utilisateur sont retirés, pour que
/// `https://u@example.com:8443/x.git` et `https://example.com/y.git` partagent
/// la même entrée.
pub fn host_of(url: &str) -> Option<String> {
    let (has_scheme, after_scheme) = match url.split_once("://") {
        Some((_, rest)) => (true, rest),
        None => (false, url),
    };
    // L'autorité s'arrête au premier séparateur de chemin.
    let authority = after_scheme.split(['/', '?', '#']).next()?;
    // `user@hôte` → `hôte` (le dernier `@` fait foi, un mot de passe pouvant en contenir).
    let host_port = authority
        .rsplit_once('@')
        .map(|(_, host)| host)
        .unwrap_or(authority);
    // Avec un schéma, `:` n'introduit qu'un port ; en forme SSH abrégée
    // (`git@hôte:chemin`), il sépare l'hôte du chemin. D'où les deux règles.
    let host = match host_port.rsplit_once(':') {
        Some((host, after)) if !has_scheme || after.chars().all(|c| c.is_ascii_digit()) => host,
        _ => host_port,
    };

    (!host.is_empty()).then(|| host.to_ascii_lowercase())
}

#[cfg(target_os = "macos")]
mod store {
    use super::{Credentials, SERVICE};
    use crate::error::AppError;

    pub fn get(host: &str) -> Option<Credentials> {
        let raw = security_framework::passwords::get_generic_password(SERVICE, host).ok()?;
        // Une entrée illisible (format d'une version antérieure, corruption) est
        // traitée comme absente : l'utilisateur la ressaisira.
        serde_json::from_slice(&raw).ok()
    }

    pub fn store(host: &str, credentials: &Credentials) -> Result<(), AppError> {
        let raw = serde_json::to_vec(credentials)
            .map_err(|e| AppError::CredentialStore(e.to_string()))?;
        security_framework::passwords::set_generic_password(SERVICE, host, &raw)
            .map_err(|e| AppError::CredentialStore(e.to_string()))
    }

    /// `errSecItemNotFound` : supprimer ce qui n'existe pas donne déjà le
    /// résultat demandé, ce n'est pas une erreur.
    const ITEM_NOT_FOUND: i32 = -25300;

    pub fn delete(host: &str) -> Result<(), AppError> {
        match security_framework::passwords::delete_generic_password(SERVICE, host) {
            Ok(()) => Ok(()),
            Err(e) if e.code() == ITEM_NOT_FOUND => Ok(()),
            Err(e) => Err(AppError::CredentialStore(e.to_string())),
        }
    }
}

/// Plateformes sans implémentation : l'application se comporte comme si le
/// trousseau était vide, et le dit clairement au moment d'enregistrer plutôt que
/// d'accepter un secret qu'elle serait incapable de relire.
#[cfg(not(target_os = "macos"))]
mod store {
    use super::Credentials;
    use crate::error::AppError;

    pub fn get(_host: &str) -> Option<Credentials> {
        None
    }

    pub fn store(_host: &str, _credentials: &Credentials) -> Result<(), AppError> {
        Err(AppError::CredentialStore(
            "Le stockage d'identifiants n'est pas encore disponible sur cette plateforme".into(),
        ))
    }

    pub fn delete(_host: &str) -> Result<(), AppError> {
        Ok(())
    }
}

/// Identifiants enregistrés pour un hôte, s'il y en a.
pub fn get(host: &str) -> Option<Credentials> {
    store::get(host)
}

/// Enregistre (ou remplace) les identifiants d'un hôte.
pub fn set(host: &str, username: String, secret: String) -> Result<(), AppError> {
    store::store(host, &Credentials { username, secret })
}

/// Oublie les identifiants d'un hôte. Sans effet s'il n'y en avait pas.
pub fn forget(host: &str) -> Result<(), AppError> {
    store::delete(host)
}

/// Y a-t-il des identifiants pour cet hôte ? Ne révèle rien de leur contenu.
pub fn has(host: &str) -> bool {
    store::get(host).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_host_from_usual_remote_urls() {
        assert_eq!(
            host_of("https://github.psa-cloud.com/ouw00/app.git").as_deref(),
            Some("github.psa-cloud.com")
        );
        // Informations d'utilisateur et port retirés : une seule entrée par hôte.
        assert_eq!(
            host_of("https://TA23989@example.com:8443/a/b.git").as_deref(),
            Some("example.com")
        );
        // La casse ne doit pas créer deux entrées.
        assert_eq!(
            host_of("https://GitHub.COM/x/y.git").as_deref(),
            Some("github.com")
        );
        // Forme SSH abrégée, sans schéma.
        assert_eq!(
            host_of("git@192.168.2.23:/opt/git/x.git").as_deref(),
            Some("192.168.2.23")
        );
        // Forme SSH abrégée avec un chemin relatif après le `:`.
        assert_eq!(
            host_of("git@example.com:team/x.git").as_deref(),
            Some("example.com")
        );
        // Avec un schéma en revanche, ce qui suit `:` doit être un port pour
        // être retiré — sinon on tronquerait un hôte à tort.
        assert_eq!(
            host_of("https://example.com:huit/x.git").as_deref(),
            Some("example.com:huit")
        );
    }

    #[test]
    fn rejects_urls_without_a_host() {
        assert_eq!(host_of(""), None);
        assert_eq!(host_of("https:///chemin/seul"), None);
    }
}
