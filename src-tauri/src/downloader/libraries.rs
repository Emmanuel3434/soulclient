use crate::utils::hash::sha1_matches;
use crate::utils::paths::AppPaths;
use crate::utils::{AppError, AppResult};
use futures_util::StreamExt;
use std::path::PathBuf;

/// A single file we need on disk before a version can launch: the client
/// jar itself, or one of its libraries/natives.
pub struct PendingFile {
    pub url: String,
    pub dest: PathBuf,
    pub sha1: Option<String>,
    pub size: u64,
}

/// Determines whether a library entry applies to the current OS, honoring
/// Mojang's `rules` array (`{"action":"allow"/"disallow","os":{"name":...}}`).
fn library_allowed(lib: &serde_json::Value) -> bool {
    let Some(rules) = lib.get("rules").and_then(|r| r.as_array()) else {
        return true;
    };

    let current_os = if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "osx"
    } else {
        "linux"
    };

    let mut allowed = false;
    for rule in rules {
        let action = rule.get("action").and_then(|a| a.as_str()).unwrap_or("allow");
        let os_matches = rule
            .get("os")
            .and_then(|o| o.get("name"))
            .and_then(|n| n.as_str())
            .map(|n| n == current_os)
            .unwrap_or(true);

        if os_matches {
            allowed = action == "allow";
        }
    }
    allowed
}

/// Converts a Maven coordinate (`"group.id:artifact:version[:classifier]"`)
/// into the relative path Maven repos (and our own `libraries/` cache) use
/// to store it — e.g. `"net.fabricmc:fabric-loader:0.16.9"` becomes
/// `"net/fabricmc/fabric-loader/0.16.9/fabric-loader-0.16.9.jar"`. Fabric's
/// (and Quilt's) profile JSON lists its own libraries this way — just a
/// `name` + repo `url`, no `downloads` block — since those jars come from
/// Fabric's own Maven, not Mojang's CDN.
pub fn maven_name_to_path(name: &str) -> Option<String> {
    let mut parts = name.split(':');
    let group = parts.next()?;
    let artifact = parts.next()?;
    let version = parts.next()?;
    let classifier = parts.next();

    let group_path = group.replace('.', "/");
    let file_name = match classifier {
        Some(c) => format!("{artifact}-{version}-{c}.jar"),
        None => format!("{artifact}-{version}.jar"),
    };
    Some(format!("{group_path}/{artifact}/{version}/{file_name}"))
}

/// Walks the version JSON's `libraries` array and resolves every artifact
/// (main jar + platform-specific natives) that must exist locally.
pub fn resolve_libraries(version_json: &serde_json::Value) -> Vec<PendingFile> {
    let mut files = Vec::new();
    let libs_dir = AppPaths::libraries_dir();

    let Some(libraries) = version_json.get("libraries").and_then(|l| l.as_array()) else {
        return files;
    };

    for lib in libraries {
        if !library_allowed(lib) {
            continue;
        }

        if let Some(artifact) = lib
            .get("downloads")
            .and_then(|d| d.get("artifact"))
        {
            if let (Some(url), Some(path)) = (
                artifact.get("url").and_then(|u| u.as_str()),
                artifact.get("path").and_then(|p| p.as_str()),
            ) {
                files.push(PendingFile {
                    url: url.to_string(),
                    dest: libs_dir.join(path),
                    sha1: artifact.get("sha1").and_then(|s| s.as_str()).map(String::from),
                    size: artifact.get("size").and_then(|s| s.as_u64()).unwrap_or(0),
                });
            }
        } else if let Some(name) = lib.get("name").and_then(|n| n.as_str()) {
            // Fabric/Quilt-style maven-coordinate library (loader,
            // intermediary, mixin, etc.) — no `downloads` block at all.
            // Without this branch these never get downloaded, so the
            // loader jar is missing on disk and the JVM dies with
            // "Could not find or load main class ...knot.KnotClient".
            if let Some(path) = maven_name_to_path(name) {
                let repo = lib
                    .get("url")
                    .and_then(|u| u.as_str())
                    .unwrap_or("https://repo1.maven.org/maven2/");
                let repo = if repo.ends_with('/') { repo.to_string() } else { format!("{repo}/") };
                files.push(PendingFile {
                    url: format!("{repo}{path}"),
                    dest: libs_dir.join(&path),
                    // Fabric's meta doesn't publish a sha1/size for these,
                    // unlike Mojang's format — download_files() already
                    // treats a missing sha1 as "trust it, skip re-verify".
                    sha1: None,
                    size: 0,
                });
            }
        }

        // Legacy (pre-1.13-ish) natives classifier layout.
        if let Some(classifiers) = lib
            .get("downloads")
            .and_then(|d| d.get("classifiers"))
        {
            let native_key = if cfg!(target_os = "windows") {
                "natives-windows"
            } else if cfg!(target_os = "macos") {
                "natives-osx"
            } else {
                "natives-linux"
            };
            if let Some(native) = classifiers.get(native_key) {
                if let (Some(url), Some(path)) = (
                    native.get("url").and_then(|u| u.as_str()),
                    native.get("path").and_then(|p| p.as_str()),
                ) {
                    files.push(PendingFile {
                        url: url.to_string(),
                        dest: libs_dir.join(path),
                        sha1: native.get("sha1").and_then(|s| s.as_str()).map(String::from),
                        size: native.get("size").and_then(|s| s.as_u64()).unwrap_or(0),
                    });
                }
            }
        }
    }

    files
}

/// Resolves the client jar itself as a `PendingFile`.
pub fn resolve_client_jar(version_json: &serde_json::Value, version_id: &str) -> AppResult<PendingFile> {
    let client = version_json
        .get("downloads")
        .and_then(|d| d.get("client"))
        .ok_or_else(|| AppError::Other("Version JSON missing client download".into()))?;

    Ok(PendingFile {
        url: client
            .get("url")
            .and_then(|u| u.as_str())
            .ok_or_else(|| AppError::Other("Missing client jar url".into()))?
            .to_string(),
        dest: AppPaths::versions_dir().join(version_id).join(format!("{version_id}.jar")),
        sha1: client.get("sha1").and_then(|s| s.as_str()).map(String::from),
        size: client.get("size").and_then(|s| s.as_u64()).unwrap_or(0),
    })
}

/// Downloads a batch of files sequentially with SHA-1 verification,
/// reporting progress through the supplied callback after each file. A
/// production build would parallelize this with a bounded `JoinSet`; kept
/// sequential here for clarity and to make progress reporting trivial.
pub async fn download_files<F>(
    client: &reqwest::Client,
    files: Vec<PendingFile>,
    mut on_progress: F,
) -> AppResult<()>
where
    F: FnMut(&str, u64, u64),
{
    let total_bytes: u64 = files.iter().map(|f| f.size).sum();
    let mut downloaded: u64 = 0;

    for file in files {
        if let Some(parent) = file.dest.parent() {
            std::fs::create_dir_all(parent).map_err(AppError::from)?;
        }

        // Skip re-downloading files that already match their checksum.
        if file.dest.exists() {
            let meta_len = std::fs::metadata(&file.dest).map(|m| m.len()).unwrap_or(0);
            if let Some(sha1) = &file.sha1 {
                if sha1_matches(&file.dest, sha1) {
                    downloaded += file.size;
                    on_progress(&file_name(&file.dest), downloaded, total_bytes);
                    continue;
                }
            } else if meta_len > 0 {
                downloaded += file.size;
                continue;
            }
        }

        let resp = client
            .get(&file.url)
            .send()
            .await?
            .error_for_status()
            .map_err(|e| AppError::Other(format!("Download failed for {}: {e}", file.url)))?;

        let mut stream = resp.bytes_stream();
        let mut out = Vec::with_capacity(file.size as usize);
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(AppError::from)?;
            out.extend_from_slice(&chunk);
            downloaded += chunk.len() as u64;
            on_progress(&file_name(&file.dest), downloaded, total_bytes.max(downloaded));
        }

        std::fs::write(&file.dest, &out).map_err(AppError::from)?;

        if let Some(sha1) = &file.sha1 {
            if !sha1_matches(&file.dest, sha1) {
                return Err(AppError::Other(format!(
                    "Checksum mismatch for {}, download is corrupted",
                    file.dest.display()
                )));
            }
        }
    }

    Ok(())
}

fn file_name(path: &PathBuf) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default()
}

/// Collects the on-disk paths of every natives jar (`natives-<os>.jar`,
/// resolved via either the legacy `classifiers` layout or a modern artifact
/// path that happens to be OS-specific) this version needs.
fn resolve_natives_jars(version_json: &serde_json::Value) -> Vec<PathBuf> {
    let mut jars = Vec::new();
    let libs_dir = AppPaths::libraries_dir();

    let Some(libraries) = version_json.get("libraries").and_then(|l| l.as_array()) else {
        return jars;
    };

    let native_key = if cfg!(target_os = "windows") {
        "natives-windows"
    } else if cfg!(target_os = "macos") {
        "natives-osx"
    } else {
        "natives-linux"
    };

    for lib in libraries {
        if !library_allowed(lib) {
            continue;
        }

        if let Some(native) = lib
            .get("downloads")
            .and_then(|d| d.get("classifiers"))
            .and_then(|c| c.get(native_key))
        {
            if let Some(path) = native.get("path").and_then(|p| p.as_str()) {
                jars.push(libs_dir.join(path));
            }
        }
    }

    jars
}

/// Unpacks every natives jar this version needs into a flat per-version
/// folder so `-Djava.library.path` (and Mojang's `${natives_directory}`
/// placeholder) points at loose `.dll`/`.so`/`.dylib` files, exactly like
/// the official launcher does. Skips `META-INF/` and anything already
/// extracted. Without this step LWJGL/GLFW can't load, and the game
/// process dies before ever creating a window.
pub fn extract_natives(version_json: &serde_json::Value, version_id: &str) -> AppResult<PathBuf> {
    let dest_dir = AppPaths::natives_dir(version_id);
    let marker = dest_dir.join(".extracted");
    if marker.exists() {
        return Ok(dest_dir);
    }

    for jar_path in resolve_natives_jars(version_json) {
        let Ok(file) = std::fs::File::open(&jar_path) else {
            continue;
        };
        let Ok(mut archive) = zip::ZipArchive::new(file) else {
            continue;
        };

        for i in 0..archive.len() {
            let mut entry = archive.by_index(i).map_err(AppError::from)?;
            let Some(rel) = entry.enclosed_name().map(|p| p.to_path_buf()) else {
                continue;
            };
            let rel_str = rel.to_string_lossy();
            if entry.is_dir() || rel_str.starts_with("META-INF") {
                continue;
            }

            let out_path = dest_dir.join(rel.file_name().unwrap_or_default());
            let mut out_file = std::fs::File::create(&out_path).map_err(AppError::from)?;
            std::io::copy(&mut entry, &mut out_file).map_err(AppError::from)?;
        }
    }

    std::fs::write(&marker, b"1").map_err(AppError::from)?;
    Ok(dest_dir)
}
