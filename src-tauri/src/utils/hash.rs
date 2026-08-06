use sha1::{Digest as Sha1Digest, Sha1};
use std::path::Path;

/// Computes the SHA-1 of a file already on disk. Used to validate downloads
/// against the checksums published in Mojang's version/asset manifests
/// before trusting a file as "installed", preventing corrupted or partial
/// downloads from silently breaking a launch.
pub fn sha1_file(path: &Path) -> std::io::Result<String> {
    let bytes = std::fs::read(path)?;
    let mut hasher = Sha1::new();
    hasher.update(&bytes);
    Ok(hex::encode(hasher.finalize()))
}

pub fn sha1_matches(path: &Path, expected: &str) -> bool {
    match sha1_file(path) {
        Ok(actual) => actual.eq_ignore_ascii_case(expected),
        Err(_) => false,
    }
}
