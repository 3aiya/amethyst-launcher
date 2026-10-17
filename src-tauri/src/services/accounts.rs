//! Password hashing for launcher accounts (see `db::users_*` and the
//! `launcher_auth_*` commands).
//!
//! This app has no backend server - "launcher accounts" are purely local,
//! stored in the same SQLite file as everything else, letting more than one
//! person share an install while keeping their own settings/profile and,
//! for whoever registered first (or was promoted), admin access to the
//! Admin panel.
//!
//! Deliberately simple rather than pulling in argon2/bcrypt: it's a local
//! single-machine account store, not a network-facing one, so a salted hash
//! is enough to keep passwords out of plain sight without adding a new
//! dependency. If that trust model ever changes (e.g. accounts syncing to a
//! shared server), swap this for a proper KDF first.

use sha2::{Digest, Sha256};

fn hash_with_salt(password: &str, salt: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(salt.as_bytes());
    hasher.update(password.as_bytes());
    hex::encode(hasher.finalize())
}

/// Produces a new `"<salt>$<hash>"` string to store as a user's password.
pub fn make_hash(password: &str) -> String {
    let salt = uuid::Uuid::new_v4().simple().to_string();
    let hash = hash_with_salt(password, &salt);
    format!("{salt}${hash}")
}

/// Checks a password attempt against a stored `"<salt>$<hash>"` string.
pub fn verify(password: &str, stored: &str) -> bool {
    match stored.split_once('$') {
        Some((salt, hash)) => hash_with_salt(password, salt) == hash,
        None => false,
    }
}
