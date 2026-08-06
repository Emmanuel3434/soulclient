use std::path::PathBuf;
use std::process::Command;

/// Attempts to locate a usable Java runtime: a custom path set on the
/// instance, the global setting, `JAVA_HOME`, or `java` on PATH — in that
/// order. Auto-downloading a bundled JRE per Mojang's `java-runtime`
/// manifest (like the official launcher does) is a larger undertaking left
/// as a TODO; this covers the common case of a system-installed JDK/JRE.
pub fn resolve_java(instance_java: Option<&str>, settings_java: &str) -> Option<PathBuf> {
    if let Some(path) = instance_java.filter(|p| !p.is_empty()) {
        return Some(PathBuf::from(path));
    }
    if !settings_java.is_empty() {
        return Some(PathBuf::from(settings_java));
    }
    if let Ok(home) = std::env::var("JAVA_HOME") {
        let bin = PathBuf::from(home).join("bin").join(if cfg!(windows) { "java.exe" } else { "java" });
        if bin.exists() {
            return Some(bin);
        }
    }
    if is_on_path("java") {
        return Some(PathBuf::from("java"));
    }
    None
}

fn is_on_path(bin: &str) -> bool {
    let mut command = Command::new(bin);
    command.arg("-version");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // Avoid flashing a console window just to probe for `java`.
        command.creation_flags(0x0800_0000);
    }
    command
        .output()
        .map(|o| o.status.success() || !o.stderr.is_empty())
        .unwrap_or(false)
}
