use ffmpeg_sidecar::{
    command::ffmpeg_is_installed,
    download::{check_latest_version, download_ffmpeg_package, ffmpeg_download_url, unpack_ffmpeg},
    paths::sidecar_dir,
    version::ffmpeg_version,
};
use log::{debug, error, info, warn};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use which::which;

#[cfg(not(windows))]
const EXECUTABLE_NAME: &str = "ffmpeg";

#[cfg(windows)]
const EXECUTABLE_NAME: &str = "ffmpeg.exe";

/// Ruta del ffmpeg bundleado junto al ejecutable. Extraída como función para
/// poder probarla sin arrancar la app: en `cargo test` el binario vive en
/// `target/debug/deps/`, donde el externalBin NO está.
#[allow(dead_code)] // en Linux sólo la usan los tests
fn bundled_candidate(exe_folder: &Path) -> PathBuf {
    exe_folder.join(EXECUTABLE_NAME)
}

/// Ruta de ffmpeg ya resuelta CON ÉXITO. Sólo se memoriza el éxito.
///
/// Antes era `Lazy<Option<PathBuf>>`, y ahí estaba el problema: un `None`
/// —porque el antivirus todavía tenía el .exe en cuarentena, porque el
/// externalBin aún no estaba junto al exe (`winapp run` construye `AppX\` con
/// SOLO lo que declara el manifest y descarta el payload suelto), o porque el
/// disco estaba ocupado— quedaba cacheado para TODO el proceso. A partir de ese
/// instante fallan `encode_single_audio` (encode.rs:90), `merge_checkpoints`
/// (incremental_saver.rs:307) y `recover_audio_from_checkpoints`
/// (incremental_saver.rs:444); y como `finalize()` aborta si el merge falla, se
/// pierde la reunión ENTERA aunque ffmpeg apareciera un segundo después.
/// Con `OnceLock` cada llamada posterior a un fallo vuelve a intentarlo — es lo
/// que hace que siga funcionando el rescate en caliente que documenta
/// `.claude/skills/store-msix/SKILL.md` (copiar ffmpeg.exe con la app corriendo).
static FFMPEG_PATH: OnceLock<PathBuf> = OnceLock::new();

/// Serializa los intentos de resolución. Sin esto, N hilos que fallan a la vez
/// dispararían N `handle_ffmpeg_installation()` concurrentes sobre el mismo
/// directorio destino (camino vivo en Linux y en dev sin bundle).
static FFMPEG_RESOLVE_LOCK: Mutex<()> = Mutex::new(());

pub fn find_ffmpeg_path() -> Option<PathBuf> {
    if let Some(cached) = FFMPEG_PATH.get() {
        return Some(cached.clone());
    }

    let _guard = FFMPEG_RESOLVE_LOCK.lock().unwrap_or_else(|poisoned| {
        error!("FFMPEG_RESOLVE_LOCK envenenado; se continúa con el guard recuperado");
        poisoned.into_inner()
    });

    // Otro hilo pudo resolverlo mientras esperábamos el lock.
    if let Some(cached) = FFMPEG_PATH.get() {
        return Some(cached.clone());
    }

    let resolved = find_ffmpeg_path_internal()?;
    let _ = FFMPEG_PATH.set(resolved.clone());
    Some(resolved)
}

fn find_ffmpeg_path_internal() -> Option<PathBuf> {
    debug!("Starting search for ffmpeg executable");

    // macOS y Windows: el bundle trae su propio ffmpeg como sidecar `externalBin`
    // (tauri.macos.conf.json / tauri.windows.conf.json) junto al ejecutable —
    // `Contents/MacOS/ffmpeg` en macOS, `ffmpeg.exe` en Windows. Va ANTES que PATH
    // para que la app use SIEMPRE el binario pineado y verificado por SHA en el
    // pre-build — también en máquinas de desarrollo con un ffmpeg de Homebrew, de
    // choco o el de gyan.dev que quedó de una descarga vieja — y para que bajo el
    // sandbox de la Mac App Store o el contenedor MSIX (donde PATH y
    // ~/.local/bin no existen ni se pueden escribir) nunca se llegue a la descarga
    // en runtime (#77 en macOS, #32 en Windows).
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_folder) = exe_path.parent() {
            let bundled = bundled_candidate(exe_folder);
            if bundled.is_file() {
                info!("Using bundled ffmpeg: {:?}", bundled);
                return Some(bundled);
            }
            debug!("No bundled ffmpeg next to the executable in {:?}", exe_folder);
        }
    }

    // Check if `ffmpeg` is in the PATH environment variable
    if let Ok(path) = which(EXECUTABLE_NAME) {
        debug!("Found ffmpeg in PATH: {:?}", path);
        return Some(path);
    }
    debug!("ffmpeg not found in PATH");

    // Check in $HOME/.local/bin on macOS
    #[cfg(target_os = "macos")]
    {
        if let Ok(home) = std::env::var("HOME") {
            let local_bin = PathBuf::from(home).join(".local").join("bin");
            debug!("Checking $HOME/.local/bin: {:?}", local_bin);
            let ffmpeg_in_local_bin = local_bin.join(EXECUTABLE_NAME);
            if ffmpeg_in_local_bin.exists() {
                debug!("Found ffmpeg in $HOME/.local/bin: {:?}", ffmpeg_in_local_bin);
                return Some(ffmpeg_in_local_bin);
            }
            debug!("ffmpeg not found in $HOME/.local/bin");
        }
    }

    // Check in current working directory
    if let Ok(cwd) = std::env::current_dir() {
        debug!("Current working directory: {:?}", cwd);
        let ffmpeg_in_cwd = cwd.join(EXECUTABLE_NAME);
        if ffmpeg_in_cwd.is_file() && ffmpeg_in_cwd.exists() {
            debug!(
                "Found ffmpeg in current working directory: {:?}",
                ffmpeg_in_cwd
            );
            return Some(ffmpeg_in_cwd);
        }
        debug!("ffmpeg not found in current working directory");
    }

    // Check in the same folder as the executable
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_folder) = exe_path.parent() {
            debug!("Executable folder: {:?}", exe_folder);
            let ffmpeg_in_exe_folder = exe_folder.join(EXECUTABLE_NAME);
            if ffmpeg_in_exe_folder.exists() {
                debug!(
                    "Found ffmpeg in executable folder: {:?}",
                    ffmpeg_in_exe_folder
                );
                return Some(ffmpeg_in_exe_folder);
            }
            debug!("ffmpeg not found in executable folder");

            // Platform-specific checks
            #[cfg(target_os = "macos")]
            {
                let resources_folder = exe_folder.join("../Resources");
                debug!("Resources folder: {:?}", resources_folder);
                let ffmpeg_in_resources = resources_folder.join(EXECUTABLE_NAME);
                if ffmpeg_in_resources.exists() {
                    debug!(
                        "Found ffmpeg in Resources folder: {:?}",
                        ffmpeg_in_resources
                    );
                    return Some(ffmpeg_in_resources);
                }
                debug!("ffmpeg not found in Resources folder");
            }

            #[cfg(target_os = "linux")]
            {
                let lib_folder = exe_folder.join("lib");
                debug!("Lib folder: {:?}", lib_folder);
                let ffmpeg_in_lib = lib_folder.join(EXECUTABLE_NAME);
                if ffmpeg_in_lib.exists() {
                    debug!("Found ffmpeg in lib folder: {:?}", ffmpeg_in_lib);
                    return Some(ffmpeg_in_lib);
                }
                debug!("ffmpeg not found in lib folder");
            }
        }
    }

    debug!("ffmpeg not found. installing...");

    if let Err(error) = handle_ffmpeg_installation() {
        error!("failed to install ffmpeg: {}", error);
        return None;
    }

    if let Ok(path) = which(EXECUTABLE_NAME) {
        debug!("found ffmpeg after installation: {:?}", path);
        return Some(path);
    }

    // Sin `unwrap()`: este camino corre DENTRO del resolver y un panic aquí
    // dejaría el proceso sin ninguna vía de encodear audio en toda la sesión.
    let installation_dir = match sidecar_dir() {
        Ok(dir) => dir,
        Err(e) => {
            error!("no se pudo resolver sidecar_dir() tras la instalación: {}", e);
            return None;
        }
    };
    let ffmpeg_in_installation = installation_dir.join(EXECUTABLE_NAME);
    if ffmpeg_in_installation.is_file() {
        debug!("found ffmpeg in directory: {:?}", ffmpeg_in_installation);
        return Some(ffmpeg_in_installation);
    }

    // Windows often has nested structure like ffmpeg-6.0-full_build/bin/ffmpeg.exe
    #[cfg(windows)]
    {
        debug!("Searching for nested ffmpeg in {:?}", installation_dir);
        if let Ok(entries) = std::fs::read_dir(&installation_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    // Check bin/ffmpeg.exe
                    let bin_ffmpeg = path.join("bin").join(EXECUTABLE_NAME);
                    if bin_ffmpeg.exists() {
                        debug!("found ffmpeg in nested bin: {:?}", bin_ffmpeg);
                        return Some(bin_ffmpeg);
                    }
                    // Check root of subdir
                    let root_ffmpeg = path.join(EXECUTABLE_NAME);
                    if root_ffmpeg.exists() {
                        debug!("found ffmpeg in nested root: {:?}", root_ffmpeg);
                        return Some(root_ffmpeg);
                    }
                }
            }
        }
    }

    error!("ffmpeg not found even after installation");
    None // Return None if ffmpeg is not found
}

fn handle_ffmpeg_installation() -> Result<(), anyhow::Error> {
    if ffmpeg_is_installed() {
        debug!("ffmpeg is already installed");
        return Ok(());
    }

    debug!("ffmpeg not found. installing...");
    match check_latest_version() {
        Ok(version) => debug!("latest version: {}", version),
        Err(e) => debug!("skipping version check due to error: {e}"),
    }

    let download_url = ffmpeg_download_url()?;
    let destination = get_ffmpeg_install_dir()?;

    // Foto del directorio ANTES de desempaquetar: lo que ya estaba ahí es del
    // usuario y no se toca (ver `remove_unused_ffmpeg_tools`).
    let preexisting_tools: Vec<PathBuf> = unused_ffmpeg_tools(&destination)
        .into_iter()
        .filter(|p| p.exists())
        .collect();

    debug!("downloading from: {:?}", download_url);
    let archive_path = download_ffmpeg_package(download_url, &destination)?;
    debug!("downloaded package: {:?}", archive_path);

    debug!("extracting...");
    unpack_ffmpeg(&archive_path, &destination)?;

    // `unpack_ffmpeg` mueve los TRES binarios del zip junto al ejecutable
    // (download.rs:350-358: ffmpeg + ffprobe + ffplay). Maity no ejecuta ffprobe
    // ni ffplay en ninguna parte — cero coincidencias en src-tauri/src — así que
    // son ~190 MB de peso muerto y superficie de escaneo. Best-effort.
    remove_unused_ffmpeg_tools(&destination, &preexisting_tools);

    let version = ffmpeg_version()?;

    debug!("done! installed ffmpeg version {}", version);
    Ok(())
}

/// Rutas de los binarios que `unpack_ffmpeg` deja al lado de ffmpeg y que Maity
/// no ejecuta nunca (cero call sites de ffprobe/ffplay en `src-tauri/src`).
fn unused_ffmpeg_tools(dir: &Path) -> [PathBuf; 2] {
    #[cfg(windows)]
    const UNUSED: [&str; 2] = ["ffprobe.exe", "ffplay.exe"];
    #[cfg(not(windows))]
    const UNUSED: [&str; 2] = ["ffprobe", "ffplay"];

    [dir.join(UNUSED[0]), dir.join(UNUSED[1])]
}

/// Borra los binarios que `unpack_ffmpeg` ACABA de dejar al lado de ffmpeg y que
/// Maity no ejecuta nunca. `preexisting` lleva los que ya estaban antes del
/// unpack: esos NO son nuestros y no se tocan.
///
/// Ese filtro no es cosmético — el directorio destino NO es privado de la app
/// fuera de Windows: `get_ffmpeg_install_dir()` devuelve `~/.local/bin` en macOS
/// y la carpeta del ejecutable en Linux (`/usr/bin` en un `.deb`). Un borrado
/// incondicional se llevaría por delante el `ffprobe`/`ffplay` que el usuario
/// instaló él mismo, y el guard de `handle_ffmpeg_installation` sólo mira si hay
/// `ffmpeg`, así que ese caso es alcanzable. Best-effort: cada fallo se loguea y
/// se sigue — ffmpeg ya está donde tiene que estar y ese es el objetivo.
fn remove_unused_ffmpeg_tools(dir: &Path, preexisting: &[PathBuf]) {
    for path in unused_ffmpeg_tools(dir) {
        if !path.is_file() || preexisting.contains(&path) {
            continue;
        }
        match std::fs::remove_file(&path) {
            Ok(()) => info!("Removed unused ffmpeg tool: {:?}", path),
            Err(e) => warn!("Could not remove unused ffmpeg tool {:?}: {}", path, e),
        }
    }
}

#[cfg(target_os = "macos")]
fn get_ffmpeg_install_dir() -> Result<PathBuf, anyhow::Error> {
    let home = dirs::home_dir().ok_or_else(|| anyhow::anyhow!("couldn't find home directory"))?;

    let local_bin = home.join(".local").join("bin");

    // Create directory if it doesn't exist
    if !local_bin.exists() {
        debug!("creating .local/bin directory");
        std::fs::create_dir_all(&local_bin)?;

        // Check both .bashrc and .zshrc
        let shell_configs = vec![
            home.join(".bashrc"),
            home.join(".bash_profile"), // macOS often uses .bash_profile instead of .bashrc
            home.join(".zshrc"),
        ];

        for config in shell_configs {
            if config.exists() {
                let content = std::fs::read_to_string(&config)?;
                if !content.contains(".local/bin") {
                    debug!("adding .local/bin to PATH in {:?}", config);
                    std::fs::write(
                        config,
                        format!("{}\nexport PATH=\"$HOME/.local/bin:$PATH\"\n", content),
                    )?;
                }
            }
        }
    }

    Ok(local_bin)
}

// For other platforms, keep your existing installation directory logic
#[cfg(not(target_os = "macos"))]
fn get_ffmpeg_install_dir() -> Result<PathBuf, anyhow::Error> {
    // Your existing logic for other platforms
    sidecar_dir().map_err(|e| anyhow::anyhow!(e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    // NOTA: aquí NO se llama a `find_ffmpeg_path()`. En una máquina sin ffmpeg
    // dispararía `handle_ffmpeg_installation()` → una descarga real, y el binario
    // de test corre desde `target/debug/deps/`, donde el externalBin no está.
    // Sólo se prueban las costuras puras.

    #[test]
    fn bundled_candidate_usa_el_nombre_de_la_plataforma() {
        let dir = tempdir().unwrap();
        let got = bundled_candidate(dir.path());
        assert_eq!(got, dir.path().join(EXECUTABLE_NAME));
        assert_eq!(
            got.file_name().unwrap(),
            std::ffi::OsStr::new(EXECUTABLE_NAME),
            "el nombre debe ser ffmpeg.exe en Windows y ffmpeg en el resto"
        );
    }

    #[test]
    fn remove_unused_ffmpeg_tools_borra_ffprobe_y_ffplay_y_conserva_ffmpeg() {
        let dir = tempdir().unwrap();
        let suffix = if cfg!(windows) { ".exe" } else { "" };
        for name in ["ffmpeg", "ffprobe", "ffplay"] {
            std::fs::write(dir.path().join(format!("{name}{suffix}")), b"x").unwrap();
        }

        // Nada preexistía: los tres los acaba de dejar el unpack.
        remove_unused_ffmpeg_tools(dir.path(), &[]);

        assert!(
            dir.path().join(format!("ffmpeg{suffix}")).is_file(),
            "ffmpeg NO se debe borrar: es el binario que usa la app"
        );
        assert!(!dir.path().join(format!("ffprobe{suffix}")).exists());
        assert!(!dir.path().join(format!("ffplay{suffix}")).exists());
    }

    #[test]
    fn remove_unused_ffmpeg_tools_conserva_los_que_ya_estaban() {
        // El destino es compartido fuera de Windows (~/.local/bin en macOS,
        // /usr/bin en un .deb): un ffprobe del usuario NO se puede borrar.
        let dir = tempdir().unwrap();
        let suffix = if cfg!(windows) { ".exe" } else { "" };
        let ffprobe = dir.path().join(format!("ffprobe{suffix}"));
        let ffplay = dir.path().join(format!("ffplay{suffix}"));
        std::fs::write(&ffprobe, b"del usuario").unwrap();
        std::fs::write(&ffplay, b"del unpack").unwrap();

        remove_unused_ffmpeg_tools(dir.path(), &[ffprobe.clone()]);

        assert!(ffprobe.is_file(), "el ffprobe preexistente es del usuario");
        assert!(!ffplay.exists(), "ffplay lo dejó el unpack: se borra");
    }

    #[test]
    fn unused_ffmpeg_tools_lista_ffprobe_y_ffplay_de_la_plataforma() {
        let dir = tempdir().unwrap();
        let suffix = if cfg!(windows) { ".exe" } else { "" };
        assert_eq!(
            unused_ffmpeg_tools(dir.path()),
            [
                dir.path().join(format!("ffprobe{suffix}")),
                dir.path().join(format!("ffplay{suffix}")),
            ]
        );
    }

    #[test]
    fn remove_unused_ffmpeg_tools_es_idempotente_sin_archivos() {
        let dir = tempdir().unwrap();
        remove_unused_ffmpeg_tools(dir.path(), &[]); // no debe entrar en pánico
        remove_unused_ffmpeg_tools(dir.path(), &[]);
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
    }
}
