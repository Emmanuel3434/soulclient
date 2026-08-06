use crate::auth::Account;
use crate::instances::InstanceConfig;
use crate::presence::DiscordPresence;
use crate::utils::paths::AppPaths;
use crate::utils::{AppError, AppResult};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Arc;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

// Prevents Windows from popping up a console window for a spawned
// console-subsystem process (java.exe, attrib.exe, etc.) when our own app
// has no console of its own — this is what showed up as stray "terminals"
// instead of just the game window.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Builds the classpath (client jar + every resolved library jar) and
/// launches `java` with the arguments vanilla/Fabric expect, substituting
/// Mojang's `${...}` placeholders with real values (auth, paths, window
/// size). Natives (`*-natives-<os>.jar`) are unpacked once per version into
/// a loose-file folder via `libraries::extract_natives`, and that folder is
/// what `${natives_directory}` / `-Djava.library.path` point at.
pub fn launch(
    java_bin: &PathBuf,
    version_json: &serde_json::Value,
    version_id: &str,
    instance: &InstanceConfig,
    account: &Account,
    protected_mods_dir: Option<&Path>,
    discord_presence: Option<Arc<DiscordPresence>>,
) -> AppResult<()> {
    let main_class = version_json
        .get("mainClass")
        .and_then(|m| m.as_str())
        .unwrap_or("net.minecraft.client.main.Main");

    // Guardrail explícito: si la instancia requiere Fabric, el mainClass
    // resuelto tiene que ser el de Fabric (Knot), no el vanilla normal. Si
    // por lo que sea llegó vanilla hasta aquí (JSON cacheado corrupto/de
    // otra instancia, fallo silencioso en el merge, etc.) preferimos
    // cancelar el lanzamiento con un error claro antes que arrancar sin
    // mods y sin que se note por qué.
    if instance.loader == crate::instances::LoaderType::Fabric {
        let looks_like_fabric = main_class.to_ascii_lowercase().contains("fabric")
            || main_class.to_ascii_lowercase().contains("knot");
        if !looks_like_fabric {
            return Err(AppError::from(format!(
                "Esta instancia requiere Fabric, pero el perfil resuelto usaría mainClass = \"{main_class}\" (vanilla). Cancelando para no iniciar sin Fabric/los mods. Vuelve a pulsar \"Jugar\" para reintentar la instalación."
            )));
        }
    }

    let mut client_jar = AppPaths::versions_dir().join(version_id).join(format!("{version_id}.jar"));
    if !client_jar.exists() {
        let alt = AppPaths::versions_dir().join(instance.version_cache_key()).join(format!("{}.jar", instance.version_cache_key()));
        if alt.exists() {
            client_jar = alt;
        }
    }
    let mut classpath: Vec<String> = vec![client_jar.to_string_lossy().to_string()];

    if let Some(libraries) = version_json.get("libraries").and_then(|l| l.as_array()) {
        for lib in libraries {
            if let Some(path) = lib
                .get("downloads")
                .and_then(|d| d.get("artifact"))
                .and_then(|a| a.get("path"))
                .and_then(|p| p.as_str())
            {
                classpath.push(AppPaths::libraries_dir().join(path).to_string_lossy().to_string());
            } else if let Some(name) = lib.get("name").and_then(|n| n.as_str()) {
                // Fabric/Quilt maven-coordinate library — see
                // `libraries::maven_name_to_path` for why this branch
                // exists: without it the Fabric Loader jar itself never
                // makes it onto the classpath.
                if let Some(path) = super::libraries::maven_name_to_path(name) {
                    classpath.push(AppPaths::libraries_dir().join(path).to_string_lossy().to_string());
                }
            }
        }
    }

    let separator = if cfg!(windows) { ";" } else { ":" };
    let classpath_str = classpath.join(separator);

    let mut placeholders: HashMap<&str, String> = HashMap::new();
    placeholders.insert("auth_player_name", account.username.clone());
    placeholders.insert("version_name", instance.version.clone());
    placeholders.insert("game_directory", instance.directory.clone());
    placeholders.insert("assets_root", AppPaths::assets_dir().to_string_lossy().to_string());
    // BUG FIX (audio silencioso + panorama animado ausente, ambos "el menú
    // usa los valores por defecto de Minecraft"): esto usaba `version_id`
    // (p.ej. "1.20.1") como si fuera también el id del asset index, pero
    // Mojang no garantiza que coincidan — muchas versiones comparten un
    // mismo asset index con un id distinto (numérico, o el de una versión
    // anterior). `assets.rs` ya guarda el índice real en
    // `assets/indexes/{assetIndex.id}.json`; si aquí se le pasa a Java un
    // `--assetIndex` que no coincide con ese nombre de archivo, Minecraft
    // no encuentra el índice, no resuelve ningún asset (sonidos, panorama
    // del menú, etc.) y cae en sus valores por defecto — exactamente lo
    // reportado. Se usa el id real del version JSON, con el propio
    // version_id sólo como último recurso si por algo faltara.
    let asset_index_id = version_json
        .get("assetIndex")
        .and_then(|a| a.get("id"))
        .and_then(|id| id.as_str())
        .unwrap_or(version_id);
    placeholders.insert("assets_index_name", asset_index_id.to_string());
    placeholders.insert("auth_uuid", account.uuid.clone());
    placeholders.insert(
        "auth_access_token",
        account.access_token.clone().unwrap_or_else(|| "0".to_string()),
    );
    placeholders.insert("user_type", "msa".to_string());
    placeholders.insert("version_type", "SoulClient".to_string());

    // LWJGL/GLFW/OpenAL need their native libraries as loose files on disk,
    // not sitting inside a `natives-<os>.jar`. Without this the JVM starts
    // but immediately fails to load its window/audio bindings and dies —
    // which is what looked like "just a terminal, no Minecraft window".
    let natives_dir = super::libraries::extract_natives(version_json, version_id)?;
    placeholders.insert("natives_directory", natives_dir.to_string_lossy().to_string());
    placeholders.insert("launcher_name", "SoulClient".to_string());
    placeholders.insert("launcher_version", "0.1.0".to_string());
    placeholders.insert("classpath", classpath_str.clone());

    // ── JVM flags optimizados (Aikar + LWJGL + audio) ──────────────────────
    // Tomados de I:\SoulClient config.rs para máximo rendimiento y estabilidad.
    // Los flags de Aikar mejoran la recolección de basura. Los de LWJGL
    // desactivan la salida de depuración que spamea el log. Los de audio
    // (OpenAL/javax.sound) evitan el audio silencioso en Windows.
    let min_ram_mb = (instance.ram_mb / 4).max(512); // 25% del máximo, mínimo 512MB
    let mut jvm_args: Vec<String> = vec![
        format!("-Xms{}M", min_ram_mb),
        format!("-Xmx{}M", instance.ram_mb),
        // Aikar GC flags — mejoran el rendimiento general
        "-XX:+UseG1GC".to_string(),
        "-XX:+ParallelRefProcEnabled".to_string(),
        "-XX:MaxGCPauseMillis=200".to_string(),
        "-XX:+DisableExplicitGC".to_string(),
        "-XX:+AlwaysPreTouch".to_string(),
        "-XX:+PerfDisableSharedMem".to_string(),
        "-XX:MaxTenuringThreshold=1".to_string(),
        "-Dusing.aikars.flags=https://mcflags.emc.gs".to_string(),
        "-Daikars.new.flags=true".to_string(),
        // LWJGL — desactivar debug output que causa spam en el log
        "-Dorg.lwjgl.util.Debug=false".to_string(),
        "-Dorg.lwjgl.util.DebugLoader=false".to_string(),
        "-Dorg.lwjgl.util.DebugAllocator=false".to_string(),
        "-Dorg.lwjgl.util.DebugStack=false".to_string(),
        "-Dorg.lwjgl.util.DebugMemory=false".to_string(),
        "-Djava.awt.headless=false".to_string(),
        // Classpath y natives
        format!("-Djava.library.path={}", natives_dir.to_string_lossy()),
        "-cp".to_string(),
        classpath_str,
    ];

    // Flags extra específicos de Windows (audio DirectSound, renderizado)
    #[cfg(windows)]
    {
        jvm_args.extend([
            "-Dsun.java2d.d3d=false".to_string(),
            "-Dsun.java2d.opengl=false".to_string(),
            "-Dsun.java2d.noddraw=true".to_string(),
            "-Djavax.sound.sampled.Clip=com.sun.media.sound.DirectAudioDeviceProvider".to_string(),
            "-Djavax.sound.sampled.Port=com.sun.media.sound.PortMixerProvider".to_string(),
            "-Djavax.sound.sampled.SourceDataLine=com.sun.media.sound.DirectAudioDeviceProvider".to_string(),
            "-Djavax.sound.sampled.TargetDataLine=com.sun.media.sound.DirectAudioDeviceProvider".to_string(),
        ]);
    }

    // macOS requiere este flag o el hilo OpenGL crashea al arrancar
    #[cfg(target_os = "macos")]
    {
        jvm_args.push("-XstartOnFirstThread".to_string());
    }

    // JVM args adicionales definidos por el usuario/admin en la instancia
    for extra in instance.jvm_args.split_whitespace() {
        jvm_args.push(extra.to_string());
    }

    // Protected mods never live in the instance's own `mods/` folder. When
    // the instance has any, they were just decrypted into a throwaway
    // runtime folder (see `modvault::stage_for_launch`), and we point
    // Fabric Loader at it directly via its own extra-mod-locations
    // mechanism — the instance folder itself stays untouched.
    if instance.loader == crate::instances::LoaderType::Fabric {
        if let Some(dir) = protected_mods_dir {
            let mut add_mods_val = dir.to_string_lossy().to_string();
            if let Ok(entries) = std::fs::read_dir(dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_file() && path.extension().map_or(false, |ext| ext.eq_ignore_ascii_case("jar")) {
                        add_mods_val.push_str(separator);
                        add_mods_val.push_str(&path.to_string_lossy());
                    }
                }
            }
            jvm_args.push(format!("-Dfabric.addMods={add_mods_val}"));
        }
    }

    jvm_args.push(main_class.to_string());

    let game_args = build_game_args(version_json, &placeholders, instance);
    jvm_args.extend(game_args);

    tracing::info!("Launching {} with {} args", java_bin.display(), jvm_args.len());

    let mut command = Command::new(java_bin);
    command
        .args(&jvm_args)
        .current_dir(&instance.directory)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let mut child = command.spawn().map_err(AppError::from)?;

    // stdout/stderr are piped above so the child doesn't inherit our own
    // (hidden) console, but a pipe nobody drains fills up fast — Java/LWJGL
    // write plenty of startup logging, and once the OS pipe buffer (~64KB)
    // is full the child blocks on write() and never gets as far as opening
    // a window. This is what looked like "launched successfully" with no
    // window and no process ever really running: the process existed, it
    // just hung. These threads keep both pipes drained for the whole life
    // of the process and mirror the output into our own log / an early
    // crash buffer.
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let tail: Arc<std::sync::Mutex<Vec<String>>> = Arc::new(std::sync::Mutex::new(Vec::new()));

    let drain = |pipe: Option<std::process::ChildStdout>,
                 tail: Arc<std::sync::Mutex<Vec<String>>>,
                 label: &'static str| {
        if let Some(pipe) = pipe {
            std::thread::spawn(move || {
                use std::io::{BufRead, BufReader};
                for line in BufReader::new(pipe).lines().map_while(Result::ok) {
                    tracing::info!("[{label}] {line}");
                    let mut t = tail.lock().unwrap();
                    t.push(line);
                    if t.len() > 200 {
                        t.remove(0);
                    }
                }
            });
        }
    };
    let drain_err = |pipe: Option<std::process::ChildStderr>,
                      tail: Arc<std::sync::Mutex<Vec<String>>>,
                      label: &'static str| {
        if let Some(pipe) = pipe {
            std::thread::spawn(move || {
                use std::io::{BufRead, BufReader};
                for line in BufReader::new(pipe).lines().map_while(Result::ok) {
                    tracing::info!("[{label}] {line}");
                    let mut t = tail.lock().unwrap();
                    t.push(line);
                    if t.len() > 200 {
                        t.remove(0);
                    }
                }
            });
        }
    };
    drain(stdout, tail.clone(), "java stdout");
    drain_err(stderr, tail.clone(), "java stderr");

    // Give the JVM a brief window to fail fast (bad classpath, missing
    // natives, corrupt/incompatible mod jar, etc.) before we tell the
    // frontend it launched. Only mark the game as started once we've
    // confirmed the process is still alive, not merely that spawn()
    // returned Ok — spawning succeeds even for a process that crashes a
    // few milliseconds later.
    let grace = std::time::Duration::from_millis(1500);
    let poll_step = std::time::Duration::from_millis(50);
    let mut waited = std::time::Duration::ZERO;
    let exited_early = loop {
        match child.try_wait().map_err(AppError::from)? {
            Some(status) => break Some(status),
            None => {
                if waited >= grace {
                    break None;
                }
                std::thread::sleep(poll_step);
                waited += poll_step;
            }
        }
    };

    if let Some(status) = exited_early {
        // The process already died inside the grace window: this is a
        // real launch failure, not a successful launch. Surface the
        // buffered Java output instead of reporting success.
        if protected_mods_dir.is_some() {
            crate::modvault::ModVault::cleanup_runtime(&instance.id);
        }
        let log_tail = tail.lock().unwrap().join("\n");
        let detail = if log_tail.trim().is_empty() {
            format!("Java salió inmediatamente (código {status}) sin producir salida.")
        } else {
            format!("Java salió inmediatamente (código {status}):\n{log_tail}")
        };
        return Err(AppError::from(detail));
    }

    if let Some(presence) = &discord_presence {
        presence.set_playing(&instance.name);
    }

    // Now that we've confirmed it's actually alive, keep waiting on a
    // background thread for the game to exit: if we staged decrypted mods
    // for this session, wipe them immediately afterwards rather than
    // leaving plaintext jars sitting on disk, and in any case put Discord
    // Rich Presence back to the idle state once the player isn't in-game
    // anymore.
    let wipe_mods = protected_mods_dir.is_some();
    let instance_id = instance.id.clone();
    std::thread::spawn(move || {
        let _ = child.wait();
        if wipe_mods {
            crate::modvault::ModVault::cleanup_runtime(&instance_id);
        }
        if let Some(presence) = discord_presence {
            presence.set_idle();
        }
    });

    Ok(())
}

fn build_game_args(
    version_json: &serde_json::Value,
    placeholders: &HashMap<&str, String>,
    instance: &InstanceConfig,
) -> Vec<String> {
    // Modern versions (1.13+) store a structured `arguments.game` array;
    // legacy versions use a flat `minecraftArguments` string.
    let mut args: Vec<String> = Vec::new();

    if let Some(flat) = version_json.get("minecraftArguments").and_then(|a| a.as_str()) {
        args.extend(flat.split_whitespace().map(|s| substitute(s, placeholders)));
    } else if let Some(game) = version_json
        .get("arguments")
        .and_then(|a| a.get("game"))
        .and_then(|g| g.as_array())
    {
        for entry in game {
            if let Some(s) = entry.as_str() {
                args.push(substitute(s, placeholders));
            } else if let Some(obj) = entry.as_object() {
                if let Some(val) = obj.get("value") {
                    if let Some(s) = val.as_str() {
                        args.push(substitute(s, placeholders));
                    } else if let Some(arr) = val.as_array() {
                        for item in arr {
                            if let Some(s) = item.as_str() {
                                args.push(substitute(s, placeholders));
                            }
                        }
                    }
                }
            }
        }
    }

    // Ensure --gameDir is explicitly present so Fabric Loader always searches instance.directory/mods
    let has_game_dir = args.iter().any(|a| a == "--gameDir");
    if !has_game_dir {
        args.push("--gameDir".to_string());
        args.push(instance.directory.clone());
    }

    if instance.fullscreen {
        args.push("--fullscreen".to_string());
    } else {
        args.push("--width".to_string());
        args.push(instance.resolution_width.to_string());
        args.push("--height".to_string());
        args.push(instance.resolution_height.to_string());
    }

    args
}

fn substitute(input: &str, placeholders: &HashMap<&str, String>) -> String {
    let mut out = input.to_string();
    for (key, value) in placeholders {
        out = out.replace(&format!("${{{key}}}"), value);
    }
    out
}
