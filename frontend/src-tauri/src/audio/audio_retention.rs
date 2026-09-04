//! Barrido de retención del audio local.
//!
//! Ninguna ruta de código del repo borraba jamás una carpeta de reunión
//! (`grep remove_dir_all/remove_file` sobre todo `src-tauri/src` sólo devuelve
//! modelos, logs, WAL/SHM, temporales de export y `.checkpoints`): el
//! `audio.mp4` de cada reunión se acumulaba para siempre. Este módulo libera el
//! audio de las reuniones que ya están **sincronizadas Y analizadas** en la
//! nube, y conserva `transcripts.json` y `metadata.json`.
//!
//! **Por qué una tarea propia y no un tick prestado:**
//! - `cloud_sync::worker` se auto-gatea por `current_user_id` + sesión Supabase
//!   (`worker.rs:212-233`): colgado ahí, el barrido dejaría de correr en cuanto
//!   la sesión cayera, aunque las reuniones que toca ya estén sincronizadas
//!   desde hace semanas. Siendo tarea propia, el ciclo de vida del barrido no
//!   depende del worker ni de su gate. (Ojo: esto NO significa que alcance a
//!   los usuarios offline — ver `list_audio_retention_candidates`: sin un
//!   `finalize_conversation` completado no hay candidata, y eso exige un viaje
//!   exitoso a la nube.)
//! - `logging::mem_sampler` mueve un `System` dentro/fuera de `spawn_blocking`
//!   en cada tick; meter `remove_file` ahí contaminaría el timing de la muestra.
//! - `drain.rs` es el molde estructural de esta tarea (`spawn` + `run` con
//!   delay de arranque y loop), pero no su sede: son dominios distintos.
//!
//! **Delay de arranque de 120 s** a propósito: `autoRecoverAll` corre AL
//! ARRANQUE, en serie, lanzando FFmpeg por reunión para fusionar checkpoints
//! (CLAUDE.md § Recuperación). Barrer antes podría borrar audio recién
//! fusionado. Es defensa en profundidad: la condición de elegibilidad ya exige
//! un `finalize_conversation` completado hace ≥1 día, y lo que la recuperación
//! acaba de fusionar no lo tiene.

use std::path::Path;
use std::time::Duration;

use tauri::{AppHandle, Manager, Runtime};

use crate::database::repositories::meeting::MeetingsRepository;

/// Ver el doc-comment del módulo: le deja pista libre a `autoRecoverAll`.
const STARTUP_DELAY_SECS: u64 = 120;
/// Cada 6 h. El barrido es de disco frío: no hay ninguna urgencia y así una
/// sesión larga tiene varias oportunidades sin costar nada perceptible.
const TICK_SECS: u64 = 6 * 60 * 60;
/// Tope de reuniones por pasada. Un usuario con un año de backlog no debe
/// convertir la primera pasada en cientos de `remove_dir_all` seguidos.
const SWEEP_LIMIT: i64 = 200;

pub fn spawn<R: Runtime>(app: AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        run(app).await;
    });
}

async fn run<R: Runtime>(app: AppHandle<R>) {
    tokio::time::sleep(Duration::from_secs(STARTUP_DELAY_SECS)).await;
    loop {
        sweep_once(&app).await;
        tokio::time::sleep(Duration::from_secs(TICK_SECS)).await;
    }
}

/// Traduce la preferencia del usuario a los días efectivos de retención.
///
/// `0` = "nunca borrar" y devuelve `None`: el barrido no hace NADA, ni siquiera
/// la consulta. Cualquier otro valor pasa tal cual, así que el mínimo efectivo
/// es 1 día — lo garantiza el TIPO (`u32` sin el 0, que ya se descartó), no un
/// clamp: un `.max(1)` aquí sería código muerto y haría creer que existe una
/// salvaguarda contra valores fuera de rango. Si alguna vez la preferencia
/// pudiera llegar negativa o fraccionaria, el clamp va en su deserialización,
/// no aquí.
///
/// Función PURA: es la única parte de la política testeable sin DB ni disco.
pub(crate) fn effective_retention_days(pref: u32) -> Option<u32> {
    if pref == 0 {
        None
    } else {
        Some(pref)
    }
}

/// Una pasada. Nunca propaga error: el barrido jamás rompe nada aguas arriba.
async fn sweep_once<R: Runtime>(app: &AppHandle<R>) {
    let prefs = match crate::audio::recording_preferences::load_recording_preferences(app).await {
        Ok(p) => p,
        Err(e) => {
            log::warn!("[audio-retention] no se pudieron leer las preferencias: {}", e);
            return;
        }
    };

    let Some(days) = effective_retention_days(prefs.audio_retention_days) else {
        // El usuario eligió "Nunca borrar": ni consulta.
        return;
    };

    // El pool se CLONA (es un Arc por dentro) en vez de sostener el
    // `State<'_, AppState>` a través de los `.await` del bucle: evita atar la
    // vida de un préstamo del AppHandle a un futuro largo.
    let pool = {
        let Some(state) = app.try_state::<crate::state::AppState>() else {
            log::warn!("[audio-retention] AppState no disponible; se salta la pasada");
            return;
        };
        state.db_manager.pool().clone()
    };

    let candidates = match MeetingsRepository::list_audio_retention_candidates(
        &pool,
        days as i64,
        SWEEP_LIMIT,
    )
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            log::warn!("[audio-retention] fallo al listar candidatas: {}", e);
            return;
        }
    };

    if candidates.is_empty() {
        return;
    }

    let mut meetings_swept: u64 = 0;
    let mut bytes_freed: u64 = 0;
    let mut failed: u64 = 0;

    for (meeting_id, folder_path) in candidates {
        let folder = std::path::PathBuf::from(&folder_path);
        let removed = tokio::task::spawn_blocking(move || remove_audio_artifacts(&folder)).await;

        match removed {
            Ok(Ok(bytes)) => bytes_freed += bytes,
            Ok(Err(e)) => {
                // Sin marcar: se reintenta en la próxima pasada.
                log::warn!(
                    "[audio-retention] no se pudo liberar el audio de {}: {}",
                    folder_path,
                    e
                );
                failed += 1;
                continue;
            }
            Err(e) => {
                log::warn!("[audio-retention] tarea de borrado abortada ({}): {}", folder_path, e);
                failed += 1;
                continue;
            }
        }

        // Se marca TAMBIÉN cuando el archivo ya no existía (bytes = 0): sin la
        // marca la fila vuelve a salir candidata cada 6 h para siempre.
        match MeetingsRepository::mark_audio_deleted(&pool, &meeting_id).await {
            Ok(_) => meetings_swept += 1,
            Err(e) => {
                log::warn!(
                    "[audio-retention] audio liberado pero no se pudo marcar {}: {}",
                    meeting_id,
                    e
                );
                failed += 1;
            }
        }
    }

    log::info!(
        "[audio-retention] pasada: {} reuniones, {} bytes liberados, {} fallos (retención {} días)",
        meetings_swept,
        bytes_freed,
        failed,
        days
    );

    emit_retention_swept(app, meetings_swept, bytes_freed, days, failed).await;
}

/// Libera los artefactos de AUDIO de una carpeta de reunión y devuelve los bytes
/// liberados.
///
/// Qué borra:
/// - `audio.mp4` (el nombre lo sella `IncrementalAudioSaver::finalize`).
/// - `.checkpoints/` si sobrevivió: `recover_audio_from_checkpoints` NO lo borra
///   (sólo `concat_list.txt`), así que tras una recuperación post-crash la
///   carpeta pesa ~2× y los chunks son puro desperdicio.
///
/// Qué CONSERVA siempre:
/// - `transcripts.json` — lo leen `finalize_segment_native` y la recuperación.
/// - `metadata.json` — se parchea, no se borra.
///
/// No borra la carpeta: `reveal_in_folder` valida existencia del path antes de
/// abrir el Explorador, y una carpeta con los JSON sigue siendo un destino
/// válido para el usuario.
pub(crate) fn remove_audio_artifacts(folder: &Path) -> std::io::Result<u64> {
    let mut freed: u64 = 0;

    let audio = folder.join("audio.mp4");
    match std::fs::metadata(&audio) {
        Ok(meta) => {
            let len = meta.len();
            std::fs::remove_file(&audio)?;
            freed += len;
        }
        // Ya no estaba: no es un error, es el caso idempotente.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e),
    }

    // El fallo de `remove_dir_all` NO puede propagarse antes de parchear el
    // manifiesto: el `audio.mp4` ya se borró unas líneas arriba y un `?` aquí
    // dejaría `metadata.json` apuntando a un archivo inexistente hasta la
    // siguiente pasada (6 h). En Windows el caso realista es un `.checkpoints`
    // con un handle abierto por el antivirus o el Explorador.
    //
    // Sí se propaga DESPUÉS de parchear, y a propósito: el error deja la fila
    // sin marcar en `meetings.audio_deleted_at`, así que la próxima pasada
    // vuelve a intentar el directorio (el `audio.mp4` ya no está y el borrado
    // es idempotente). Devolver `Ok` aquí marcaría la fila y ese `.checkpoints`
    // —que pesa ~2× el mp4— se quedaría en disco para SIEMPRE, justo la fuga
    // que este módulo existe para cerrar. El precio es que los bytes del mp4 no
    // suman a la telemetría de esa pasada; van en el log para que no sean
    // invisibles (`dir_size` ya declara que el número es telemetría, no
    // contabilidad).
    let checkpoints = folder.join(".checkpoints");
    let checkpoints_err = if checkpoints.is_dir() {
        let size = dir_size(&checkpoints);
        match std::fs::remove_dir_all(&checkpoints) {
            Ok(()) => {
                freed += size;
                None
            }
            Err(e) => Some(e),
        }
    } else {
        None
    };

    patch_metadata_audio_deleted(folder);

    if let Some(e) = checkpoints_err {
        log::warn!(
            "[audio-retention] {} bytes de audio.mp4 liberados en {:?}, pero .checkpoints no se pudo borrar: {} (se reintenta en la próxima pasada)",
            freed,
            folder,
            e
        );
        return Err(e);
    }

    Ok(freed)
}

/// Tamaño recursivo, best-effort: si un `read_dir` o un `metadata` falla se
/// cuenta 0 en vez de abortar. El número es telemetría, no contabilidad.
fn dir_size(dir: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    let mut total: u64 = 0;
    for entry in entries.flatten() {
        match entry.metadata() {
            Ok(m) if m.is_dir() => total += dir_size(&entry.path()),
            Ok(m) => total += m.len(),
            Err(_) => {}
        }
    }
    total
}

/// Deja `metadata.json` diciendo la verdad.
///
/// `RecordingSaver::initialize_meeting_folder` escribe `audio_file: "audio.mp4"`;
/// si se borra el archivo sin tocar el JSON, la carpeta queda con un manifiesto
/// que miente. Se parchea como `serde_json::Value` (no como una struct tipada) a
/// propósito: el shape de ese archivo lo define el saver y puede crecer; un
/// round-trip tipado perdería en silencio cualquier campo que no conozcamos.
///
/// Best-effort en toda la cadena: si el archivo no existe, no es JSON, o no es
/// un objeto, no se hace nada. El audio ya se liberó y eso no se revierte.
fn patch_metadata_audio_deleted(folder: &Path) {
    let path = folder.join("metadata.json");

    let Ok(raw) = std::fs::read_to_string(&path) else {
        return;
    };
    let Ok(mut value) = serde_json::from_str::<serde_json::Value>(&raw) else {
        log::warn!("[audio-retention] metadata.json ilegible en {:?}; se deja intacto", path);
        return;
    };
    let Some(obj) = value.as_object_mut() else {
        return;
    };

    obj.insert("audio_file".into(), serde_json::Value::String(String::new()));
    obj.insert(
        "audio_deleted_at".into(),
        serde_json::Value::String(chrono::Utc::now().to_rfc3339()),
    );

    let Ok(serialized) = serde_json::to_string_pretty(&value) else {
        return;
    };
    if let Err(e) = std::fs::write(&path, serialized) {
        log::warn!("[audio-retention] no se pudo reescribir {:?}: {}", path, e);
    }
}

/// Telemetría de la pasada. SÓLO se emite si hubo trabajo: un evento por cada
/// 6 h de "no había nada" sería la misma tormenta de filas que costó 965 eventos
/// en 8 h en el piloto Dingler.
async fn emit_retention_swept<R: Runtime>(
    app: &AppHandle<R>,
    meetings_swept: u64,
    bytes_freed: u64,
    retention_days: u32,
    failed: u64,
) {
    if meetings_swept == 0 && failed == 0 {
        return;
    }

    crate::logging::telemetry::emit::emit_event(
        app,
        // No hay `session-…` de grabación: el barrido es de proceso, como los
        // eventos de app (mismo criterio que `emit_segment_discarded`).
        crate::logging::telemetry::context::process_session_id(),
        crate::logging::telemetry::catalog::AUDIO_RETENTION_SWEPT,
        serde_json::json!({
            "meetings_swept": meetings_swept,
            "bytes_freed": bytes_freed,
            "retention_days": retention_days,
            "failed": failed,
        }),
        Some(if failed > 0 { "partial" } else { "ok" }),
        None,
        None,
    )
    .await;
}

#[cfg(test)]
mod tests {
    //! Los archivos de prueba se crean con `std::fs::write`, JAMÁS encodeando:
    //! un test que llame a `encode_single_audio` dispara `find_ffmpeg_path()`,
    //! que en una máquina sin ffmpeg intentaría DESCARGAR 287 MB y colgaría el
    //! runtime en el Drop (es el motivo del `#[ignore]` de
    //! `incremental_saver::tests::test_checkpoint_creation`).

    use super::{effective_retention_days, remove_audio_artifacts};
    use std::path::Path;

    fn carpeta_de_reunion(dir: &Path) {
        std::fs::write(dir.join("audio.mp4"), vec![0u8; 1024]).unwrap();
        std::fs::write(dir.join("transcripts.json"), b"[]").unwrap();
        std::fs::write(
            dir.join("metadata.json"),
            br#"{"audio_file":"audio.mp4","transcript_file":"transcripts.json","status":"completed"}"#,
        )
        .unwrap();
        let checkpoints = dir.join(".checkpoints");
        std::fs::create_dir_all(&checkpoints).unwrap();
        std::fs::write(checkpoints.join("audio_chunk_000.mp4"), vec![0u8; 512]).unwrap();
        std::fs::write(checkpoints.join("audio_chunk_001.mp4"), vec![0u8; 512]).unwrap();
    }

    #[test]
    fn effective_retention_days_cero_deshabilita_el_barrido() {
        assert_eq!(effective_retention_days(0), None);
    }

    /// El mínimo efectivo de 1 día no es un clamp, es el tipo: `u32` sin el 0,
    /// que la rama anterior ya descartó. El test afirma identidad justamente
    /// porque no hay nada más que afirmar.
    #[test]
    fn effective_retention_days_pasa_los_dias_positivos_tal_cual() {
        assert_eq!(effective_retention_days(1), Some(1));
        assert_eq!(effective_retention_days(7), Some(7));
        assert_eq!(effective_retention_days(30), Some(30));
        assert_eq!(effective_retention_days(90), Some(90));
    }

    #[test]
    fn remove_audio_artifacts_borra_audio_y_checkpoints_conservando_los_json() {
        let tmp = tempfile::tempdir().unwrap();
        carpeta_de_reunion(tmp.path());

        let freed = remove_audio_artifacts(tmp.path()).expect("borrado");

        assert_eq!(freed, 1024 + 512 + 512, "debe contar el mp4 y los checkpoints");
        assert!(!tmp.path().join("audio.mp4").exists());
        assert!(!tmp.path().join(".checkpoints").exists());
        assert!(
            tmp.path().join("transcripts.json").exists(),
            "transcripts.json NUNCA se toca"
        );
        assert!(tmp.path().join("metadata.json").exists());
    }

    #[test]
    fn remove_audio_artifacts_parchea_metadata_json() {
        let tmp = tempfile::tempdir().unwrap();
        carpeta_de_reunion(tmp.path());

        remove_audio_artifacts(tmp.path()).unwrap();

        let raw = std::fs::read_to_string(tmp.path().join("metadata.json")).unwrap();
        let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(v["audio_file"], "", "el manifiesto no debe seguir apuntando al mp4");
        assert!(v["audio_deleted_at"].is_string());
        assert_eq!(
            v["transcript_file"], "transcripts.json",
            "los campos que no conocemos se conservan"
        );
        assert_eq!(v["status"], "completed");
    }

    #[test]
    fn remove_audio_artifacts_es_idempotente_sin_archivos() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("transcripts.json"), b"[]").unwrap();

        let freed = remove_audio_artifacts(tmp.path()).expect("no debe fallar sin audio.mp4");

        assert_eq!(freed, 0);
        assert!(tmp.path().join("transcripts.json").exists());
    }

    #[test]
    fn remove_audio_artifacts_sin_metadata_no_falla() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("audio.mp4"), vec![0u8; 64]).unwrap();

        let freed = remove_audio_artifacts(tmp.path()).expect("borrado");

        assert_eq!(freed, 64);
        assert!(!tmp.path().join("metadata.json").exists());
    }
}
