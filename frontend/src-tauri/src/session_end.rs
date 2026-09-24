//! Tipo de fin de sesión de Windows (#83, E1, desde 0.2.62).
//!
//! tao no procesa `WM_QUERYENDSESSION` y descarta el `lParam` de
//! `WM_ENDSESSION` (convierte el ES(TRUE) en `RunEvent::Exit` sin más datos),
//! así que sin esto no se sabe si la app murió por cierre de sesión, por
//! apagado/reinicio o por un cierre del Restart Manager (instalador). Este
//! módulo instala un subclass (`SetWindowSubclass`) en el HWND de `main` y en
//! las demás ventanas top-level del hilo principal (incluida la oculta de tao,
//! que es la que dispara `loop_destroyed` desde su WM_ENDSESSION) y registra el
//! tipo en una celda en memoria que `lifecycle::begin_exit` consulta vía
//! `observed()`.
//!
//! - El `lParam` fiable es el del QES; el del ES es respaldo (llega aunque no
//!   haya QES, p. ej. `EWX_FORCE`). Nuestra subclass se instala DESPUÉS que la
//!   de tao, así que corre ANTES que ella y alcanza a registrar el ES.
//! - QES no detiene nada: otra app puede cancelar el fin de sesión (llega
//!   ES(FALSE)); por eso ES(FALSE) limpia la celda y la intención del marcador.
//! - Dentro del WndProc: sin await, sin getters de ventana, sin emits; solo el
//!   Mutex de la celda, la escritura síncrona del marcador y `info!`/`warn!`
//!   (nunca `log::error!`: este módulo NO está excluido del puente de errores y
//!   dispararía telemetría desde el WndProc). El cuerpo va en `catch_unwind`
//!   (un panic cruzando FFI aborta el proceso) y SIEMPRE se delega en
//!   `DefSubclassProc`: nunca vetamos el fin de sesión.
//! - SIN `ShutdownBlockReasonCreate` ni checkpoint temprano en QES (decisión
//!   del contrato; se revisa tras E2E).
//!
//! La parte pura (constantes, `classify`, la celda, `observed`) compila en
//! todas las plataformas; solo `imp` va con `cfg(windows)`. Constantes como
//! literales documentados por Microsoft: sin feature nueva del crate `windows`
//! (`Win32_UI_WindowsAndMessaging`).

use std::sync::Mutex;
use std::time::{Duration, Instant};

/// `WM_QUERYENDSESSION`.
pub const WM_QUERYENDSESSION: u32 = 0x0011;
/// `WM_ENDSESSION`.
pub const WM_ENDSESSION: u32 = 0x0016;
/// `WM_NCDESTROY`.
pub const WM_NCDESTROY: u32 = 0x0082;
/// `ENDSESSION_CLOSEAPP`: Restart Manager (y `EWX_RESTARTAPPS` en un reinicio).
pub const LP_CLOSEAPP: u32 = 0x0000_0001;
/// `ENDSESSION_CRITICAL`: Windows cierra aunque la app se oponga.
pub const LP_CRITICAL: u32 = 0x4000_0000;
/// `ENDSESSION_LOGOFF`: cierre de sesión del usuario (no apagado).
pub const LP_LOGOFF: u32 = 0x8000_0000;
/// Id de nuestra subclass (tao usa 0 y 1). "MAIT".
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
const SUBCLASS_ID: usize = 0x4D41_4954;

/// Un registro de fin de sesión más viejo que esto ya no cuenta (un QES
/// cancelado sin ES(FALSE) visible no debe clasificar una salida posterior).
pub const RECORD_TTL: Duration = Duration::from_secs(120);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionEndKind {
    Logoff,
    Shutdown,
    /// Restart Manager SIN apagado del sistema (instalador que cierra la app).
    CloseApp,
    /// Solo por la métrica `SM_SHUTTINGDOWN`, sin mensaje observado.
    Unknown,
}

impl SessionEndKind {
    pub fn as_str(self) -> &'static str {
        match self {
            SessionEndKind::Logoff => "logoff",
            SessionEndKind::Shutdown => "shutdown",
            SessionEndKind::CloseApp => "close_app",
            SessionEndKind::Unknown => "unknown",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub enum SessionEndSource {
    QueryEndSession,
    EndSession,
    SystemMetric,
}

#[derive(Debug, Clone, Copy)]
pub struct SessionEndInfo {
    pub kind: SessionEndKind,
    pub critical: bool,
    pub close_app: bool,
    pub source: SessionEndSource,
    pub lparam: u32,
    pub observed_at: Instant,
}

/// Pura. `critical` = bit CRITICAL. Con CLOSEAPP: si el sistema se está
/// apagando (un reinicio con `EWX_RESTARTAPPS` también llega como CLOSEAPP) ⇒
/// `Logoff` si hay bit LOGOFF, si no `Shutdown`, con `close_app: true`; sin
/// apagado ⇒ `CloseApp` (Restart Manager real). Sin CLOSEAPP: LOGOFF ⇒
/// `Logoff`; resto ⇒ `Shutdown`.
pub fn classify(lparam: u32, shutting_down: bool) -> (SessionEndKind, bool, bool) {
    let critical = lparam & LP_CRITICAL != 0;
    let logoff = lparam & LP_LOGOFF != 0;
    if lparam & LP_CLOSEAPP != 0 {
        if shutting_down {
            let kind = if logoff {
                SessionEndKind::Logoff
            } else {
                SessionEndKind::Shutdown
            };
            return (kind, critical, true);
        }
        return (SessionEndKind::CloseApp, critical, false);
    }
    if logoff {
        (SessionEndKind::Logoff, critical, false)
    } else {
        (SessionEndKind::Shutdown, critical, false)
    }
}

/// Registro del último fin de sesión observado. `std::sync::Mutex` (síncrono):
/// se toma desde el WndProc y desde el hilo principal sin runtime. Nunca
/// `.unwrap()` del lock: con el mutex envenenado se ignora el registro.
pub struct SessionEndCell {
    inner: Mutex<Option<SessionEndInfo>>,
}

fn is_fresh(info: &SessionEndInfo, now: Instant, ttl: Duration) -> bool {
    now.saturating_duration_since(info.observed_at) <= ttl
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
impl SessionEndCell {
    pub const fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }

    /// QES: sobrescribe. Devuelve `true` si el registro cambió respecto de uno
    /// fresco equivalente (mismo origen, tipo y `lParam`): Windows manda el QES
    /// a CADA ventana top-level y el llamador solo escribe el marcador una vez.
    pub fn record(&self, info: SessionEndInfo) -> bool {
        if let Ok(mut g) = self.inner.lock() {
            let same = g.as_ref().is_some_and(|prev| {
                is_fresh(prev, info.observed_at, RECORD_TTL)
                    && prev.source == info.source
                    && prev.kind == info.kind
                    && prev.lparam == info.lparam
            });
            *g = Some(info);
            return !same;
        }
        false
    }

    /// ES(TRUE): no pisa un registro FRESCO (el QES trae el `lParam` fiable),
    /// pero SÍ reemplaza uno más viejo que `RECORD_TTL`.
    pub fn record_if_absent(&self, info: SessionEndInfo, now: Instant) {
        if let Ok(mut g) = self.inner.lock() {
            let keep = g.as_ref().is_some_and(|prev| is_fresh(prev, now, RECORD_TTL));
            if !keep {
                *g = Some(info);
            }
        }
    }

    pub fn clear(&self) {
        if let Ok(mut g) = self.inner.lock() {
            *g = None;
        }
    }

    pub fn fresh(&self, now: Instant, ttl: Duration) -> Option<SessionEndInfo> {
        let g = self.inner.lock().ok()?;
        g.as_ref().copied().filter(|i| is_fresh(i, now, ttl))
    }
}

static CELL: SessionEndCell = SessionEndCell::new();

/// Fin de sesión observado: registro fresco del subclass o, si no hay, el
/// respaldo `SM_SHUTTINGDOWN` como `Unknown`. En no-Windows siempre `None`
/// (nadie registra y la métrica devuelve `false`).
pub fn observed() -> Option<SessionEndInfo> {
    let now = Instant::now();
    if let Some(info) = CELL.fresh(now, RECORD_TTL) {
        return Some(info);
    }
    if crate::logging::telemetry::lifecycle::os_shutting_down() {
        return Some(SessionEndInfo {
            kind: SessionEndKind::Unknown,
            critical: false,
            close_app: false,
            source: SessionEndSource::SystemMetric,
            lparam: 0,
            observed_at: now,
        });
    }
    None
}

#[cfg(target_os = "windows")]
mod imp {
    use super::*;
    use crate::logging::telemetry::lifecycle;
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::Threading::GetCurrentThreadId;
    use windows::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};

    type EnumProc = unsafe extern "system" fn(hwnd: isize, lparam: isize) -> i32;

    // Extern crudo de `user32` (sin la feature `Win32_UI_WindowsAndMessaging`).
    // HWND y LPARAM son del tamaño de un puntero: `isize` es ABI-compatible.
    #[link(name = "user32")]
    extern "system" {
        fn EnumThreadWindows(dw_thread_id: u32, lp_fn: Option<EnumProc>, l_param: isize) -> i32;
    }

    unsafe extern "system" fn collect_hwnd(hwnd: isize, lparam: isize) -> i32 {
        let pushed = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            // SAFETY: `lparam` es el `&mut Vec<isize>` que pasa `thread_windows`,
            // vivo durante toda la llamada síncrona a `EnumThreadWindows`.
            let v = unsafe { &mut *(lparam as *mut Vec<isize>) };
            v.push(hwnd);
        }));
        i32::from(pushed.is_ok())
    }

    /// Ventanas top-level del hilo actual (el principal en `setup()`).
    fn thread_windows() -> Vec<isize> {
        let mut found: Vec<isize> = Vec::new();
        // SAFETY: el callback solo escribe en `found`, que sobrevive a la llamada.
        unsafe {
            EnumThreadWindows(
                GetCurrentThreadId(),
                Some(collect_hwnd),
                &mut found as *mut Vec<isize> as isize,
            );
        }
        found
    }

    fn subclass(hwnd: isize) -> bool {
        // SAFETY: se llama en el hilo dueño de la ventana (setup corre en el
        // hilo principal, igual que el event loop de tao).
        unsafe {
            SetWindowSubclass(
                HWND(hwnd as *mut core::ffi::c_void),
                Some(subclass_proc),
                SUBCLASS_ID,
                0,
            )
        }
        .as_bool()
    }

    /// Instala el subclass en `main` y en las demás ventanas top-level del hilo
    /// principal. `SetWindowSubclass` con el mismo proc+id solo actualiza el
    /// refdata, así que repetir una ventana es inocuo. Nunca hace panic.
    pub fn install(window: &tauri::WebviewWindow) {
        // tauri devuelve el HWND de windows 0.61; el de esta app es 0.58 — mismo
        // layout (patrón de store_update.rs).
        let main = match window.hwnd() {
            Ok(h) => Some(h.0 as isize),
            Err(e) => {
                log::warn!("[session_end] hwnd() de main falló: {}", e);
                None
            }
        };
        if let Some(h) = main {
            if subclass(h) {
                log::info!("[session_end] subclass instalado en main");
            } else {
                log::warn!("[session_end] SetWindowSubclass devolvió FALSE en main");
            }
        }

        let others: Vec<isize> = thread_windows()
            .into_iter()
            .filter(|h| Some(*h) != main)
            .collect();
        if others.is_empty() {
            log::warn!("[session_end] EnumThreadWindows no devolvió otras ventanas; solo main");
            return;
        }
        let ok = others.iter().filter(|h| subclass(**h)).count();
        log::info!(
            "[session_end] subclass instalado en {}/{} ventanas top-level adicionales del hilo",
            ok,
            others.len()
        );
    }

    fn on_message(msg: u32, wparam: WPARAM, lparam: LPARAM) {
        let lp = lparam.0 as u32;
        match msg {
            WM_QUERYENDSESSION => {
                let sd = lifecycle::os_shutting_down();
                let (kind, critical, close_app) = classify(lp, sd);
                let changed = CELL.record(SessionEndInfo {
                    kind,
                    critical,
                    close_app,
                    source: SessionEndSource::QueryEndSession,
                    lparam: lp,
                    observed_at: Instant::now(),
                });
                if changed {
                    lifecycle::note_session_ending(kind);
                    log::info!(
                        "[session_end] WM_QUERYENDSESSION kind={} critical={} lparam={:#x}",
                        kind.as_str(),
                        critical,
                        lp
                    );
                }
            }
            WM_ENDSESSION if wparam.0 == 0 => {
                CELL.clear();
                lifecycle::clear_session_ending();
                log::info!("[session_end] WM_ENDSESSION(FALSE): fin de sesión cancelado");
            }
            WM_ENDSESSION => {
                let sd = lifecycle::os_shutting_down();
                let (kind, critical, close_app) = classify(lp, sd);
                let now = Instant::now();
                CELL.record_if_absent(
                    SessionEndInfo {
                        kind,
                        critical,
                        close_app,
                        source: SessionEndSource::EndSession,
                        lparam: lp,
                        observed_at: now,
                    },
                    now,
                );
            }
            _ => {}
        }
    }

    unsafe extern "system" fn subclass_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        _id: usize,
        _ref: usize,
    ) -> LRESULT {
        if msg == WM_NCDESTROY {
            // SAFETY: mismo hilo y mismo par proc+id con el que se instaló.
            let _ = unsafe { RemoveWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID) };
        } else if msg == WM_QUERYENDSESSION || msg == WM_ENDSESSION {
            let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                on_message(msg, wparam, lparam)
            }));
        }
        // Siempre delegar: nunca devolvemos FALSE (no vetamos el fin de sesión).
        // SAFETY: argumentos recibidos tal cual del sistema.
        unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
    }
}

#[cfg(target_os = "windows")]
pub use imp::install;

/// Stub fuera de Windows: no hay fin de sesión que observar.
#[cfg(not(target_os = "windows"))]
pub fn install(_window: &tauri::WebviewWindow) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_tabla() {
        use SessionEndKind::*;
        // (lparam, shutting_down) ⇒ (kind, critical, close_app)
        let casos: &[(u32, bool, (SessionEndKind, bool, bool))] = &[
            (0, false, (Shutdown, false, false)),
            (0, true, (Shutdown, false, false)),
            (0x8000_0000, false, (Logoff, false, false)),
            (0x8000_0000, true, (Logoff, false, false)),
            (0x1, false, (CloseApp, false, false)),
            (0x1, true, (Shutdown, false, true)),
            (0x8000_0001, true, (Logoff, false, true)),
            (0x4000_0000, false, (Shutdown, true, false)),
            (0x4000_0000, true, (Shutdown, true, false)),
            (0x4000_0001, false, (CloseApp, true, false)),
            (0xC000_0000, false, (Logoff, true, false)),
            (0xC000_0000, true, (Logoff, true, false)),
        ];
        for &(lp, sd, esperado) in casos {
            assert_eq!(classify(lp, sd), esperado, "lparam={:#x} sd={}", lp, sd);
        }
    }

    #[test]
    fn as_str_de_cada_tipo() {
        assert_eq!(SessionEndKind::Logoff.as_str(), "logoff");
        assert_eq!(SessionEndKind::Shutdown.as_str(), "shutdown");
        assert_eq!(SessionEndKind::CloseApp.as_str(), "close_app");
        assert_eq!(SessionEndKind::Unknown.as_str(), "unknown");
    }

    fn info(kind: SessionEndKind, source: SessionEndSource, lparam: u32, at: Instant) -> SessionEndInfo {
        SessionEndInfo {
            kind,
            critical: false,
            close_app: false,
            source,
            lparam,
            observed_at: at,
        }
    }

    #[test]
    fn celda_record_y_fresh() {
        let cell = SessionEndCell::new();
        let t0 = Instant::now();
        assert!(cell.fresh(t0, RECORD_TTL).is_none());
        assert!(cell.record(info(SessionEndKind::Logoff, SessionEndSource::QueryEndSession, 0x8000_0000, t0)));
        let got = cell.fresh(t0, RECORD_TTL).expect("fresco");
        assert_eq!(got.kind, SessionEndKind::Logoff);
        assert_eq!(got.source, SessionEndSource::QueryEndSession);
    }

    #[test]
    fn celda_record_repetido_no_cuenta_como_cambio() {
        let cell = SessionEndCell::new();
        let t0 = Instant::now();
        let qes = info(SessionEndKind::Shutdown, SessionEndSource::QueryEndSession, 0, t0);
        assert!(cell.record(qes));
        // El QES llega a cada ventana top-level: el segundo igual no es cambio.
        assert!(!cell.record(qes));
        // Otro tipo sí.
        assert!(cell.record(info(SessionEndKind::Logoff, SessionEndSource::QueryEndSession, 0x8000_0000, t0)));
    }

    #[test]
    fn celda_record_if_absent_no_pisa_un_qes_fresco() {
        let cell = SessionEndCell::new();
        let t0 = Instant::now();
        cell.record(info(SessionEndKind::Logoff, SessionEndSource::QueryEndSession, 0x8000_0000, t0));
        let t1 = t0 + Duration::from_secs(1);
        cell.record_if_absent(info(SessionEndKind::Shutdown, SessionEndSource::EndSession, 0, t1), t1);
        let got = cell.fresh(t1, RECORD_TTL).expect("fresco");
        assert_eq!(got.kind, SessionEndKind::Logoff);
        assert_eq!(got.source, SessionEndSource::QueryEndSession);
    }

    #[test]
    fn celda_record_if_absent_reemplaza_uno_viejo() {
        let cell = SessionEndCell::new();
        let t0 = Instant::now();
        cell.record(info(SessionEndKind::Logoff, SessionEndSource::QueryEndSession, 0x8000_0000, t0));
        let later = t0 + Duration::from_secs(121);
        cell.record_if_absent(info(SessionEndKind::Shutdown, SessionEndSource::EndSession, 0, later), later);
        let got = cell.fresh(later, RECORD_TTL).expect("fresco");
        assert_eq!(got.kind, SessionEndKind::Shutdown);
        assert_eq!(got.source, SessionEndSource::EndSession);
    }

    #[test]
    fn celda_record_if_absent_en_vacio_registra() {
        let cell = SessionEndCell::new();
        let t0 = Instant::now();
        cell.record_if_absent(info(SessionEndKind::Shutdown, SessionEndSource::EndSession, 0, t0), t0);
        assert_eq!(cell.fresh(t0, RECORD_TTL).map(|i| i.source), Some(SessionEndSource::EndSession));
    }

    #[test]
    fn celda_clear_y_ttl() {
        let cell = SessionEndCell::new();
        let t0 = Instant::now();
        cell.record(info(SessionEndKind::Shutdown, SessionEndSource::QueryEndSession, 0, t0));
        cell.clear();
        assert!(cell.fresh(t0, RECORD_TTL).is_none());

        cell.record(info(SessionEndKind::Shutdown, SessionEndSource::QueryEndSession, 0, t0));
        assert!(cell.fresh(t0 + RECORD_TTL, RECORD_TTL).is_some());
        assert!(cell.fresh(t0 + RECORD_TTL + Duration::from_secs(1), RECORD_TTL).is_none());
    }

    /// Sin la feature `Win32_UI_WindowsAndMessaging` los valores van como
    /// literales: fijarlos contra lo documentado por Microsoft para detectar un
    /// cambio accidental.
    #[test]
    fn literales_de_win32_documentados() {
        assert_eq!(WM_QUERYENDSESSION, 0x11);
        assert_eq!(WM_ENDSESSION, 0x16);
        assert_eq!(WM_NCDESTROY, 0x82);
        assert_eq!(LP_CLOSEAPP, 0x1);
        assert_eq!(LP_CRITICAL, 0x4000_0000);
        assert_eq!(LP_LOGOFF, 0x8000_0000);
        // tao usa los ids 0 y 1.
        assert!(SUBCLASS_ID > 1);
    }
}
