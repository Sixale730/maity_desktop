//! Guardia de perfil Bluetooth: evita que Maity tire la calidad de reproducción
//! del usuario conmutando sus audífonos de A2DP a HFP.
//!
//! ## El problema
//!
//! Bluetooth clásico expone dos perfiles MUTUAMENTE EXCLUYENTES:
//!
//! - **A2DP**: estéreo, alta fidelidad, SOLO reproducción (sin micrófono).
//! - **HFP/HSP** ("manos libres"): bidireccional, pero mono y 8/16 kHz.
//!
//! En cuanto CUALQUIER proceso abre el endpoint de **captura** del headset,
//! Windows conmuta todo el dispositivo a HFP y la música del usuario pasa a
//! sonar mono y apagada. Reporte real (ago-2026): un podcast se degradaba al
//! abrir Maity y se recuperaba al cerrarla, porque (a) la grabación de jornada
//! grababa del mic del headset durante horas y (b) el preview de niveles abría
//! ese mismo mic sólo para animar las barritas de la home. El marcador en los
//! logs es `[Microphone] ... 16000Hz → 48000Hz` (16 kHz = HFP wideband).
//!
//! ## Por qué la detección es nativa y no por nombre
//!
//! Las dos heurísticas de nombre que ya existían en el repo son inservibles
//! para esta decisión, cada una por la razón opuesta:
//!
//! - [`crate::audio::device_detection`] busca "bluetooth"/"airpods"/"quietcomfort"…
//!   → **falso negativo** con cualquier dispositivo renombrado por el usuario
//!   (el caso reportado eran unos Bose renombrados "Blueberry").
//! - [`crate::audio::device_monitor`] matchea "auriculares", que en Windows en
//!   español es el nombre genérico de CUALQUIER audífono → **falso positivo**
//!   con audífonos de cable.
//!
//! Aquí se consulta el transporte real del endpoint (`PKEY_Device_EnumeratorName`:
//! `BTHENUM`/`BTHHFENUM`/`BTHLEENUM`), que es autoritativo e inmune a renombres.
//!
//! ## Invariante crítico
//!
//! Leer el property store **NO** activa el `IAudioClient` del endpoint, así que
//! preguntar "¿este micrófono es Bluetooth?" no dispara el cambio de perfil que
//! estamos tratando de evitar. Nunca sustituir estas lecturas por `Activate()`
//! ni por `default_input_config()` sobre el endpoint de captura del headset.

use log::{debug, info, warn};

/// Transporte físico de un endpoint de audio.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BtTransport {
    /// Bluetooth clásico (A2DP/HFP): los perfiles son excluyentes → hay conflicto.
    Classic,
    /// Bluetooth LE Audio: bidireccional en alta calidad → NO hay conflicto.
    LeAudio,
    /// Cableado, USB, integrado…
    NotBluetooth,
    /// No se pudo determinar (COM falló, timeout, plataforma sin soporte).
    Unknown,
}

impl BtTransport {
    /// Sólo el Bluetooth clásico obliga a elegir entre música y micrófono.
    pub fn conflicts(self) -> bool {
        matches!(self, BtTransport::Classic)
    }
}

/// Resultado de la política. `Skip` lleva la razón para que quede en los logs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    /// Sustituir el micrófono por uno no-Bluetooth.
    Override,
    Skip(SkipReason),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SkipReason {
    /// La salida activa no es Bluetooth clásico → no hay nada que proteger.
    OutputNotBluetooth,
    /// LE Audio: captura y reproducción en alta calidad conviven.
    LeAudio,
    /// La salida ya está en HFP (otra app abrió el mic): el daño ya está hecho
    /// y el mic de diadema captura mejor que uno lejano.
    AlreadyHfp,
    /// El micrófono pedido no es el del headset → nada que sustituir.
    MicNotBluetooth,
}

/// Por debajo de este sample rate el endpoint de render ya está en HFP.
/// A2DP entrega 44.1/48 kHz; HFP entrega 8 kHz (narrowband) o 16 kHz (wideband).
const A2DP_MIN_RATE_HZ: u32 = 32_000;

/// Política pura: decide si conviene sustituir el micrófono.
///
/// Separada del I/O para poder testearla sin hardware ni COM. Es deliberadamente
/// conservadora: ante cualquier duda (`Unknown`, sample rate desconocido) NO se
/// hace nada, que es el comportamiento histórico.
pub fn decide(output: BtTransport, output_rate: Option<u32>, mic_is_bluetooth: bool) -> Decision {
    match output {
        BtTransport::LeAudio => return Decision::Skip(SkipReason::LeAudio),
        BtTransport::NotBluetooth | BtTransport::Unknown => {
            return Decision::Skip(SkipReason::OutputNotBluetooth)
        }
        BtTransport::Classic => {}
    }

    // Sin sample rate no podemos saber si hay A2DP que proteger → fail-open.
    match output_rate {
        Some(rate) if rate >= A2DP_MIN_RATE_HZ => {}
        _ => return Decision::Skip(SkipReason::AlreadyHfp),
    }

    if !mic_is_bluetooth {
        return Decision::Skip(SkipReason::MicNotBluetooth);
    }

    Decision::Override
}

/// Clasifica el valor de `PKEY_Device_EnumeratorName` de un endpoint de audio.
///
/// `BTHENUM` es el enumerador de dispositivos Bluetooth clásico y `BTHHFENUM`
/// el del servicio manos libres (el endpoint de captura del headset suele venir
/// por ahí). `BTHLEENUM` corresponde a LE Audio.
pub fn classify_enumerator(enumerator: &str) -> BtTransport {
    match enumerator.trim().to_ascii_uppercase().as_str() {
        "" => BtTransport::Unknown,
        "BTHENUM" | "BTHHFENUM" => BtTransport::Classic,
        "BTHLEENUM" => BtTransport::LeAudio,
        _ => BtTransport::NotBluetooth,
    }
}

/// Timeout duro de las consultas nativas. La jornada arranca por un tick del
/// scheduler: un driver trabado no puede dejarla sin grabar.
const PROBE_TIMEOUT_MS: u64 = 1_500;

/// Transporte del dispositivo de SALIDA activo (el default de render).
pub async fn active_output_transport() -> BtTransport {
    probe(|| platform::default_render_transport()).await
}

/// Transporte de un dispositivo de ENTRADA, buscado por su nombre del OS.
///
/// El nombre se compara con el matcher difuso del repo, no con `==`: Windows
/// sube el índice del dispositivo (`(2- …)` → `(3- …)`) en cada re-emparejamiento.
pub async fn input_transport(device_name: &str) -> BtTransport {
    let name = device_name.to_string();
    probe(move || platform::capture_transport_by_name(&name)).await
}

/// Ejecuta una consulta nativa en un hilo bloqueante con timeout, degradando a
/// `Unknown` ante cualquier fallo (fail-open: `Unknown` nunca dispara override).
async fn probe<F>(f: F) -> BtTransport
where
    F: FnOnce() -> BtTransport + Send + 'static,
{
    let task = tokio::task::spawn_blocking(f);
    match tokio::time::timeout(std::time::Duration::from_millis(PROBE_TIMEOUT_MS), task).await {
        Ok(Ok(transport)) => transport,
        Ok(Err(e)) => {
            warn!("bluetooth_guard: la consulta de transporte panickeó: {e}");
            BtTransport::Unknown
        }
        Err(_) => {
            warn!("bluetooth_guard: timeout consultando el transporte del endpoint");
            BtTransport::Unknown
        }
    }
}

// ============================================================================
// Windows: property store de WASAPI
// ============================================================================

#[cfg(target_os = "windows")]
mod platform {
    use super::{classify_enumerator, BtTransport};
    use crate::audio::devices::device_name_matcher;
    use log::{debug, warn};
    use windows::core::PCWSTR;
    use windows::Win32::Devices::FunctionDiscovery::{
        PKEY_Device_EnumeratorName, PKEY_Device_FriendlyName,
    };
    use windows::Win32::Media::Audio::{
        eCapture, eConsole, eRender, IMMDevice, IMMDeviceEnumerator, MMDeviceEnumerator,
        DEVICE_STATE_ACTIVE,
    };
    use windows::Win32::System::Com::StructuredStorage::PropVariantToStringAlloc;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL,
        COINIT_MULTITHREADED, STGM_READ,
    };
    use windows::Win32::UI::Shell::PropertiesSystem::PROPERTYKEY;

    /// COM scope tolerante: si el hilo ya tiene COM inicializado en otro modelo
    /// (`RPC_E_CHANGED_MODE`), seguimos adelante SIN ser dueños de la init y sin
    /// llamar `CoUninitialize` al salir. El `ComRuntime` de `wasapi_loopback.rs`
    /// trata ese caso como error fatal; aquí no puede serlo, porque corremos en
    /// hilos del pool de tokio que no controlamos.
    struct ComScope {
        owns: bool,
    }

    impl ComScope {
        fn enter() -> Self {
            let hr = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
            // S_OK / S_FALSE = inicializado por nosotros; RPC_E_CHANGED_MODE = ya
            // había COM en STA, usable igual para lecturas del property store.
            Self { owns: hr.is_ok() }
        }
    }

    impl Drop for ComScope {
        fn drop(&mut self) {
            if self.owns {
                unsafe { CoUninitialize() };
            }
        }
    }

    /// Lee una propiedad string del property store de un endpoint.
    ///
    /// SOLO abre el property store: no activa el `IAudioClient`, así que es
    /// seguro llamarlo sobre el endpoint de captura de un headset Bluetooth sin
    /// provocar la conmutación de perfil.
    unsafe fn read_string_property(device: &IMMDevice, key: &PROPERTYKEY) -> Option<String> {
        let store = device.OpenPropertyStore(STGM_READ).ok()?;
        let value = store.GetValue(key).ok()?;
        if value.is_empty() {
            return None;
        }
        let pwstr = PropVariantToStringAlloc(&value).ok()?;
        let text = pwstr.to_string().ok();
        CoTaskMemFree(Some(pwstr.0 as *const _));
        text
    }

    unsafe fn transport_of(device: &IMMDevice) -> BtTransport {
        match read_string_property(device, &PKEY_Device_EnumeratorName) {
            Some(enumerator) => {
                let transport = classify_enumerator(&enumerator);
                debug!("bluetooth_guard: enumerator='{enumerator}' → {transport:?}");
                transport
            }
            None => BtTransport::Unknown,
        }
    }

    pub(super) fn default_render_transport() -> BtTransport {
        let _com = ComScope::enter();
        unsafe {
            let enumerator: IMMDeviceEnumerator =
                match CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) {
                    Ok(e) => e,
                    Err(e) => {
                        warn!("bluetooth_guard: no se pudo crear el enumerador COM: {e:?}");
                        return BtTransport::Unknown;
                    }
                };
            match enumerator.GetDefaultAudioEndpoint(eRender, eConsole) {
                Ok(device) => transport_of(&device),
                Err(e) => {
                    debug!("bluetooth_guard: sin dispositivo de salida por defecto: {e:?}");
                    BtTransport::Unknown
                }
            }
        }
    }

    pub(super) fn capture_transport_by_name(target: &str) -> BtTransport {
        let _com = ComScope::enter();
        unsafe {
            let enumerator: IMMDeviceEnumerator =
                match CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) {
                    Ok(e) => e,
                    Err(e) => {
                        warn!("bluetooth_guard: no se pudo crear el enumerador COM: {e:?}");
                        return BtTransport::Unknown;
                    }
                };
            let collection = match enumerator.EnumAudioEndpoints(eCapture, DEVICE_STATE_ACTIVE) {
                Ok(c) => c,
                Err(e) => {
                    warn!("bluetooth_guard: no se pudieron enumerar los endpoints de captura: {e:?}");
                    return BtTransport::Unknown;
                }
            };
            let count = collection.GetCount().unwrap_or(0);
            for i in 0..count {
                let Ok(device) = collection.Item(i) else {
                    continue;
                };
                let Some(name) = read_string_property(&device, &PKEY_Device_FriendlyName) else {
                    continue;
                };
                if device_name_matcher::is_same_device(&name, target) {
                    return transport_of(&device);
                }
            }
            debug!("bluetooth_guard: '{target}' no está entre los endpoints de captura activos");
            BtTransport::Unknown
        }
    }

    // Silencia el warning de import no usado cuando el linter analiza sin COM.
    #[allow(dead_code)]
    fn _unused(_: PCWSTR) {}
}

// ============================================================================
// macOS: CoreAudio ya expone el transporte de forma autoritativa
// ============================================================================

#[cfg(target_os = "macos")]
mod platform {
    use super::BtTransport;
    use crate::audio::device_detection::InputDeviceKind;
    use crate::audio::devices::default_output_device;

    fn classify(name: &str) -> BtTransport {
        // En macOS la capa nativa de `InputDeviceKind` consulta
        // `DeviceTransportType::BLUETOOTH` de CoreAudio: es autoritativa, no
        // heurística. CoreAudio no distingue LE Audio, así que todo Bluetooth
        // se trata como clásico (conservador: sólo implica que podríamos
        // sustituir el mic de unos audífonos LE, no que rompamos nada).
        match InputDeviceKind::detect(name, 0, 0) {
            InputDeviceKind::Bluetooth => BtTransport::Classic,
            InputDeviceKind::Wired => BtTransport::NotBluetooth,
            InputDeviceKind::Unknown => BtTransport::Unknown,
        }
    }

    pub(super) fn default_render_transport() -> BtTransport {
        match default_output_device() {
            Ok(device) => classify(&device.name),
            Err(_) => BtTransport::Unknown,
        }
    }

    pub(super) fn capture_transport_by_name(target: &str) -> BtTransport {
        classify(target)
    }
}

// ============================================================================
// Linux: heurística existente (bluez / .a2dp / .hfp)
// ============================================================================

#[cfg(target_os = "linux")]
mod platform {
    use super::BtTransport;
    use crate::audio::device_detection::InputDeviceKind;
    use crate::audio::devices::default_output_device;

    fn classify(name: &str) -> BtTransport {
        match InputDeviceKind::detect(name, 0, 0) {
            InputDeviceKind::Bluetooth => BtTransport::Classic,
            InputDeviceKind::Wired => BtTransport::NotBluetooth,
            InputDeviceKind::Unknown => BtTransport::Unknown,
        }
    }

    pub(super) fn default_render_transport() -> BtTransport {
        match default_output_device() {
            Ok(device) => classify(&device.name),
            Err(_) => BtTransport::Unknown,
        }
    }

    pub(super) fn capture_transport_by_name(target: &str) -> BtTransport {
        classify(target)
    }
}

/// Log unificado de la decisión, para que el motivo quede siempre en el archivo
/// de logs (es lo primero que se revisa cuando un usuario reporta "me cambió el
/// micrófono solo" o "sigue sonando mono").
fn log_decision(decision: Decision, output: BtTransport, rate: Option<u32>, mic: &str) {
    match decision {
        Decision::Override => info!(
            "🎧 bluetooth_guard: salida {output:?} a {rate:?} Hz con mic Bluetooth '{mic}' → se buscará un micrófono alterno"
        ),
        Decision::Skip(reason) => debug!(
            "bluetooth_guard: sin cambios ({reason:?}) — salida {output:?}, {rate:?} Hz, mic '{mic}'"
        ),
    }
}

/// ¿Hay que evitar abrir este micrófono ahora mismo?
///
/// Es la consulta que usa el preview de niveles: sin sustituir nada, sólo dice
/// si abrir ese endpoint degradaría la reproducción del usuario. Al no estar
/// grabando no hay nada que compense el cambio de perfil, así que basta con que
/// el micrófono sea Bluetooth clásico y haya A2DP vivo.
pub async fn should_avoid_opening_mic(mic_name: &str) -> bool {
    let output = active_output_transport().await;
    if !output.conflicts() {
        return false;
    }
    let rate = output_sample_rate().await;
    let mic_is_bt = input_transport(mic_name).await.conflicts();
    let decision = decide(output, rate, mic_is_bt);
    log_decision(decision, output, rate, mic_name);
    decision == Decision::Override
}

/// Sample rate actual del endpoint de salida. Reusa `playback_monitor`, que ya
/// lo obtiene con cpal (`default_output_config`) — es el formato de modo
/// compartido vigente, así que baja a 16/8 kHz cuando el headset ya está en HFP.
async fn output_sample_rate() -> Option<u32> {
    match super::playback_monitor::get_active_audio_output().await {
        Ok(info) => info.sample_rate,
        Err(e) => {
            debug!("bluetooth_guard: no se pudo leer el sample rate de la salida: {e}");
            None
        }
    }
}

/// Nombre del dispositivo de salida activo, sólo para el mensaje del toast.
async fn output_name() -> String {
    super::playback_monitor::get_active_audio_output()
        .await
        .map(|i| i.device_name)
        .unwrap_or_else(|_| "salida Bluetooth".to_string())
}

/// Punto de entrada de la política al ARRANCAR una grabación: devuelve el
/// nombre del micrófono con el que se debe grabar.
///
/// Opera sobre el NOMBRE, antes de resolver el dispositivo, y por una razón
/// concreta: `recording_helpers::resolve_actual_endpoint` abre el endpoint para
/// verificar cuál abrirá WASAPI de verdad — si dejáramos que corriera primero,
/// ya habría conmutado el headset a HFP y llegaríamos tarde.
///
/// Nunca falla ni devuelve `Err`: ante cualquier problema conserva lo que
/// recibió. Tampoco persiste nada — la preferencia del usuario en
/// `recording_preferences.json` queda intacta, esto es una decisión de ESTA
/// sesión de grabación. El escape hatch es `switch_audio_device`, que no pasa
/// por aquí: elegir el mic Bluetooth a mano durante la grabación se respeta.
pub async fn apply_bluetooth_output_mic_override<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    requested_mic: Option<String>,
) -> Option<String> {
    use tauri::Emitter;

    let output = active_output_transport().await;
    if !output.conflicts() {
        // Camino rápido: sin audífonos BT clásicos no hay nada que evaluar.
        return requested_mic;
    }

    // El mic pedido puede ser None (= default del sistema); hay que resolverlo
    // para saber si el default ES el headset.
    let mic_name = match requested_mic.clone() {
        Some(name) => name,
        None => match super::devices::default_input_device() {
            Ok(device) => device.name,
            Err(_) => return requested_mic,
        },
    };

    let rate = output_sample_rate().await;
    let mic_is_bt = input_transport(&mic_name).await.conflicts();
    let decision = decide(output, rate, mic_is_bt);
    log_decision(decision, output, rate, &mic_name);

    if decision != Decision::Override {
        return requested_mic;
    }

    let substitute = super::devices::find_non_bluetooth_input_device(&mic_name).await;
    let payload = serde_json::json!({
        "outputDevice": output_name().await,
        "bluetoothMic": mic_name,
        "substituteMic": substitute.as_ref().map(|d| d.name.clone()),
        "applied": substitute.is_some(),
    });
    if let Err(e) = app.emit(crate::events::BLUETOOTH_MIC_AVOIDED, payload) {
        warn!("failed to emit bluetooth-mic-avoided event: {e}");
    }

    match substitute {
        Some(device) => {
            info!(
                "🎧 Micrófono Bluetooth '{}' sustituido por '{}' para conservar A2DP",
                mic_name, device.name
            );
            Some(device.name)
        }
        None => {
            warn!(
                "⚠️ No hay micrófono alterno: se grabará con '{mic_name}' y los audífonos pasarán a manos libres"
            );
            requested_mic
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clasifica_enumeradores_bluetooth() {
        assert_eq!(classify_enumerator("BTHENUM"), BtTransport::Classic);
        assert_eq!(classify_enumerator("BTHHFENUM"), BtTransport::Classic);
        assert_eq!(classify_enumerator("bthenum"), BtTransport::Classic);
        assert_eq!(classify_enumerator("BTHLEENUM"), BtTransport::LeAudio);
        assert_eq!(classify_enumerator("USB"), BtTransport::NotBluetooth);
        assert_eq!(classify_enumerator("HDAUDIO"), BtTransport::NotBluetooth);
        assert_eq!(classify_enumerator("MMDEVAPI"), BtTransport::NotBluetooth);
        assert_eq!(classify_enumerator(""), BtTransport::Unknown);
        assert_eq!(classify_enumerator("  "), BtTransport::Unknown);
    }

    #[test]
    fn sustituye_solo_con_a2dp_vivo_y_mic_bluetooth() {
        assert_eq!(
            decide(BtTransport::Classic, Some(48_000), true),
            Decision::Override
        );
        assert_eq!(
            decide(BtTransport::Classic, Some(44_100), true),
            Decision::Override
        );
    }

    #[test]
    fn no_toca_nada_si_la_salida_ya_esta_en_hfp() {
        // Otra app (Zoom/Teams) ya conmutó el headset: el daño está hecho y el
        // mic de diadema capta mejor que uno lejano.
        assert_eq!(
            decide(BtTransport::Classic, Some(16_000), true),
            Decision::Skip(SkipReason::AlreadyHfp)
        );
        assert_eq!(
            decide(BtTransport::Classic, Some(8_000), true),
            Decision::Skip(SkipReason::AlreadyHfp)
        );
        assert_eq!(
            decide(BtTransport::Classic, None, true),
            Decision::Skip(SkipReason::AlreadyHfp)
        );
    }

    #[test]
    fn le_audio_no_tiene_conflicto_de_perfiles() {
        assert_eq!(
            decide(BtTransport::LeAudio, Some(48_000), true),
            Decision::Skip(SkipReason::LeAudio)
        );
    }

    #[test]
    fn salida_cableada_no_dispara_nada() {
        assert_eq!(
            decide(BtTransport::NotBluetooth, Some(48_000), true),
            Decision::Skip(SkipReason::OutputNotBluetooth)
        );
    }

    #[test]
    fn mic_no_bluetooth_no_se_sustituye() {
        // El usuario escucha por los audífonos BT pero ya graba con un USB.
        assert_eq!(
            decide(BtTransport::Classic, Some(48_000), false),
            Decision::Skip(SkipReason::MicNotBluetooth)
        );
    }

    #[test]
    fn transporte_desconocido_hace_fail_open() {
        // Si COM falla o hay timeout no se toca la selección del usuario.
        assert_eq!(
            decide(BtTransport::Unknown, Some(48_000), true),
            Decision::Skip(SkipReason::OutputNotBluetooth)
        );
        assert!(!BtTransport::Unknown.conflicts());
        assert!(!BtTransport::LeAudio.conflicts());
        assert!(BtTransport::Classic.conflicts());
    }
}
