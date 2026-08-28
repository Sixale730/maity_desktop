//! Clasificación de errores de dispositivo de audio.
//!
//! # Por qué existe este módulo
//!
//! Los errores de apertura de stream llegan desde cpal como texto libre, y en
//! Windows ese texto lo **localiza el sistema operativo**: la misma falla se lee
//! `"Access is denied. (0x80070005)"` en una máquina en inglés y
//! `"Acceso denegado. (0x80070005)"` en una en español. Cualquier capa que
//! decida por substring (`errorMsg.includes('microphone')`) funciona en la
//! máquina del desarrollador y falla en la del usuario.
//!
//! Lo único estable entre locales es el **HRESULT**. Por eso la clasificación
//! matchea el código hexadecimal y nunca la prosa.
//!
//! Esto convierte errores en datos: con un código estable, la UI puede ofrecer
//! una remediación concreta ("abre la privacidad del micrófono") en vez de
//! volcarle al usuario un mensaje del sistema que no le dice qué hacer. En el
//! piloto de Dingler (ago-2026) dos usuarias quedaron con cero grabaciones por
//! `0x80070005` sin que la app les explicara nunca el porqué.

use serde::Serialize;

/// HRESULTs relevantes para la captura de audio en Windows.
///
/// Los `AUDCLNT_*` vienen de la API WASAPI; los `ERROR_*` del kernel de Windows
/// envueltos en HRESULT.
mod hresult {
    /// `E_ACCESSDENIED` — privacidad de micrófono denegada en Configuración.
    pub const E_ACCESSDENIED: u32 = 0x8007_0005;
    /// `AUDCLNT_E_DEVICE_IN_USE` — otro proceso tomó el endpoint en exclusivo.
    pub const AUDCLNT_E_DEVICE_IN_USE: u32 = 0x8889_000A;
    /// `AUDCLNT_E_DEVICE_INVALIDATED` — el dispositivo se desconectó o cambió.
    pub const AUDCLNT_E_DEVICE_INVALIDATED: u32 = 0x8889_0004;
    /// `AUDCLNT_E_UNSUPPORTED_FORMAT` — el endpoint no acepta el formato pedido.
    pub const AUDCLNT_E_UNSUPPORTED_FORMAT: u32 = 0x8889_0008;
    /// `ERROR_NOT_FOUND` envuelto en HRESULT.
    pub const ERROR_NOT_FOUND: u32 = 0x8007_0490;
}

/// Falla clasificada al abrir un dispositivo de captura.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AudioStartError {
    /// Windows denegó el acceso al micrófono (privacidad del SO).
    MicPermissionDenied,
    /// No hay micrófono disponible o el elegido desapareció.
    MicNotFound,
    /// Otro programa tiene el micrófono tomado en modo exclusivo.
    MicInUse,
    /// El endpoint no soporta el formato de captura solicitado.
    MicFormatUnsupported,
    /// No se pudo clasificar: se conserva el texto crudo para diagnóstico.
    Unknown(String),
}

/// Identificador de la acción de remediación que el frontend puede ofrecer.
///
/// Es un identificador estable, no un texto: la UI decide cómo presentarlo y
/// qué comando invocar.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Remediation {
    /// Abrir Configuración → Privacidad → Micrófono.
    OpenMicrophonePrivacySettings,
    /// Abrir el selector de dispositivos de la app.
    OpenDevicePicker,
}

/// Payload que viaja al frontend en el evento `audio-device-error`.
///
/// camelCase para casar con `AudioDeviceErrorPayload` en `lib/tauri-events.ts`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioDeviceErrorPayload {
    /// Código estable, apto para lógica y para agrupar en telemetría.
    pub code: &'static str,
    /// Mensaje listo para mostrar al usuario, en español.
    pub user_message: &'static str,
    /// Si el usuario puede hacer algo concreto al respecto.
    pub actionable: bool,
    /// Acción sugerida, si la hay.
    pub remediation: Option<Remediation>,
    /// Texto original del sistema. Sólo para logs y reportes — nunca para
    /// decidir nada: viene localizado.
    pub raw: String,
}

impl AudioStartError {
    /// Código estable e independiente del locale.
    pub fn code(&self) -> &'static str {
        match self {
            Self::MicPermissionDenied => "mic_permission_denied",
            Self::MicNotFound => "mic_not_found",
            Self::MicInUse => "mic_in_use",
            Self::MicFormatUnsupported => "mic_format_unsupported",
            Self::Unknown(_) => "audio_unknown",
        }
    }

    /// Mensaje para el usuario. Dice qué pasó, no cómo se llama el error.
    pub fn user_message(&self) -> &'static str {
        match self {
            Self::MicPermissionDenied => {
                "Windows está bloqueando el acceso al micrófono de Maity."
            }
            Self::MicNotFound => "No se detectó ningún micrófono disponible.",
            Self::MicInUse => "Otro programa está usando el micrófono en exclusiva.",
            Self::MicFormatUnsupported => {
                "El micrófono seleccionado no admite el formato de grabación."
            }
            Self::Unknown(_) => "No se pudo iniciar la captura de audio.",
        }
    }

    /// Acción concreta que el usuario puede tomar.
    ///
    /// Un error accionable sin remediación es una queja; con ella es una
    /// instrucción. `MicInUse` no la tiene porque la acción está fuera de la
    /// app (cerrar el otro programa) y no hay nada que podamos abrir por él.
    pub fn remediation(&self) -> Option<Remediation> {
        match self {
            Self::MicPermissionDenied => Some(Remediation::OpenMicrophonePrivacySettings),
            Self::MicNotFound | Self::MicFormatUnsupported => {
                Some(Remediation::OpenDevicePicker)
            }
            Self::MicInUse | Self::Unknown(_) => None,
        }
    }

    /// Si el usuario puede resolverlo por su cuenta con una instrucción clara.
    pub fn is_actionable(&self) -> bool {
        !matches!(self, Self::Unknown(_))
    }

    /// Construye el payload del evento hacia el frontend.
    pub fn to_payload(&self, raw: impl Into<String>) -> AudioDeviceErrorPayload {
        AudioDeviceErrorPayload {
            code: self.code(),
            user_message: self.user_message(),
            actionable: self.is_actionable(),
            remediation: self.remediation(),
            raw: raw.into(),
        }
    }
}

/// Extrae el primer HRESULT en notación `0x########` del texto.
///
/// Windows incrusta el código junto al mensaje localizado, así que es la parte
/// del string en la que sí se puede confiar.
fn extract_hresult(raw: &str) -> Option<u32> {
    let bytes = raw.as_bytes();
    let mut i = 0;

    while i + 2 < bytes.len() {
        let is_prefix = bytes[i] == b'0' && (bytes[i + 1] == b'x' || bytes[i + 1] == b'X');
        if !is_prefix {
            i += 1;
            continue;
        }

        let start = i + 2;
        let hex: String = raw[start..]
            .chars()
            .take_while(|c| c.is_ascii_hexdigit())
            .collect();

        // Sólo códigos de 8 dígitos: descarta `0x0`, offsets y otros números
        // sueltos que aparezcan en el mensaje.
        if hex.len() == 8 {
            if let Ok(code) = u32::from_str_radix(&hex, 16) {
                return Some(code);
            }
        }

        i = start.max(i + 1);
    }

    None
}

/// Clasifica un error crudo de cpal/WASAPI.
///
/// Prioriza el HRESULT. Sólo si no hay código recurre a señales estructurales
/// nuestras (mensajes que emitimos nosotros, no el SO), nunca a texto del
/// sistema — ese viene traducido.
pub fn classify_device_error(raw: &str) -> AudioStartError {
    if let Some(code) = extract_hresult(raw) {
        return match code {
            hresult::E_ACCESSDENIED => AudioStartError::MicPermissionDenied,
            hresult::AUDCLNT_E_DEVICE_IN_USE => AudioStartError::MicInUse,
            hresult::AUDCLNT_E_DEVICE_INVALIDATED | hresult::ERROR_NOT_FOUND => {
                AudioStartError::MicNotFound
            }
            hresult::AUDCLNT_E_UNSUPPORTED_FORMAT => AudioStartError::MicFormatUnsupported,
            _ => AudioStartError::Unknown(raw.to_string()),
        };
    }

    // Marcadores propios (los escribimos nosotros en inglés y no se traducen).
    // `DevicesError`/`DeviceNameError` son variantes de cpal, también estables.
    let lowered = raw.to_ascii_lowercase();
    if lowered.contains("no microphone device available")
        || lowered.contains("no input device")
        || lowered.contains("no default microphone")
        || lowered.contains("devicesnotavailable")
    {
        return AudioStartError::MicNotFound;
    }

    AudioStartError::Unknown(raw.to_string())
}

/// Abre el panel de privacidad del micrófono del sistema operativo.
///
/// Es la remediación de `MicPermissionDenied`: la app no puede otorgarse el
/// permiso a sí misma, sólo llevar al usuario al lugar exacto donde se otorga.
/// Mismo patrón que `startup_task::open_startup_settings`, así que no necesita
/// `plugin:shell` ni permisos de ACL nuevos.
#[tauri::command]
pub fn open_microphone_privacy_settings() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        std::process::Command::new("cmd")
            .args(["/C", "start", "", "ms-settings:privacy-microphone"])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("no se pudo abrir ms-settings:privacy-microphone: {e}"))
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone")
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("no se pudo abrir el panel de privacidad: {e}"))
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    Err("unsupported".into())
}

/// Preflight de micrófono para onboarding, ajustes y diagnóstico.
///
/// `Ok(None)` = micrófono listo. `Ok(Some(payload))` = falla clasificada, con el
/// mismo shape que el evento `audio-device-error`, así que el frontend reusa
/// `AudioDeviceErrorPayload` y su remediación sin tipos nuevos.
///
/// Corre en `spawn_blocking` porque la probe abre un stream y duerme 500 ms: en
/// el hilo async bloquearía el runtime.
///
/// **No llamar desde el camino de grabación** — ver `probe_microphone_access`.
#[tauri::command]
pub async fn check_microphone_ready() -> Result<Option<AudioDeviceErrorPayload>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        crate::audio::devices::discovery::probe_microphone_access()
            .map(|err| err.to_payload(String::new()))
    })
    .await
    .map_err(|e| format!("no se pudo ejecutar la comprobación de micrófono: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// El test que justifica todo el módulo: la MISMA falla, en dos idiomas,
    /// tiene que clasificar igual. Un match por substring del mensaje pasa el
    /// caso en inglés y falla el que de verdad sufrieron las usuarias.
    #[test]
    fn clasifica_igual_sin_importar_el_idioma_de_windows() {
        let es = "A backend-specific error has occurred: Acceso denegado. (0x80070005)";
        let en = "A backend-specific error has occurred: Access is denied. (0x80070005)";

        assert_eq!(classify_device_error(es), AudioStartError::MicPermissionDenied);
        assert_eq!(classify_device_error(en), AudioStartError::MicPermissionDenied);
        assert_eq!(classify_device_error(es), classify_device_error(en));
    }

    #[test]
    fn mapea_los_hresult_conocidos() {
        let casos = [
            ("error (0x80070005)", AudioStartError::MicPermissionDenied),
            ("error (0x8889000A)", AudioStartError::MicInUse),
            ("error (0x8889000a)", AudioStartError::MicInUse),
            ("error (0x88890004)", AudioStartError::MicNotFound),
            ("error (0x80070490)", AudioStartError::MicNotFound),
            ("error (0x88890008)", AudioStartError::MicFormatUnsupported),
        ];

        for (raw, esperado) in casos {
            assert_eq!(classify_device_error(raw), esperado, "raw = {raw}");
        }
    }

    #[test]
    fn un_hresult_desconocido_no_se_inventa_una_categoria() {
        let raw = "backend error (0x8007000E)";
        assert_eq!(classify_device_error(raw), AudioStartError::Unknown(raw.to_string()));
    }

    #[test]
    fn reconoce_los_marcadores_propios_sin_hresult() {
        assert_eq!(
            classify_device_error("No microphone device available: DevicesNotAvailable"),
            AudioStartError::MicNotFound
        );
        assert_eq!(
            classify_device_error("No input device available for monitoring"),
            AudioStartError::MicNotFound
        );
    }

    #[test]
    fn extrae_solo_codigos_de_ocho_digitos() {
        // Un `0x0` suelto en el mensaje no debe leerse como HRESULT.
        assert_eq!(extract_hresult("buffer at 0x0 failed"), None);
        assert_eq!(extract_hresult("code (0x80070005)"), Some(0x8007_0005));
        assert_eq!(extract_hresult("sin codigo"), None);
    }

    /// Todo error accionable tiene que decirle al usuario qué hacer. Si alguien
    /// agrega una variante accionable sin remediación, esto lo caza.
    #[test]
    fn todo_error_tiene_mensaje_y_los_accionables_guian() {
        let todos = [
            AudioStartError::MicPermissionDenied,
            AudioStartError::MicNotFound,
            AudioStartError::MicInUse,
            AudioStartError::MicFormatUnsupported,
            AudioStartError::Unknown("x".to_string()),
        ];

        for err in todos {
            assert!(!err.user_message().is_empty(), "{err:?} sin mensaje");
            assert!(!err.code().is_empty(), "{err:?} sin código");
            // MicInUse es accionable pero su acción vive fuera de la app
            // (cerrar el otro programa), así que no tiene remediación propia.
            if err.is_actionable() && err != AudioStartError::MicInUse {
                assert!(err.remediation().is_some(), "{err:?} accionable sin remediación");
            }
        }
    }
}
