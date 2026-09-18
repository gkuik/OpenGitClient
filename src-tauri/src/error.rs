use serde::{Serialize, Serializer};

/// Erreur applicative unique remontée au frontend.
///
/// Toutes les commandes Tauri renvoient `Result<T, AppError>`. La sérialisation
/// produit un objet `{ "kind": "...", "message": "...", "arg": ... }`,
/// directement exploitable côté Svelte (voir `src/lib/types.ts`). On n'expose
/// jamais de `panic` au front.
///
/// **Les messages sont en anglais, et ne sont qu'un repli** : le frontend
/// traduit sur le `kind`, qui est stable, et `arg` lui donne le paramètre que la
/// variante porte (l'hôte, le motif d'un refus). Sans ce champ, la traduction
/// devrait ré-extraire cette valeur du message — donc en connaître la forme dans
/// chaque langue, ce qui n'a pas de sens. Les variantes dont le message *est* le
/// contenu (`Git`, `Io`, `Network`, `CredentialStore`) n'ont rien à paramétrer :
/// le front affiche alors le message tel quel.
#[derive(Debug, Clone, thiserror::Error)]
pub enum AppError {
    #[error("This folder is not a valid Git repository")]
    NotARepository,

    #[error("No repository open")]
    NoRepoOpen,

    #[error("Nothing to commit (no staged change)")]
    NothingToCommit,

    #[error("No commit to amend")]
    NothingToAmend,

    #[error("Missing Git signature: set user.name and user.email")]
    MissingSignature,

    #[error("Cannot switch branch: local changes would be overwritten")]
    CheckoutConflict,

    #[error("Commit not found")]
    CommitNotFound,

    #[error("Cannot apply the stash: it conflicts with local changes")]
    StashConflict,

    #[error("Nothing to stash (no local change)")]
    NothingToStash,

    #[error("A merge is already in progress: finish it or abort it before starting another one")]
    MergeInProgress,

    #[error("No remote configured")]
    NoRemote,

    #[error("Authentication refused by the remote")]
    RemoteAuth,

    #[error("No credentials available for this remote")]
    NoCredentials,

    #[error("{0}")]
    CredentialStore(String),

    #[error("A network operation is already running on this repository")]
    NetworkBusy,

    #[error("No access token saved for {0}")]
    ForgeToken(String),

    #[error("Token refused by {0}: it may have expired, or lack the “repo” scope")]
    ForgeAuth(String),

    #[error("Repository {0} not found: it is private, or the token cannot reach it")]
    ForgeNotFound(String),

    #[error("Pull requests are only read from GitHub for now")]
    ForgeUnsupported,

    #[error("No current branch (detached HEAD)")]
    DetachedHead,

    #[error("The current branch tracks no remote branch: nothing to pull")]
    NoUpstream,

    #[error("Push refused: the remote has moved ahead ({0}). Fetch, then integrate its commits before pushing again.")]
    PushRejected(String),

    #[error("Force push refused: the remote branch has moved since the last fetch (it is now at {0}). Fetch and look at what arrived before forcing again.")]
    PushLeaseStale(String),

    #[error("{0}")]
    Network(String),

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
            AppError::NothingToStash => "NothingToStash",
            AppError::MergeInProgress => "MergeInProgress",
            AppError::NoRemote => "NoRemote",
            AppError::RemoteAuth => "RemoteAuth",
            AppError::NoCredentials => "NoCredentials",
            AppError::CredentialStore(_) => "CredentialStore",
            AppError::NetworkBusy => "NetworkBusy",
            AppError::ForgeToken(_) => "ForgeToken",
            AppError::ForgeAuth(_) => "ForgeAuth",
            AppError::ForgeNotFound(_) => "ForgeNotFound",
            AppError::ForgeUnsupported => "ForgeUnsupported",
            AppError::DetachedHead => "DetachedHead",
            AppError::NoUpstream => "NoUpstream",
            AppError::PushRejected(_) => "PushRejected",
            AppError::PushLeaseStale(_) => "PushLeaseStale",
            AppError::Network(_) => "Network",
            AppError::Git(_) => "Git",
            AppError::Io(_) => "Io",
        }
    }

    /// Paramètre de la variante, quand elle en porte un : c'est le `{arg}` de la
    /// traduction. `None` pour les variantes qui transportent déjà un message
    /// complet — il n'y a alors rien à réinjecter dans un gabarit.
    fn arg(&self) -> Option<&str> {
        match self {
            AppError::ForgeToken(arg)
            | AppError::ForgeAuth(arg)
            | AppError::ForgeNotFound(arg)
            | AppError::PushRejected(arg)
            | AppError::PushLeaseStale(arg) => Some(arg),
            _ => None,
        }
    }
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut s = serializer.serialize_struct("AppError", 3)?;
        s.serialize_field("kind", self.kind())?;
        s.serialize_field("message", &self.to_string())?;
        s.serialize_field("arg", &self.arg())?;
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
