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
//! Ce silence tient à une condition qu'il faut connaître : la liste d'accès de
//! l'entrée retient l'**identité de signature** du programme qui l'a écrite, pas
//! son chemin. Une application signée avec une identité stable se reconnaît donc
//! d'une version à l'autre ; un binaire de développement signé « ad-hoc », lui,
//! a pour identité son empreinte, qui change à chaque compilation — macOS
//! redemande alors l'autorisation. C'est un fait de la machine de développement,
//! pas du code, mais c'est ce qui rend la règle ci-dessous utile.
//!
//! **Savoir si une entrée existe ne demande pas de la lire.** La liste d'accès
//! protège la donnée, pas les attributs : [`has`] cherche l'élément sans réclamer
//! son contenu, donc sans jamais provoquer de demande d'autorisation. Le secret
//! n'est déchiffré que là où il sert vraiment — le transport Git et l'API d'une
//! forge —, et non pour répondre « oui » à l'écran des paramètres.
//!
//! Le secret ne fait qu'un aller : il entre par [`store`] et ne ressort que vers
//! libgit2, jamais vers le frontend.

use serde::{Deserialize, Serialize};

use crate::error::AppError;

/// Nom de service de nos entrées. Volontairement distinct de tout ce que Git
/// écrit, pour qu'on ne puisse pas toucher aux identifiants d'un autre outil.
const SERVICE: &str = "OpenGitClient";

/// Service sous lequel l'application rangeait ses entrées quand elle s'appelait
/// GitLite. Une entrée qui y est encore est déplacée sous [`SERVICE`] à sa
/// première lecture ; d'ici là, elle compte comme présente.
#[cfg(target_os = "macos")]
const LEGACY_SERVICE: &str = "GitLite";

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
    use security_framework::item::{ItemClass, ItemSearchOptions};

    use super::{Credentials, LEGACY_SERVICE, SERVICE};
    use crate::error::AppError;

    /// Y a-t-il une entrée pour cet hôte ? Sans en lire le contenu.
    ///
    /// Recherche sur les seuls attributs (`load_attributes`, jamais
    /// `load_data`) : c'est ce qui distingue cette fonction de `get` du point de
    /// vue du trousseau, qui n'a rien à déchiffrer et donc rien à autoriser.
    /// Une entrée pas encore migrée compte : `get` la retrouvera.
    pub fn has(host: &str) -> bool {
        exists(SERVICE, host) || exists(LEGACY_SERVICE, host)
    }

    fn exists(service: &str, host: &str) -> bool {
        let found = ItemSearchOptions::new()
            .class(ItemClass::generic_password())
            .service(service)
            .account(host)
            .load_attributes(true)
            .search();
        matches!(found, Ok(items) if !items.is_empty())
    }

    pub fn get(host: &str) -> Option<Credentials> {
        if let Some(credentials) = read(SERVICE, host) {
            return Some(credentials);
        }
        // Migration paresseuse : l'entrée est recopiée sous le nouveau service,
        // puis l'ancienne effacée — seulement si la copie a réussi, pour ne
        // jamais perdre le secret en route.
        let credentials = read(LEGACY_SERVICE, host)?;
        if store(host, &credentials).is_ok() {
            let _ = remove(LEGACY_SERVICE, host);
        }
        Some(credentials)
    }

    fn read(service: &str, host: &str) -> Option<Credentials> {
        let raw = security_framework::passwords::get_generic_password(service, host).ok()?;
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

    /// Efface aussi une entrée pas encore migrée : sans cela, un jeton oublié
    /// reviendrait à la lecture suivante, depuis l'ancien service.
    pub fn delete(host: &str) -> Result<(), AppError> {
        remove(SERVICE, host)?;
        remove(LEGACY_SERVICE, host)
    }

    fn remove(service: &str, host: &str) -> Result<(), AppError> {
        match security_framework::passwords::delete_generic_password(service, host) {
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

    pub fn has(_host: &str) -> bool {
        false
    }

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

/// Y a-t-il des identifiants pour cet hôte ?
///
/// Ne révèle rien de leur contenu, et ne le lit pas davantage : c'est la réponse
/// à une question d'existence, posée à chaque `remote_info` — donc à chaque
/// ouverture des paramètres. La faire passer par `get` déchiffrait le secret
/// pour le jeter aussitôt, au prix d'une demande d'autorisation du trousseau
/// quand l'identité de l'application a changé (voir l'en-tête du module).
pub fn has(host: &str) -> bool {
    store::has(host)
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
