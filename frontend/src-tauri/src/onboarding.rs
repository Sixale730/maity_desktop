use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_store::StoreExt;
use log::{info, warn, error};
use anyhow::Result;

use crate::state::AppState;
use crate::database::repositories::setting::SettingsRepository;


#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OnboardingStatus {
    pub version: String,
    pub completed: bool,
    pub current_step: u8,
    pub model_status: ModelStatus,
    pub last_updated: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ModelStatus {
    pub parakeet: String,  // "downloaded" | "not_downloaded" | "downloading"
    /// "downloaded" | "not_downloaded" | "cloud". CUALQUIER modelo del registry
    /// (`summary_engine::models`) cuenta como descargado — ver `reconcile_status`.
    pub summary: String,
}

/// Paso maximo del onboarding tecnico (4 en macOS con permisos, 3 en el resto).
const MAX_ONBOARDING_STEP: u8 = 4;

impl Default for OnboardingStatus {
    fn default() -> Self {
        Self {
            version: "1.0".to_string(),
            completed: false,
            current_step: 1,
            model_status: ModelStatus {
                parakeet: "not_downloaded".to_string(),
                summary: "not_downloaded".to_string(),  // Changed from gemma
            },
            last_updated: chrono::Utc::now().to_rfc3339(),
        }
    }
}


/// Lee el estado del onboarding tal como esta en disco. **LECTURA PURA.**
///
/// CQS (Command-Query Separation): leer no escribe. Hasta jul-2026 esta funcion
/// reconciliaba contra el disco y PERSISTIA el resultado, y tiene tres llamadores
/// independientes (el comando `get_onboarding_status`, `OnboardingContext` del
/// frontend y `tray::check_can_record`). Como `useRecordingStop` hace un hard
/// navigate al detener una grabacion, cada reunion remontaba el arbol React y
/// volvia a disparar esa escritura: bastaba una regla que bajara `completed` para
/// que el usuario terminara en la pantalla de bienvenida despues de cada reunion.
/// La reconciliacion es ahora explicita y corre UNA vez en el arranque
/// (`reconcile_onboarding_status_at_startup`).
pub async fn load_onboarding_status<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<OnboardingStatus> {
    // Try to load from Tauri store
    let store = match app.store("onboarding-status.json") {
        Ok(store) => store,
        Err(e) => {
            warn!("Failed to access onboarding store: {}, using defaults", e);
            return Ok(OnboardingStatus::default());
        }
    };

    // Try to get the status from store
    let status = if let Some(value) = store.get("status") {
        match serde_json::from_value::<OnboardingStatus>(value.clone()) {
            Ok(s) => {
                info!("Loaded onboarding status from store - Step: {}, Completed: {}",
                      s.current_step, s.completed);
                s
            }
            Err(e) => {
                warn!("Failed to deserialize onboarding status: {}, using defaults", e);
                OnboardingStatus::default()
            }
        }
    } else {
        info!("No stored onboarding status found, using defaults");
        OnboardingStatus::default()
    };

    Ok(status)
}

/// Hechos observados en disco. Struct plano a proposito: separa la E/S de la
/// decision, de modo que `reconcile_status` se testea sin `AppHandle` ni FS.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct DiskModelFacts {
    /// Hay CUALQUIER modelo de resumen del registry valido en disco.
    ///
    /// No exige `gemma3:4b`. `builtin_ai_get_recommended_model` entrega `gemma3:1b`
    /// en toda maquina que no sea macOS >16GB, asi que exigir el 4b declaraba
    /// "instalacion rota" el estado que el propio recomendador produce.
    pub summary_model_present: bool,
    pub parakeet_present: bool,
}

/// Mira el disco. Devuelve `None` si ni siquiera se pudo resolver el app data dir:
/// en ese caso no sabemos nada y no hay que tocar el estado.
fn collect_disk_model_facts<R: Runtime>(app: &AppHandle<R>) -> Option<DiskModelFacts> {
    let base = app.path().app_data_dir().ok()?;

    // Fuente de verdad: el registry de modelos, no nombres de archivo hardcodeados.
    let summary_model_present = crate::summary::summary_engine::models::any_model_on_disk(
        &base.join("models").join("summary"),
    );

    let parakeet_dir = base.join("models").join("parakeet");
    let parakeet_present = parakeet_dir.exists()
        && parakeet_dir
            .read_dir()
            .map(|mut it| it.next().is_some())
            .unwrap_or(false);

    Some(DiskModelFacts {
        summary_model_present,
        parakeet_present,
    })
}

/// Reconcilia el estado guardado con lo que hay en disco. Devuelve `true` si mutó.
///
/// **INVARIANTE: la reconciliacion es MONOTONA — solo avanza.** Nunca pone
/// `completed = false` ni baja `current_step`. Retroceder el onboarding es una
/// accion explicita del usuario (`reset_onboarding_status`), jamas un efecto
/// colateral de mirar el disco.
///
/// Historia (no reintroducir): hasta jul-2026 aqui vivia la regla §4.1 de `fb1846b`
/// — "si hay gemma 1b pero no 4b, `completed=false` y volver al paso 3". Nacio como
/// salvaguarda de migracion para que el sidecar no fallara al resolver el modelo,
/// pero quedo invalidada dos veces: el recomendador ya entregaba 1b en Windows, y
/// `95bb3f4` reinstauro el 1b como eleccion legitima en tier Low. Hoy el coach
/// resuelve su propio modelo (`resolve_effective_tips_model`) y degrada a
/// `TipsResolution::Unavailable` si falta — la salvaguarda era redundante y
/// convertia toda instalacion limpia de Windows en un bucle de onboarding.
pub(crate) fn reconcile_status(status: &mut OnboardingStatus, facts: &DiskModelFacts) -> bool {
    let mut changed = false;

    if facts.summary_model_present && status.model_status.summary != "downloaded" {
        status.model_status.summary = "downloaded".to_string();
        changed = true;
    }

    if facts.parakeet_present && status.model_status.parakeet != "downloaded" {
        status.model_status.parakeet = "downloaded".to_string();
        changed = true;
    }

    // Si todo esta en disco, dar el onboarding por completo. Esto es lo que
    // auto-repara a los usuarios que quedaron atorados en `completed=false` por la
    // regla §4.1: no hace falta migracion ni que hagan nada.
    if status.model_status.summary == "downloaded"
        && status.model_status.parakeet == "downloaded"
        && !status.completed
    {
        status.completed = true;
        status.current_step = MAX_ONBOARDING_STEP;
        changed = true;
    }

    changed
}

/// Impide que un estado entrante degrade un onboarding ya completado.
/// Devuelve `true` si tuvo que corregir el entrante (para poder loguearlo).
pub(crate) fn enforce_monotonic_completion(
    incoming: &mut OnboardingStatus,
    current: &OnboardingStatus,
) -> bool {
    if incoming.completed || !current.completed {
        return false;
    }
    incoming.completed = true;
    incoming.current_step = incoming.current_step.max(current.current_step);
    true
}

/// Reconciliacion one-shot del arranque: el UNICO punto donde mirar el disco puede
/// escribir el estado. Cura ediciones manuales, restauraciones de backup y a los
/// usuarios que la regla §4.1 dejo con `completed=false`.
///
/// Best-effort: cualquier fallo se registra y se ignora — el arranque no depende de esto.
pub async fn reconcile_onboarding_status_at_startup<R: Runtime>(app: &AppHandle<R>) {
    let Some(facts) = collect_disk_model_facts(app) else {
        warn!("Onboarding: no se pudo leer el app data dir; se omite la reconciliacion");
        return;
    };

    let mut status = match load_onboarding_status(app).await {
        Ok(s) => s,
        Err(e) => {
            warn!("Onboarding: no se pudo cargar el estado para reconciliar: {}", e);
            return;
        }
    };

    if !reconcile_status(&mut status, &facts) {
        return;
    }

    info!(
        "✅ Onboarding reconciliado con disco: parakeet={}, summary={}, completed={}",
        status.model_status.parakeet, status.model_status.summary, status.completed
    );
    if let Err(e) = save_onboarding_status(app, &status).await {
        warn!("No se pudo persistir el estado reconciliado: {}", e);
    }
}

/// Save onboarding status to store
pub async fn save_onboarding_status<R: Runtime>(
    app: &AppHandle<R>,
    status: &OnboardingStatus,
) -> Result<()> {
    info!("Saving onboarding status: step={}, completed={}",
          status.current_step, status.completed);

    // Get or create store
    let store = app.store("onboarding-status.json")
        .map_err(|e| anyhow::anyhow!("Failed to access onboarding store: {}", e))?;

    // Update last_updated timestamp
    let mut status = status.clone();
    status.last_updated = chrono::Utc::now().to_rfc3339();

    // Serialize status to JSON value
    let status_value = serde_json::to_value(&status)
        .map_err(|e| anyhow::anyhow!("Failed to serialize onboarding status: {}", e))?;

    // Save to store
    store.set("status", status_value);

    // Persist to disk
    store.save()
        .map_err(|e| anyhow::anyhow!("Failed to save onboarding store to disk: {}", e))?;

    info!("Successfully persisted onboarding status to disk");
    Ok(())
}

/// Reset onboarding status (delete from store)
pub async fn reset_onboarding_status<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<()> {
    info!("Resetting onboarding status");

    let store = app.store("onboarding-status.json")
        .map_err(|e| anyhow::anyhow!("Failed to access onboarding store: {}", e))?;

    // Clear the status key
    store.delete("status");

    // Persist deletion to disk
    store.save()
        .map_err(|e| anyhow::anyhow!("Failed to save onboarding store after reset: {}", e))?;

    info!("Successfully reset onboarding status");
    Ok(())
}

/// Tauri commands for onboarding status
#[tauri::command]
pub async fn get_onboarding_status<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Option<OnboardingStatus>, String> {
    let status = load_onboarding_status(&app)
        .await
        .map_err(|e| format!("Failed to load onboarding status: {}", e))?;

    // Return None if it's the default (never saved before)
    // Check if we have any saved data by seeing if the store has the key
    let store = app.store("onboarding-status.json")
        .map_err(|e| format!("Failed to access store: {}", e))?;

    if store.get("status").is_none() {
        Ok(None)
    } else {
        Ok(Some(status))
    }
}

#[tauri::command]
pub async fn save_onboarding_status_cmd<R: Runtime>(
    app: AppHandle<R>,
    mut status: OnboardingStatus,
) -> Result<(), String> {
    // El invariante monotono se hace cumplir AQUI, en el borde de persistencia, no
    // en cada cliente. El autosave de `OnboardingContext` arma este objeto con
    // estado de React que se carga una sola vez al montar, asi que puede ir
    // atrasado respecto al disco: un autosave rezagado podria revertir un
    // `completed=true` que la reconciliacion del arranque acaba de escribir.
    // Limpiar `completed` es una accion explicita: `reset_onboarding_status`.
    if !status.completed {
        if let Ok(current) = load_onboarding_status(&app).await {
            if enforce_monotonic_completion(&mut status, &current) {
                warn!("save_onboarding_status_cmd intento bajar `completed`; se conserva completado");
            }
        }
    }

    save_onboarding_status(&app, &status)
        .await
        .map_err(|e| format!("Failed to save onboarding status: {}", e))
}

#[tauri::command]
pub async fn reset_onboarding_status_cmd<R: Runtime>(
    app: AppHandle<R>,
) -> Result<(), String> {
    reset_onboarding_status(&app)
        .await
        .map_err(|e| format!("Failed to reset onboarding status: {}", e))
}

#[tauri::command]
pub async fn complete_onboarding<R: Runtime>(
    app: AppHandle<R>,
    _model: String,
) -> Result<(), String> {
    // OJO: el nombre de los campos es legacy. La transcripcion queda en Parakeet
    // LOCAL (ver save_transcript_config abajo); "deepgram" solo ocupa el campo
    // whisper_model, que no se usa con este proveedor. Deepgram esta deprecado.
    info!("Completing onboarding: resumen via OpenAI, transcripcion local Parakeet");

    let app_state = app.try_state::<AppState>()
        .ok_or_else(|| "La base de datos no está lista. Espera un momento y vuelve a intentarlo.".to_string())?;
    let pool = app_state.db_manager.pool();

    // Use OpenAI for summaries (cloud API)
    if let Err(e) = SettingsRepository::save_model_config(
        pool,
        "openai",
        "gpt-4o-2024-11-20",
        "deepgram",  // Whisper model field repurposed - not used with cloud
        None,
    ).await {
        error!("Failed to save OpenAI model config: {}", e);
        return Err(format!("Failed to save OpenAI model config: {}", e));
    }
    info!("Saved summary model config: provider=openai, model=gpt-4o-2024-11-20");

    // Save transcription config - use Parakeet (local) with int8 model and Spanish
    if let Err(e) = SettingsRepository::save_transcript_config(
        pool,
        "parakeet",
        "parakeet-tdt-0.6b-v3-int8",
        Some("es-419"),
    ).await {
        error!("Failed to save transcription model config: {}", e);
        return Err(format!("Failed to save transcription model config: {}", e));
    }
    info!("Saved transcription model config: provider=parakeet, model=parakeet-tdt-0.6b-v3-int8, language=es-419");

    // Step 2: Only NOW mark onboarding as complete (after DB operations succeed)
    let mut status = load_onboarding_status(&app)
        .await
        .map_err(|e| format!("Failed to load onboarding status: {}", e))?;

    status.completed = true;
    status.current_step = MAX_ONBOARDING_STEP;
    // `model_status` NO se toca: es un reflejo del disco, no de esta transicion.
    // Escribia "pending_download"/"cloud", valores que ningun lector entiende y que
    // ademas rearmaban la regla §4.1 al borrar el estado ya reconciliado. Quien
    // mantiene esos campos es `reconcile_onboarding_status_at_startup`.

    save_onboarding_status(&app, &status)
        .await
        .map_err(|e| format!("Failed to save completed onboarding status: {}", e))?;

    info!("Onboarding completed successfully with local Parakeet provider");
    Ok(())
}

#[cfg(test)]
mod reconcile_tests {
    use super::*;

    /// Ambos modelos en disco. En Windows "modelo de resumen presente" significa
    /// gemma3:1b — es lo que recomienda `builtin_ai_get_recommended_model` ahi.
    const TODO_PRESENTE: DiskModelFacts = DiskModelFacts {
        summary_model_present: true,
        parakeet_present: true,
    };
    const NADA_PRESENTE: DiskModelFacts = DiskModelFacts {
        summary_model_present: false,
        parakeet_present: false,
    };

    fn status(completed: bool, step: u8, parakeet: &str, summary: &str) -> OnboardingStatus {
        OnboardingStatus {
            version: "1.0".to_string(),
            completed,
            current_step: step,
            model_status: ModelStatus {
                parakeet: parakeet.to_string(),
                summary: summary.to_string(),
            },
            last_updated: "2026-07-27T00:00:00Z".to_string(),
        }
    }

    /// REGRESION del bucle de onboarding (jul-2026): con solo el 1b en disco, la
    /// regla §4.1 ponia `completed=false` en cada lectura del estado. Como
    /// `useRecordingStop` hace hard navigate, el usuario volvia a la pantalla de
    /// bienvenida despues de CADA reunion.
    #[test]
    fn completado_no_retrocede_con_solo_el_1b() {
        // Estado tipico tras `complete_onboarding` en la version vieja.
        let mut s = status(true, 4, "pending_download", "cloud");
        reconcile_status(&mut s, &TODO_PRESENTE);

        assert!(s.completed, "la reconciliacion NUNCA debe bajar `completed`");
        assert_eq!(s.current_step, 4);
        assert_eq!(s.model_status.summary, "downloaded");
        assert_eq!(s.model_status.parakeet, "downloaded");
    }

    /// Usuarios que ya quedaron atorados en disco con `completed:false` se curan
    /// solos al arrancar: no hace falta migracion ni accion del usuario.
    #[test]
    fn autorepara_usuario_atorado_por_la_regla_4_1() {
        let mut s = status(false, 3, "downloaded", "needs_4b_upgrade");
        let changed = reconcile_status(&mut s, &TODO_PRESENTE);

        assert!(changed);
        assert!(s.completed);
        assert_eq!(s.current_step, MAX_ONBOARDING_STEP);
    }

    #[test]
    fn sin_modelos_en_disco_no_degrada_nada() {
        let mut s = status(true, 4, "downloaded", "downloaded");
        let changed = reconcile_status(&mut s, &NADA_PRESENTE);

        assert!(!changed, "sin modelos en disco no hay nada que reconciliar");
        assert!(s.completed);
        assert_eq!(s.current_step, 4);
    }

    /// Un onboarding a medias no se auto-completa: hacen falta AMBOS modelos.
    #[test]
    fn solo_parakeet_no_completa_el_onboarding() {
        let mut s = status(false, 1, "not_downloaded", "not_downloaded");
        let changed = reconcile_status(
            &mut s,
            &DiskModelFacts {
                summary_model_present: false,
                parakeet_present: true,
            },
        );

        assert!(changed);
        assert_eq!(s.model_status.parakeet, "downloaded");
        assert!(!s.completed);
        assert_eq!(s.current_step, 1, "tampoco debe adelantar el paso");
    }

    /// Convergente: la segunda pasada no escribe. Es lo que evita que el arranque
    /// persista el estado una y otra vez.
    #[test]
    fn es_idempotente() {
        let mut s = status(false, 1, "not_downloaded", "not_downloaded");

        assert!(reconcile_status(&mut s, &TODO_PRESENTE));
        assert!(!reconcile_status(&mut s, &TODO_PRESENTE));
    }

    /// El autosave del frontend arma su payload con estado de React que se carga
    /// una sola vez al montar: si llega tarde, traeria `completed:false` sobre un
    /// `true` recien reconciliado. El borde de persistencia lo bloquea.
    #[test]
    fn un_autosave_rezagado_no_baja_completed() {
        let current = status(true, 4, "downloaded", "downloaded");
        let mut incoming = status(false, 1, "not_downloaded", "not_downloaded");

        assert!(enforce_monotonic_completion(&mut incoming, &current));
        assert!(incoming.completed);
        assert_eq!(incoming.current_step, 4, "conserva el paso mas avanzado");
    }

    /// Durante el onboarding real (nada completado aun) el guard no estorba.
    #[test]
    fn no_estorba_a_un_onboarding_en_curso() {
        let current = status(false, 1, "not_downloaded", "not_downloaded");
        let mut incoming = status(false, 2, "downloaded", "not_downloaded");

        assert!(!enforce_monotonic_completion(&mut incoming, &current));
        assert!(!incoming.completed);
        assert_eq!(incoming.current_step, 2);
    }
}
