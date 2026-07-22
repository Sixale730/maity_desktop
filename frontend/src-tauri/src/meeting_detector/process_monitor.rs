//! Process Monitor
//!
//! Monitors running processes to detect meeting applications.
//!
//! Criterio de detección (jul-2026, rediseño anti-falsos-positivos):
//! - **Match EXACTO** del nombre de ejecutable, no `contains()`. Antes `"zoom"`
//!   suelto disparaba con `ZoomIt` (Sysinternals), `"teams"` con `TeamsUpdate`,
//!   `"skype"` con `SkypeBackgroundHost`, etc.
//! - **Dedup por app + flanco de subida**: se notifica una sola vez cuando la app
//!   PASA de ausente a presente, no una vez por PID. Antes cada worker que Teams/
//!   Zoom reciclaba en background nacía con un PID nuevo → detección nueva → un
//!   diálogo falso al día sin abrir nada.
//! - **Cooldown por app**: aunque haya flanco de subida, no se re-notifica la
//!   misma app hasta que pasa `notify_cooldown_minutes`.

use serde::{Deserialize, Serialize};
use sysinfo::{System, ProcessRefreshKind, RefreshKind};
use std::collections::{HashMap, HashSet};
use std::time::Instant;

/// Known meeting applications with their process names
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum MeetingApp {
    Zoom,
    MicrosoftTeams,
    GoogleMeet,
    Webex,
    Slack,
    Discord,
    Skype,
    Unknown(String),
}

impl MeetingApp {
    /// Get the display name for the meeting app
    pub fn display_name(&self) -> &str {
        match self {
            MeetingApp::Zoom => "Zoom",
            MeetingApp::MicrosoftTeams => "Microsoft Teams",
            MeetingApp::GoogleMeet => "Google Meet",
            MeetingApp::Webex => "Webex",
            MeetingApp::Slack => "Slack Huddle",
            MeetingApp::Discord => "Discord",
            MeetingApp::Skype => "Skype",
            MeetingApp::Unknown(name) => name,
        }
    }

    /// Get the icon name for the meeting app (for UI)
    pub fn icon_name(&self) -> &str {
        match self {
            MeetingApp::Zoom => "zoom",
            MeetingApp::MicrosoftTeams => "teams",
            MeetingApp::GoogleMeet => "meet",
            MeetingApp::Webex => "webex",
            MeetingApp::Slack => "slack",
            MeetingApp::Discord => "discord",
            MeetingApp::Skype => "skype",
            MeetingApp::Unknown(_) => "unknown",
        }
    }
}

/// Information about a detected meeting
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectedMeeting {
    /// The meeting application detected
    pub app: MeetingApp,
    /// Process ID
    pub pid: u32,
    /// Process name
    pub process_name: String,
    /// Window title (if available)
    pub window_title: Option<String>,
    /// Suggested meeting name based on detection
    pub suggested_name: String,
    /// Timestamp when detected
    pub detected_at: u64,
}

/// Process patterns for detecting meeting apps
struct ProcessPattern {
    app: MeetingApp,
    /// Nombres de ejecutable PRINCIPAL (match exacto, lowercase). Su presencia es
    /// lo que dispara una detección.
    process_names: Vec<&'static str>,
    /// Ejecutables HELPER de captura (match exacto, lowercase). Su presencia es una
    /// señal fuerte de llamada activa, pero por sí sola NO dispara detección.
    /// Reservado para la futura Fase 3 (señal real de reunión).
    #[allow(dead_code)]
    helper_names: Vec<&'static str>,
    /// Browser tab patterns (for web-based meetings) - reserved for future use
    #[allow(dead_code)]
    browser_patterns: Vec<&'static str>,
}

/// Get the list of process patterns for meeting detection.
///
/// IMPORTANTE: `process_names` se compara por IGUALDAD EXACTA (lowercase). No
/// agregar subcadenas genéricas como `"zoom"`, `"teams"` o `"skype"` — reintroducen
/// los falsos positivos que este rediseño eliminó (ZoomIt, TeamsUpdate,
/// SkypeBackgroundHost, instaladores, etc.).
fn get_process_patterns() -> Vec<ProcessPattern> {
    vec![
        ProcessPattern {
            app: MeetingApp::Zoom,
            process_names: vec![
                "zoom.exe",   // Windows
                "zoom.us",    // macOS (nombre del proceso del bundle)
                "zoom",       // Linux
            ],
            // CptHost.exe es el host de captura de Zoom (presente sólo durante la
            // llamada). Antes estaba mal escrito como "caphost.exe" en process_names.
            helper_names: vec!["cpthost.exe"],
            browser_patterns: vec!["zoom.us/j/", "zoom.us/wc/"],
        },
        ProcessPattern {
            app: MeetingApp::MicrosoftTeams,
            process_names: vec![
                "teams.exe",     // Teams clásico
                "ms-teams.exe",  // Teams nuevo (Windows)
                "msteams.exe",   // variante
                "msteams",       // macOS (nombre del proceso "MSTeams")
            ],
            helper_names: vec![],
            browser_patterns: vec!["teams.microsoft.com", "teams.live.com"],
        },
        ProcessPattern {
            app: MeetingApp::GoogleMeet,
            process_names: vec![], // Google Meet is browser-only
            helper_names: vec![],
            browser_patterns: vec!["meet.google.com"],
        },
        ProcessPattern {
            app: MeetingApp::Webex,
            process_names: vec![
                "webexmta.exe",         // Webex Meetings app
                "ciscowebexstart.exe",  // launcher de reunión
                "webex.exe",
                "webex",
            ],
            // atmgr.exe (telemetry manager) se ELIMINÓ: corre en background sin
            // reunión → falso positivo.
            helper_names: vec![],
            browser_patterns: vec!["webex.com"],
        },
        ProcessPattern {
            app: MeetingApp::Slack,
            process_names: vec!["slack.exe", "slack"],
            helper_names: vec![],
            browser_patterns: vec!["app.slack.com/huddle"],
        },
        ProcessPattern {
            app: MeetingApp::Discord,
            process_names: vec!["discord.exe", "discord"],
            helper_names: vec![],
            browser_patterns: vec!["discord.com/channels"],
        },
        ProcessPattern {
            app: MeetingApp::Skype,
            process_names: vec!["skype.exe", "skypeapp.exe", "skype"],
            helper_names: vec![],
            browser_patterns: vec!["web.skype.com"],
        },
    ]
}

/// Devuelve la app cuyo ejecutable PRINCIPAL coincide EXACTAMENTE con
/// `process_name_lower` (ya en minúsculas), o `None`.
///
/// Es la única puerta de entrada de matching: `detect_meetings`,
/// `get_active_meetings` e `is_meeting_active` la comparten para no divergir.
fn match_main_app(process_name_lower: &str) -> Option<MeetingApp> {
    for pattern in get_process_patterns() {
        for name in &pattern.process_names {
            if process_name_lower == *name {
                return Some(pattern.app.clone());
            }
        }
    }
    None
}

/// Una app de reunión con proceso principal vivo y su PID representativo.
struct RunningApp {
    app: MeetingApp,
    pid: u32,
    process_name: String,
}

/// Browser process names to check for web-based meetings
#[allow(dead_code)]
fn get_browser_processes() -> Vec<&'static str> {
    vec![
        "chrome.exe",
        "msedge.exe",
        "firefox.exe",
        "brave.exe",
        "opera.exe",
        "vivaldi.exe",
        "chromium.exe",
        // macOS/Linux
        "google chrome",
        "microsoft edge",
        "firefox",
        "brave browser",
        "safari",
    ]
}

/// Monitor for meeting application processes
pub struct ProcessMonitor {
    system: System,
    /// Último instante en que se notificó cada app (control de cooldown).
    last_notified: HashMap<MeetingApp, Instant>,
    /// Apps con proceso principal vivo en el tick anterior (para el flanco de subida).
    apps_present: HashSet<MeetingApp>,
    /// PIDs que el usuario pidió ignorar (una vez). Se excluyen de la presencia.
    ignored_pids: HashSet<u32>,
}

impl ProcessMonitor {
    /// Create a new process monitor
    pub fn new() -> Self {
        let system = System::new_with_specifics(
            RefreshKind::new().with_processes(ProcessRefreshKind::everything())
        );
        Self {
            system,
            last_notified: HashMap::new(),
            apps_present: HashSet::new(),
            ignored_pids: HashSet::new(),
        }
    }

    /// Refresca la lista de procesos.
    fn refresh(&mut self) {
        self.system.refresh_processes_specifics(
            sysinfo::ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::new()
        );
    }

    /// Escanea los procesos vivos y devuelve UNA entrada por app de reunión con
    /// proceso principal activo (dedup por app), excluyendo PIDs ignorados.
    /// Asume que `refresh()` ya se llamó.
    fn scan_running_apps(&self) -> Vec<RunningApp> {
        let mut seen: HashSet<MeetingApp> = HashSet::new();
        let mut running: Vec<RunningApp> = Vec::new();

        for (pid, process) in self.system.processes() {
            let pid_u32 = pid.as_u32();
            if self.ignored_pids.contains(&pid_u32) {
                continue;
            }
            let process_name_lower = process.name().to_string_lossy().to_lowercase();
            if let Some(app) = match_main_app(&process_name_lower) {
                if seen.insert(app.clone()) {
                    running.push(RunningApp {
                        app,
                        pid: pid_u32,
                        process_name: process.name().to_string_lossy().to_string(),
                    });
                }
            }
        }

        running
    }

    /// Construye un `DetectedMeeting` a partir de una app en ejecución.
    fn build_detected(app: &RunningApp, now_secs: u64) -> DetectedMeeting {
        DetectedMeeting {
            app: app.app.clone(),
            pid: app.pid,
            process_name: app.process_name.clone(),
            window_title: None,
            suggested_name: format!(
                "{} - {}",
                app.app.display_name(),
                chrono::Local::now().format("%Y-%m-%d %H:%M")
            ),
            detected_at: now_secs,
        }
    }

    /// Refresca la lista de procesos y devuelve las apps que acaban de arrancar
    /// una reunión (flanco de subida) y cuyo cooldown ya expiró.
    ///
    /// `cooldown_minutes`: minutos que deben pasar desde el último aviso de una app
    /// antes de volver a notificarla, incluso si vuelve a haber flanco de subida.
    pub fn detect_meetings(&mut self, cooldown_minutes: u32) -> Vec<DetectedMeeting> {
        self.refresh();
        self.prune_ignored_pids();

        let now_secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let now_instant = Instant::now();
        let cooldown = std::time::Duration::from_secs((cooldown_minutes as u64) * 60);

        let running = self.scan_running_apps();
        let present_now: HashSet<MeetingApp> =
            running.iter().map(|r| r.app.clone()).collect();

        let mut newly_detected: Vec<DetectedMeeting> = Vec::new();

        for app in &running {
            // Flanco de subida: sólo si estaba AUSENTE en el tick anterior.
            let was_present = self.apps_present.contains(&app.app);
            if was_present {
                continue;
            }

            // Cooldown: no re-notificar la misma app antes de tiempo.
            if let Some(last) = self.last_notified.get(&app.app) {
                if now_instant.duration_since(*last) < cooldown {
                    continue;
                }
            }

            newly_detected.push(Self::build_detected(app, now_secs));
            self.last_notified.insert(app.app.clone(), now_instant);
        }

        // Actualizar la presencia para el próximo tick.
        self.apps_present = present_now;

        newly_detected
    }

    /// Check if any meeting app is currently running (proceso principal).
    /// No filtra por PIDs ignorados: es una señal cruda de "hay reunión abierta"
    /// que usa el auto-cierre del scheduled recording.
    pub fn is_meeting_active(&mut self) -> bool {
        self.refresh();

        for (_pid, process) in self.system.processes() {
            let process_name_lower = process.name().to_string_lossy().to_lowercase();
            if match_main_app(&process_name_lower).is_some() {
                return true;
            }
        }

        false
    }

    /// Get all currently running meeting apps (una entrada por app).
    pub fn get_active_meetings(&mut self) -> Vec<DetectedMeeting> {
        self.refresh();
        self.prune_ignored_pids();

        let now_secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);

        self.scan_running_apps()
            .iter()
            .map(|app| Self::build_detected(app, now_secs))
            .collect()
    }

    /// Elimina de `ignored_pids` los PIDs que ya no existen (evita fugas).
    fn prune_ignored_pids(&mut self) {
        if self.ignored_pids.is_empty() {
            return;
        }
        let current_pids: HashSet<u32> = self.system.processes()
            .keys()
            .map(|pid| pid.as_u32())
            .collect();
        self.ignored_pids.retain(|pid| current_pids.contains(pid));
    }

    /// Clear the detection history (useful when user dismisses a notification)
    pub fn clear_detection_history(&mut self) {
        self.last_notified.clear();
        self.apps_present.clear();
        self.ignored_pids.clear();
    }

    /// Ignore a specific PID (when user dismisses notification for that meeting).
    /// El proceso ignorado deja de contar como presente, de modo que el diálogo no
    /// reaparece mientras siga vivo.
    pub fn ignore_pid(&mut self, pid: u32) {
        self.ignored_pids.insert(pid);
    }
}

impl Default for ProcessMonitor {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_meeting_app_display_name() {
        assert_eq!(MeetingApp::Zoom.display_name(), "Zoom");
        assert_eq!(MeetingApp::MicrosoftTeams.display_name(), "Microsoft Teams");
        assert_eq!(MeetingApp::GoogleMeet.display_name(), "Google Meet");
    }

    #[test]
    fn test_process_monitor_creation() {
        let monitor = ProcessMonitor::new();
        assert!(monitor.last_notified.is_empty());
        assert!(monitor.apps_present.is_empty());
        assert!(monitor.ignored_pids.is_empty());
    }

    #[test]
    fn test_match_main_app_exact() {
        // Ejecutables reales de reunión → detectan.
        assert_eq!(match_main_app("zoom.exe"), Some(MeetingApp::Zoom));
        assert_eq!(match_main_app("ms-teams.exe"), Some(MeetingApp::MicrosoftTeams));
        assert_eq!(match_main_app("webexmta.exe"), Some(MeetingApp::Webex));
    }

    #[test]
    fn test_match_main_app_rejects_false_positives() {
        // Los falsos positivos históricos NO deben coincidir (antes: contains()).
        assert_eq!(match_main_app("zoomit.exe"), None);            // Sysinternals ZoomIt
        assert_eq!(match_main_app("teamsupdate.exe"), None);       // updater de Teams
        assert_eq!(match_main_app("skypebackgroundhost.exe"), None); // helper de Skype
        assert_eq!(match_main_app("atmgr.exe"), None);            // Webex telemetry
        assert_eq!(match_main_app("cpthost.exe"), None);          // helper de captura, no principal
    }
}
