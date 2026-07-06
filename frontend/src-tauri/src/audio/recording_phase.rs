// audio/recording_phase.rs
//
// Máquina de fases ÚNICA de la grabación — la fuente de verdad global del
// proceso. Reemplaza los flags dispersos (`IS_RECORDING`, `START_IN_PROGRESS`)
// cuya separación check-then-act permitió arranques concurrentes duplicados
// (5 arranques en 16 ms, reporte usuario jul-2026).
//
// Principios de diseño:
// - Transiciones vía `compare_exchange` tipadas: el check y el act son la MISMA
//   operación atómica. El patrón incorrecto (load → decidir → store) no se puede
//   expresar con esta API.
// - Lock-free (AtomicU8): sin poisoning, apta para loops calientes (reminder de
//   pausa, ticks del scheduler, comandos de polling del frontend).
// - INVARIANTE: este módulo JAMÁS toma locks ni llama al RecordingManager.
//   Cualquier orden "transición CAS + lock del manager" es seguro; anidar la
//   transición DENTRO de un lock guard está prohibido por convención.
// - El struct `RecordingState` (recording_state.rs) NO se acopla a esta máquina:
//   es estado interno de la sesión de captura (hot paths del callback de audio)
//   y durante el drenaje del stop conserva deliberadamente `recording=true`
//   unos instantes más que la máquina (que ya está en Stopping).
//
// Diagrama de transiciones válidas:
//
//        ┌──────── falla arranque ────────┐
//        ▼                                │
//      Idle ──► Starting ──► Recording ⇄ Paused
//        ▲                       │           │
//        │                       ▼           ▼
//        └────────────────── Stopping ◄──────┘

use std::sync::atomic::{AtomicU8, Ordering};

/// Fase global de la grabación. `Stopping` modela explícitamente el antiguo
/// "IS_RECORDING=false early" del stop: la sesión ya no está activa hacia
/// afuera, pero el pipeline sigue drenando/salvando.
#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecordingPhase {
    Idle = 0,
    Starting = 1,
    Recording = 2,
    Paused = 3,
    Stopping = 4,
}

impl RecordingPhase {
    /// Nombre estable para logs y para el campo `phase` de `get_recording_state`.
    pub fn as_str(&self) -> &'static str {
        match self {
            RecordingPhase::Idle => "idle",
            RecordingPhase::Starting => "starting",
            RecordingPhase::Recording => "recording",
            RecordingPhase::Paused => "paused",
            RecordingPhase::Stopping => "stopping",
        }
    }

    /// Equivalente semántico del viejo `IS_RECORDING`: hay una sesión activa.
    /// False en `Starting` (aún no arranca) y en `Stopping` (el "early false"
    /// intencional que corta eventos/queries durante el drenaje).
    pub fn is_session_active(&self) -> bool {
        matches!(self, RecordingPhase::Recording | RecordingPhase::Paused)
    }

    fn from_u8(v: u8) -> Self {
        match v {
            1 => RecordingPhase::Starting,
            2 => RecordingPhase::Recording,
            3 => RecordingPhase::Paused,
            4 => RecordingPhase::Stopping,
            _ => RecordingPhase::Idle,
        }
    }

    /// Tabla de transiciones válidas de la máquina (documentación ejecutable).
    pub const fn is_valid_transition(from: Self, to: Self) -> bool {
        use RecordingPhase::*;
        matches!(
            (from, to),
            (Idle, Starting)          // arranque
                | (Starting, Recording)   // arranque exitoso (commit del gate)
                | (Starting, Idle)        // arranque fallido (drop del gate)
                | (Recording, Paused)     // pausa
                | (Paused, Recording)     // reanudar
                | (Recording, Stopping)   // stop
                | (Paused, Stopping)      // stop desde pausa
                | (Stopping, Idle)        // teardown completo
        )
    }
}

/// Máquina instanciable: producción usa el singleton `RECORDING_PHASE`; los
/// tests crean instancias propias (corren en paralelo en el mismo proceso y un
/// static compartido los haría interferir).
#[derive(Debug)]
pub struct PhaseMachine {
    phase: AtomicU8,
}

impl PhaseMachine {
    pub const fn new() -> Self {
        Self {
            phase: AtomicU8::new(RecordingPhase::Idle as u8),
        }
    }

    pub fn current(&self) -> RecordingPhase {
        RecordingPhase::from_u8(self.phase.load(Ordering::SeqCst))
    }

    /// Transición atómica `from → to`. `Ok(())` si esta llamada ganó la CAS;
    /// `Err(fase_observada)` si la fase actual no era `from` (el caller decide
    /// el mensaje según lo observado). Devuelve `Err` también para transiciones
    /// fuera de la tabla — con `debug_assert` para atrapar bugs en desarrollo.
    pub fn try_transition(
        &self,
        from: RecordingPhase,
        to: RecordingPhase,
    ) -> Result<(), RecordingPhase> {
        debug_assert!(
            RecordingPhase::is_valid_transition(from, to),
            "transición inválida solicitada: {:?} → {:?}",
            from,
            to
        );
        if !RecordingPhase::is_valid_transition(from, to) {
            return Err(self.current());
        }
        self.phase
            .compare_exchange(from as u8, to as u8, Ordering::SeqCst, Ordering::SeqCst)
            .map(|_| ())
            .map_err(RecordingPhase::from_u8)
    }
}

/// Singleton de producción.
static RECORDING_PHASE: PhaseMachine = PhaseMachine::new();

/// Fase actual de la grabación (lectura lock-free).
pub fn current_phase() -> RecordingPhase {
    RECORDING_PHASE.current()
}

/// Transición sobre el singleton. Ver [`PhaseMachine::try_transition`].
pub fn try_transition(from: RecordingPhase, to: RecordingPhase) -> Result<(), RecordingPhase> {
    RECORDING_PHASE.try_transition(from, to)
}

// ============================================================================
// Gates RAII — el guard y la transición son la misma operación
// ============================================================================

/// Gate de arranque: `acquire()` ES la transición `Idle → Starting` (una sola
/// CAS subsume el viejo `START_IN_PROGRESS` + el check de `IS_RECORDING`).
/// `commit()` consume el gate con `Starting → Recording` — el punto único donde
/// "empieza" la grabación. Si el gate se dropea sin commit (error en cualquier
/// camino del arranque), revierte `Starting → Idle` automáticamente.
#[derive(Debug)]
pub struct StartGate {
    machine: &'static PhaseMachine,
    committed: bool,
}

impl StartGate {
    /// Sobre el singleton de producción.
    pub fn acquire() -> Result<Self, String> {
        Self::acquire_on(&RECORDING_PHASE)
    }

    /// Sobre una máquina concreta (tests).
    pub fn acquire_on(machine: &'static PhaseMachine) -> Result<Self, String> {
        match machine.try_transition(RecordingPhase::Idle, RecordingPhase::Starting) {
            Ok(()) => Ok(Self {
                machine,
                committed: false,
            }),
            // Mensajes compatibles con los que el frontend/lifecycle-log ya conocen.
            Err(RecordingPhase::Starting) => {
                Err("Recording start already in progress".to_string())
            }
            Err(RecordingPhase::Recording) | Err(RecordingPhase::Paused) => {
                Err("Recording already in progress".to_string())
            }
            Err(RecordingPhase::Stopping) => {
                Err("Recording is still stopping, try again in a moment".to_string())
            }
            Err(observed) => Err(format!(
                "Cannot start recording from phase '{}'",
                observed.as_str()
            )),
        }
    }

    /// `Starting → Recording`. Consumir el gate marca el instante exacto en que
    /// la sesión queda activa hacia afuera (donde antes se subía `IS_RECORDING`).
    pub fn commit(mut self) -> Result<(), String> {
        match self
            .machine
            .try_transition(RecordingPhase::Starting, RecordingPhase::Recording)
        {
            Ok(()) => {
                self.committed = true;
                Ok(())
            }
            Err(observed) => Err(format!(
                "Cannot commit recording start from phase '{}'",
                observed.as_str()
            )),
        }
    }
}

impl Drop for StartGate {
    fn drop(&mut self) {
        if !self.committed {
            // Arranque fallido/abandonado: liberar la fase. Si otra cosa ya la
            // movió (no debería), la CAS falla sin efectos — nunca pisa estado ajeno.
            let _ = self
                .machine
                .try_transition(RecordingPhase::Starting, RecordingPhase::Idle);
        }
    }
}

/// Gate de stop: `acquire()` ES la transición `Recording|Paused → Stopping`.
/// El `Drop` transiciona `Stopping → Idle` INCONDICIONALMENTE: un stop que
/// retorna `Err` a mitad del teardown no puede dejar la fase clavada en
/// Stopping (bloquearía todos los arranques futuros).
#[derive(Debug)]
pub struct StopGate {
    machine: &'static PhaseMachine,
}

impl StopGate {
    /// Sobre el singleton de producción. `Err(fase_observada)` si no había
    /// sesión activa — el caller trata el stop como idempotente.
    pub fn acquire() -> Result<Self, RecordingPhase> {
        Self::acquire_on(&RECORDING_PHASE)
    }

    /// Sobre una máquina concreta (tests).
    pub fn acquire_on(machine: &'static PhaseMachine) -> Result<Self, RecordingPhase> {
        match machine.try_transition(RecordingPhase::Recording, RecordingPhase::Stopping) {
            Ok(()) => Ok(Self { machine }),
            Err(RecordingPhase::Paused) => machine
                .try_transition(RecordingPhase::Paused, RecordingPhase::Stopping)
                .map(|_| Self { machine }),
            Err(observed) => Err(observed),
        }
    }
}

impl Drop for StopGate {
    fn drop(&mut self) {
        let _ = self
            .machine
            .try_transition(RecordingPhase::Stopping, RecordingPhase::Idle);
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Barrier;

    /// Los gates guardan `&'static PhaseMachine`; para instancias de test se
    /// obtiene un 'static real vía Box::leak (fuga mínima, solo en tests).
    fn leaked_machine() -> &'static PhaseMachine {
        Box::leak(Box::new(PhaseMachine::new()))
    }

    use RecordingPhase::*;

    #[test]
    fn fase_inicial_es_idle() {
        let m = PhaseMachine::new();
        assert_eq!(m.current(), Idle);
        assert!(!m.current().is_session_active());
    }

    #[test]
    fn happy_path_completo() {
        let m = PhaseMachine::new();
        assert!(m.try_transition(Idle, Starting).is_ok());
        assert!(!m.current().is_session_active(), "Starting no es sesión activa");
        assert!(m.try_transition(Starting, Recording).is_ok());
        assert!(m.current().is_session_active());
        assert!(m.try_transition(Recording, Paused).is_ok());
        assert!(m.current().is_session_active(), "Paused sigue siendo sesión activa");
        assert!(m.try_transition(Paused, Recording).is_ok());
        assert!(m.try_transition(Recording, Stopping).is_ok());
        assert!(
            !m.current().is_session_active(),
            "Stopping = early-false del stop"
        );
        assert!(m.try_transition(Stopping, Idle).is_ok());
        assert_eq!(m.current(), Idle);
    }

    #[test]
    fn stop_desde_pausa_es_valido() {
        let m = PhaseMachine::new();
        m.try_transition(Idle, Starting).unwrap();
        m.try_transition(Starting, Recording).unwrap();
        m.try_transition(Recording, Paused).unwrap();
        assert!(m.try_transition(Paused, Stopping).is_ok());
    }

    #[test]
    fn tabla_exhaustiva_de_transiciones() {
        let all = [Idle, Starting, Recording, Paused, Stopping];
        let valid = [
            (Idle, Starting),
            (Starting, Recording),
            (Starting, Idle),
            (Recording, Paused),
            (Paused, Recording),
            (Recording, Stopping),
            (Paused, Stopping),
            (Stopping, Idle),
        ];
        for from in all {
            for to in all {
                let expected = valid.contains(&(from, to));
                assert_eq!(
                    RecordingPhase::is_valid_transition(from, to),
                    expected,
                    "is_valid_transition({:?}, {:?}) debería ser {}",
                    from,
                    to,
                    expected
                );
            }
        }
    }

    #[test]
    fn transicion_con_fase_incorrecta_devuelve_fase_observada() {
        let m = PhaseMachine::new(); // Idle
        // Válida en la tabla pero la fase actual no es `from`:
        let err = m.try_transition(Recording, Paused).unwrap_err();
        assert_eq!(err, Idle);
        // Doble arranque: la segunda pierde y observa Starting.
        m.try_transition(Idle, Starting).unwrap();
        let err = m.try_transition(Idle, Starting).unwrap_err();
        assert_eq!(err, Starting);
    }

    #[test]
    fn start_gate_commit_y_drop() {
        let m = leaked_machine();
        // acquire deja Starting
        let gate = StartGate::acquire_on(m).unwrap();
        assert_eq!(m.current(), Starting);
        // commit deja Recording y el drop posterior NO revierte
        gate.commit().unwrap();
        assert_eq!(m.current(), Recording);
    }

    #[test]
    fn start_gate_drop_sin_commit_revierte_a_idle() {
        let m = leaked_machine();
        {
            let _gate = StartGate::acquire_on(m).unwrap();
            assert_eq!(m.current(), Starting);
            // se dropea sin commit (simula error en el arranque)
        }
        assert_eq!(m.current(), Idle);
    }

    #[test]
    fn start_gate_falla_si_no_esta_idle() {
        let m = leaked_machine();
        let gate = StartGate::acquire_on(m).unwrap();
        // Segundo acquire mientras Starting
        let err = StartGate::acquire_on(m).unwrap_err();
        assert!(err.contains("start already in progress"), "{err}");
        gate.commit().unwrap();
        // Acquire mientras Recording
        let err = StartGate::acquire_on(m).unwrap_err();
        assert_eq!(err, "Recording already in progress");
    }

    #[test]
    fn stop_gate_desde_recording_y_drop_a_idle() {
        let m = leaked_machine();
        StartGate::acquire_on(m).unwrap().commit().unwrap();
        {
            let _stop = StopGate::acquire_on(m).unwrap();
            assert_eq!(m.current(), Stopping);
        }
        assert_eq!(m.current(), Idle, "Drop del StopGate SIEMPRE termina en Idle");
    }

    #[test]
    fn stop_gate_desde_paused() {
        let m = leaked_machine();
        StartGate::acquire_on(m).unwrap().commit().unwrap();
        m.try_transition(Recording, Paused).unwrap();
        let _stop = StopGate::acquire_on(m).unwrap();
        assert_eq!(m.current(), Stopping);
    }

    #[test]
    fn stop_gate_falla_sin_sesion_activa() {
        let m = leaked_machine();
        assert_eq!(StopGate::acquire_on(m).unwrap_err(), Idle);
        let gate = StartGate::acquire_on(m).unwrap();
        assert_eq!(StopGate::acquire_on(m).unwrap_err(), Starting);
        drop(gate);
    }

    #[test]
    fn doble_stop_solo_uno_gana() {
        let m = leaked_machine();
        StartGate::acquire_on(m).unwrap().commit().unwrap();
        let first = StopGate::acquire_on(m);
        let second = StopGate::acquire_on(m);
        assert!(first.is_ok());
        assert_eq!(second.unwrap_err(), Stopping);
    }

    /// El escenario de los 5 arranques paralelos del 2 de julio, convertido en
    /// test: N threads sincronizados intentan arrancar a la vez → exactamente
    /// uno gana la CAS Idle→Starting.
    #[test]
    fn concurrente_solo_un_arranque_gana() {
        const THREADS: usize = 32;
        let m = leaked_machine();
        let barrier = Barrier::new(THREADS);
        let mut oks = 0usize;
        let mut errs = 0usize;

        std::thread::scope(|s| {
            let handles: Vec<_> = (0..THREADS)
                .map(|_| {
                    let barrier = &barrier;
                    s.spawn(move || {
                        barrier.wait();
                        match StartGate::acquire_on(m) {
                            Ok(g) => {
                                // Ganador: comitea para que su drop no revierta.
                                g.commit().unwrap();
                                true
                            }
                            Err(_) => false,
                        }
                    })
                })
                .collect();
            for h in handles {
                if h.join().unwrap() {
                    oks += 1;
                } else {
                    errs += 1;
                }
            }
        });

        assert_eq!(oks, 1, "exactamente un thread debe ganar Idle→Starting");
        assert_eq!(errs, THREADS - 1);
        assert_eq!(m.current(), Recording);
    }
}
