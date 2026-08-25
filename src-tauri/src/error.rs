use serde::{Serialize, Serializer};

/// Erreur applicative unique remontée au frontend.
///
/// Toutes les commandes Tauri renvoient `Result<T, AppError>`. La sérialisation
/// produit un objet `{ "kind": "...", "message": "..." }`, directement exploitable
/// côté Svelte (voir `src/lib/types.ts`). On n'expose jamais de `panic` au front.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Ce dossier n'est pas un dépôt Git valide")]
    NotARepository,

    #[error("Aucun dépôt ouvert")]
    NoRepoOpen,

    #[error("Rien à committer (aucun changement indexé)")]
    NothingToCommit,

    #[error("Aucun commit à amender")]
    NothingToAmend,

    #[error("Signature Git absente : configure user.name et user.email")]
    MissingSignature,

    #[error("Changement de branche impossible : des modifications locales seraient écrasées")]
    CheckoutConflict,

    #[error("Commit introuvable")]
    CommitNotFound,

    #[error("Application du stash impossible : conflit avec les modifications locales")]
    StashConflict,

    #[error("{0}")]
    Git(String),

    #[error("{0}")]
    Io(String),
}

impl AppError {
    /// Discriminant textuel stable, utilisable côté front pour un traitement fin.
    fn kind(&self) -> &'static str {
        match self {
            AppError::NotARepository => "NotARepository",
            AppError::NoRepoOpen => "NoRepoOpen",
            AppError::NothingToCommit => "NothingToCommit",
            AppError::NothingToAmend => "NothingToAmend",
            AppError::MissingSignature => "MissingSignature",
            AppError::CheckoutConflict => "CheckoutConflict",
            AppError::CommitNotFound => "CommitNotFound",
            AppError::StashConflict => "StashConflict",
            AppError::Git(_) => "Git",
            AppError::Io(_) => "Io",
        }
    }
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut s = serializer.serialize_struct("AppError", 2)?;
        s.serialize_field("kind", self.kind())?;
        s.serialize_field("message", &self.to_string())?;
        s.end()
    }
}

impl From<git2::Error> for AppError {
    fn from(e: git2::Error) -> Self {
        AppError::Git(e.message().to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Io(e.to_string())
    }
}
