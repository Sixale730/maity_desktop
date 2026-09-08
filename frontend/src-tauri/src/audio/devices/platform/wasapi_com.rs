//! Utilidades COM compartidas para leer el property store de los endpoints
//! WASAPI **sin activar su `IAudioClient`**.
//!
//! Nacieron en `bluetooth_guard.rs` (ago-2026) y se sacaron aquí en sep-2026
//! (#17 de la auditoría de recursos) para que el monitor de dispositivos
//! (`device_monitor.rs`, vía `platform::snapshot_active_endpoints`) comparta el
//! mismo invariante: abrir el property store de un endpoint NO toca su audio
//! client, así que es seguro sobre el endpoint de captura de un headset
//! Bluetooth clásico (que al activarse conmutaría A2DP→HFP y degradaría la
//! música del usuario). Nunca sustituir estas lecturas por `Activate()`,
//! `default_input_config()` ni por la enumeración de cpal en un sondeo.

use windows::Win32::Media::Audio::IMMDevice;
use windows::Win32::System::Com::StructuredStorage::PropVariantToStringAlloc;
use windows::Win32::System::Com::{
    CoInitializeEx, CoTaskMemFree, CoUninitialize, COINIT_MULTITHREADED, STGM_READ,
};
use windows::Win32::UI::Shell::PropertiesSystem::PROPERTYKEY;

/// COM scope tolerante: si el hilo ya tiene COM inicializado en otro modelo
/// (`RPC_E_CHANGED_MODE`), seguimos adelante SIN ser dueños de la init y sin
/// llamar `CoUninitialize` al salir. El `ComRuntime` de `wasapi_loopback.rs`
/// trata ese caso como error fatal; aquí no puede serlo, porque corremos en
/// hilos del pool de tokio (o de `spawn_blocking`) que no controlamos.
///
/// Debe ser el PRIMER local de la función que lo usa: Rust suelta en orden
/// inverso de declaración, así que así sobrevive a toda colección, `IMMDevice`
/// o `IMMEndpoint` creados después.
pub(crate) struct ComScope {
    owns: bool,
}

impl ComScope {
    pub(crate) fn enter() -> Self {
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
pub(crate) unsafe fn read_string_property(device: &IMMDevice, key: &PROPERTYKEY) -> Option<String> {
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
