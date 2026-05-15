'use client';

import React, { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import {
  Sparkles, AlertTriangle, ChevronLeft, ChevronRight,
  ChevronDown, ChevronUp, X, Timer, ThumbsUp, ThumbsDown,
  Play, Square, Mic, Volume2,
} from 'lucide-react';
import { useCoachTips } from '@/hooks/useCoachTips';
import { useMeetingMetrics } from '@/hooks/useMeetingMetrics';
import { HealthGauge } from '@/components/coach/HealthGauge';
import { TalkSplitBar } from '@/components/coach/TalkSplitBar';
import { getPriorityColor, getCategoryMeta, PRIORITY_META } from '@/components/coach/tipMeta';
import { supabase } from '@/lib/supabase';
import { Analytics } from '@/lib/analytics';

interface AudioLevels {
  micRms: number;
  micPeak: number;
  sysRms: number;
  sysPeak: number;
}

type TipFeedback = 'like' | 'dislike' | null;

// AudioBars (3 barras) + MIC_SCALES/SYS_SCALES eliminados en iter 11. Solo
// se usaban en el expanded antiguo que reemplazamos por el drawer panel —
// el drawer usa AudioBars5 (5 barras) de la barra superior. Si en V12
// reintroducimos el dashboard completo, restaurar desde git history.

// 5-bar visualizer para la barra horizontal (iter 5/9/11).
// Iter 9: idle heights bajadas a [2,3,2,3,2] (casi planas) y multiplicador
// subido de 200 → 600 para que la habla normal (rms ~0.02) dé alturas
// visibles ~12 px. Antes el silencio se veía más alto que la habla — bug
// "barras al revés" del usuario.
const BARS5_IDLE_HEIGHTS = [2, 3, 2, 3, 2];
const BARS5_SCALES = [0.4, 0.8, 0.6, 1.0, 0.5];
function AudioBars5({ rms, color, active }: { rms: number; color: string; active: boolean }) {
  return (
    <div className="h-4 flex items-end gap-[2px]">
      {BARS5_SCALES.map((scale, i) => {
        const h = active
          ? Math.max(2, Math.min(16, rms * 600 * scale))
          : BARS5_IDLE_HEIGHTS[i];
        return (
          <div
            key={i}
            className="w-1 rounded-full transition-[height] duration-150"
            style={{ height: `${h}px`, backgroundColor: color }}
          />
        );
      })}
    </div>
  );
}

// Idle empty state del drawer (iter 13): cuando el user abre el drawer sin
// haber empezado a grabar (y sin tips de sesion previa), mostramos esta
// pantalla en lugar de HealthGauge+Timer+TalkSplit con valores stale. El
// gradient del icon ring replica el `linear-gradient(135deg, ${tipColor}1a ...)`
// del tip card para reforzar la coherencia visual del overlay.
function CoachFloatIdleEmptyState({
  onStart,
  busy,
  errorMsg,
}: {
  onStart: () => void;
  busy: boolean;
  errorMsg: string | null;
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-4 text-center">
      <div
        className="w-12 h-12 rounded-full flex items-center justify-center mb-4"
        style={{
          background: 'linear-gradient(135deg, rgba(99,102,241,0.25) 0%, rgba(236,72,153,0.15) 100%)',
          border: '1px solid rgba(99,102,241,0.3)',
        }}
      >
        <Sparkles className="w-6 h-6 text-indigo-300" />
      </div>
      <h2 className="text-sm font-semibold text-white mb-1.5">
        Listo para tu próxima sesión
      </h2>
      <p className="text-[11px] text-white/55 leading-snug mb-4 max-w-[240px]">
        Inicia una grabación para recibir coaching y métricas en tiempo real
      </p>
      <button
        onClick={onStart}
        disabled={busy}
        className="flex items-center gap-2 px-4 py-2 rounded-full bg-white hover:bg-indigo-500 text-black hover:text-white disabled:opacity-50 text-xs font-semibold transition-all shadow-lg shadow-white/10"
        aria-label="Iniciar grabación"
      >
        {busy ? (
          <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
        ) : (
          <Play className="w-3.5 h-3.5 fill-current" />
        )}
        Iniciar grabación
      </button>
      {errorMsg && (
        <p className="mt-3 text-[10px] text-red-400 max-w-[260px]" title={errorMsg}>
          {errorMsg}
        </p>
      )}
    </div>
  );
}

// healthColor() removido en iter 5 — el modo compact era el único que lo usaba
// para colorear el número de health (75 → verde). El nuevo compact no muestra
// health, así que la función quedó huérfana. Si el expanded layout llega a
// necesitarlo, restaurar y reusar; mientras tanto, lo dejamos fuera.

function formatDuration(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

// Glass style del coach-float — el fix del body transparent en layout.tsx
// deja que la ventana Tauri (transparent: true) muestre el blur del SO
// debajo de este div. Antes el body con `bg-background` (negro sólido)
// tapaba el efecto.
//
// Iter 11: eliminamos `GLASS_STYLE` original (era del expanded antiguo). El
// drawer panel ahora usa estilos inline propios. Solo queda GLASS_STYLE_COMPACT
// para la barra superior. Removemos también el `border` y boxShadow grueso —
// el boxShadow inset se aplica directamente en el JSX por barra/drawer.
const GLASS_STYLE_COMPACT: React.CSSProperties = {
  background: 'rgba(15, 16, 24, 0.85)',
  backdropFilter: 'blur(22px) saturate(180%)',
  WebkitBackdropFilter: 'blur(22px) saturate(180%)',
};

export default function CoachFloatPage() {
  const { tips } = useCoachTips(50);
  const { metrics, isWaitingForAudio } = useMeetingMetrics();
  // Iter 11: cambio de "compact vs expanded" a "drawer open vs closed".
  //
  // - drawerOpen=false → ventana 360×76 (solo barra horizontal).
  // - drawerOpen=true  → ventana 360×336 (barra + panel desplegado abajo).
  //
  // La barra superior es SIEMPRE constante (no se reemplaza por otro layout
  // al expandir). El drawer se despliega DEBAJO, manteniendo logo + barras +
  // botón Play/Stop arriba. Antes (iter 10) `compact: false` cambiaba el
  // layout completo a 320×540 con dashboard distinto — eso quedó out-of-scope
  // para V12 ("Vista completa").
  //
  // Default false: la app suele arrancar idle, drawer cerrado. Al
  // recording-start-complete se auto-abre (Fix F).
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [levels, setLevels] = useState({ micRms: 0, sysRms: 0 });
  // Feedback persistido por tip. Permite votar tips anteriores sin perder los
  // ratings ya dados. El tipKey es estable por (timestamp_secs, tip_type).
  const [feedbackByTip, setFeedbackByTip] = useState<Record<string, Exclude<TipFeedback, null>>>({});
  // tipIndex 0 = mas reciente. Reverse local del array de useCoachTips
  // (que llega cronologico, mas viejo primero).
  const [tipIndex, setTipIndex] = useState(0);
  const meetingIdRef = useRef<string | null>(null);
  // Timer local que tickea cada 1s para que el contador no salte de 3 en 3.
  // El backend emite meeting-metrics cada 3s; entre eventos extrapolamos via
  // Date.now() - lastMetricAt para evitar drift acumulado.
  const [displaySecs, setDisplaySecs] = useState(0);
  const lastMetricRef = useRef<{ secs: number; at: number } | null>(null);

  // ── Estado de grabación (independiente de los niveles de audio) ────────
  // `recordingActive` viene de invoke('is_recording') + listeners, no de
  // levels. Esto es necesario para los controles porque en silencio durante
  // grabación, `levels.micRms === 0` y no podríamos saber si estamos
  // grabando o no. El pause/resume se eliminó del flujo coach-float: el user
  // siempre puede detener desde el botón rojo de la barra superior.
  const [recordingActive, setRecordingActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const startTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Iter 9: la lista de devices la maneja la mini-ventana Tauri device-picker.
  // El coach-float solo guarda la selección actual (selectedMic/Sys) para
  // propagar al iniciar grabación.
  const [selectedMic, setSelectedMic] = useState<string | null>(null);
  const [selectedSys, setSelectedSys] = useState<string | null>(null);
  // Refs a los botones de mic/sis — necesarias para calcular posición global
  // al abrir el device-picker.
  const micButtonRef = useRef<HTMLButtonElement>(null);
  const sysButtonRef = useRef<HTMLButtonElement>(null);

  // Iter 11: si el usuario fuerza cerrar el drawer mientras graba, NO
  // re-abrirlo automáticamente al siguiente evento. Solo auto-abre una vez
  // por ciclo de grabación (transición idle → rec). Se resetea al stop.
  const userManuallyClosedDrawerRef = useRef(false);

  const reversedTips = [...tips].reverse();
  const totalTips = reversedTips.length;
  const tip = reversedTips[tipIndex] ?? null;
  const canPrev = tipIndex < totalTips - 1;
  const canNext = tipIndex > 0;
  const goPrev = () => canPrev && setTipIndex(i => i + 1);
  const goNext = () => canNext && setTipIndex(i => i - 1);
  const tipKey = tip ? `${tip.timestamp_secs}-${tip.tip_type ?? ''}` : null;
  const feedback: TipFeedback = tipKey ? feedbackByTip[tipKey] ?? null : null;

  // Cuando llega tip nuevo (totalTips cambia), saltar al mas reciente.
  // El feedback se persiste por tipKey, asi que NO se resetea aqui ni al
  // navegar — los ratings dados sobreviven.
  useEffect(() => {
    setTipIndex(0);
  }, [totalTips]);

  // Iter 9: ref para que el listener `recording-audio-levels` pueda leer el
  // valor actual de recordingActive sin re-suscribirse. El useEffect del
  // listener corre una sola vez con deps=[] así que sin ref captura el valor
  // inicial (false).
  const recordingActiveRef = useRef(false);
  useEffect(() => { recordingActiveRef.current = recordingActive; }, [recordingActive]);

  // Ref para que los listeners de stop puedan distinguir "cerrar drawer
  // estaba abierto" vs "ya estaba cerrado" — esto evita emitir el evento
  // `drawer_auto_closed` cuando el cierre es no-op (drawer ya estaba cerrado).
  const drawerOpenRef = useRef(false);
  useEffect(() => { drawerOpenRef.current = drawerOpen; }, [drawerOpen]);

  useEffect(() => {
    const subs = [
      // recording-audio-levels: solo aplicar cuando realmente estamos grabando.
      // Iter 9: en idle la pipeline puede emitir niveles spurious (warm-up)
      // que movían las barras de sistema sin razón. Gate explícito.
      listen<AudioLevels>('recording-audio-levels', (e) => {
        if (!recordingActiveRef.current) return; // ignorar en idle
        setLevels({ micRms: e.payload.micRms, sysRms: e.payload.sysRms });
      }),
      // audio-levels (preview del monitor independiente).
      // Iter 11: el monitor ahora trae ambos canales — input (mic via CPAL) y
      // output (sistema via WASAPI loopback / CoreAudio). Filtrar por
      // device_type para popular ambas barras correctamente. En Linux o
      // macOS sin permiso, outputLvl viene con rms_level=0 (graceful), así
      // que la barra verde queda plana sin lógica adicional.
      listen<{
        timestamp: number;
        levels: Array<{
          device_name: string;
          device_type: string; // 'input' | 'output'
          rms_level: number;
          peak_level: number;
          is_active: boolean;
        }>;
      }>('audio-levels', (e) => {
        const inputLvl = e.payload.levels.find(l => l.device_type === 'input');
        const outputLvl = e.payload.levels.find(l => l.device_type === 'output');
        setLevels({
          micRms: inputLvl?.rms_level ?? 0,
          sysRms: outputLvl?.rms_level ?? 0,
        });
      }),
      listen<string>('early-meeting-id', (e) => {
        meetingIdRef.current = e.payload;
      }),
      // Iter 9: el device-picker (mini-ventana) emite este evento al click
      // en un device. Aplicamos la selección + hot-swap si grabando.
      listen<{ deviceName: string; deviceType: 'Microphone' | 'SystemAudio' }>(
        'device-picker-selected',
        (e) => {
          applyPickedDevice(e.payload.deviceName, e.payload.deviceType);
        },
      ),
      // Cuando llega start/stop-complete sincronizamos recordingActive de
      // inmediato sin esperar al polling de 2s. Ya NO cerramos la ventana al
      // terminar grabación — ahora el coach-float es la UI permanente y
      // simplemente vuelve a modo compact (idle) cuando se detiene.
      listen('recording-start-complete', () => {
        setRecordingActive(true);
        setBusy(false);
        setErrorMsg(null);
        if (startTimeoutRef.current) {
          clearTimeout(startTimeoutRef.current);
          startTimeoutRef.current = null;
        }
        // Iter 11: auto-abrir drawer al empezar grabación. Skip si el user
        // lo cerró manualmente durante un cycle previo (ref guard).
        if (!userManuallyClosedDrawerRef.current) {
          setDrawerOpen(true);
          invoke('coach_float_set_size', { drawer: true }).catch(console.error);
          // Telemetría: distinguir apertura automática de la manual permite
          // medir engagement real con el coach sin contaminar con auto-toggles.
          Analytics.track('coach_float.drawer_auto_opened', {
            reason: 'auto_on_start',
          }).catch(() => {});
        }
      }),
      listen('recording-stop-complete', () => {
        setRecordingActive(false);
        setBusy(false);
        // Iter 11: cerrar drawer al detener + resetear guard para el próximo cycle.
        const wasDrawerOpen = drawerOpenRef.current;
        setDrawerOpen(false);
        invoke('coach_float_set_size', { drawer: false }).catch(console.error);
        userManuallyClosedDrawerRef.current = false;
        if (wasDrawerOpen) {
          Analytics.track('coach_float.drawer_auto_closed', {
            reason: 'auto_on_stop',
          }).catch(() => {});
        }
      }),
      listen('recording-stopped', () => {
        setRecordingActive(false);
        setBusy(false);
        const wasDrawerOpen = drawerOpenRef.current;
        setDrawerOpen(false);
        invoke('coach_float_set_size', { drawer: false }).catch(console.error);
        userManuallyClosedDrawerRef.current = false;
        if (wasDrawerOpen) {
          Analytics.track('coach_float.drawer_auto_closed', {
            reason: 'auto_on_stop',
          }).catch(() => {});
        }
      }),
    ];
    return () => { subs.forEach(p => p.then(fn => fn())); };
  }, []);

  // Iter 9: la lista de dispositivos la carga la mini-ventana device-picker
  // cada vez que se abre. El coach-float ya no mantiene la lista localmente.

  // Iter 10: el coach-float YA NO arranca el monitor de niveles. Era el
  // origen de la regresión "barras de home no se mueven" — el ciclo
  // start/stop según `selectedMic` interfería con `usePreviewLevels` de la
  // home aunque hubiera refcount.
  //
  // Patrón actual: la home (RecordingControls vía usePreviewLevels) es el
  // ÚNICO consumidor que arranca/detiene el monitor. El coach-float es
  // consumidor PASIVO — solo escucha el evento `audio-levels` broadcast.
  // Si la home no monta el preview (porque está grabando), el coach-float
  // recibe `recording-audio-levels` directamente desde la pipeline real.

  // Polling de defensa: sincroniza recordingActive con el backend cada 2s.
  // Cubre casos donde un evento se pierde (window restored from minimize
  // mid-evento) o el usuario arranca desde el tray sin que llegue el
  // recording-start-complete.
  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      try {
        const rec = await invoke<boolean>('is_recording');
        if (!cancelled) setRecordingActive(rec);
      } catch {
        /* ignore */
      }
    };
    sync();
    const id = setInterval(sync, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Sync del timer cuando llega un metric nuevo del backend (cada 3s).
  // Cuando metrics === null (recording stop), reset a 0.
  useEffect(() => {
    if (metrics === null) {
      lastMetricRef.current = null;
      setDisplaySecs(0);
      return;
    }
    lastMetricRef.current = { secs: metrics.sessionSecs, at: Date.now() };
    setDisplaySecs(metrics.sessionSecs);
  }, [metrics]);

  // Tick local cada 1s entre eventos del backend. Recalcula desde el ultimo
  // anchor (no acumula drift). Solo activo cuando hay metrics (grabacion).
  const isActive = metrics !== null;
  useEffect(() => {
    if (!isActive) return;
    const id = setInterval(() => {
      if (!lastMetricRef.current) return;
      const elapsed = Math.floor((Date.now() - lastMetricRef.current.at) / 1000);
      setDisplaySecs(lastMetricRef.current.secs + elapsed);
    }, 1000);
    return () => clearInterval(id);
  }, [isActive]);

  const sessionTime = formatDuration(displaySecs);
  const health = metrics?.health ?? 70;
  const userPct = metrics?.userTalkPct ?? 50;
  const interlocutorPct = metrics?.interlocutorTalkPct ?? 50;

  // Iter 11: toggle del drawer (panel desplegable hacia abajo). Reemplaza el
  // viejo toggleCompact que cambiaba entre dos layouts mutuamente exclusivos.
  // Ahora la barra superior es constante y el drawer aparece debajo cuando
  // está abierto. Si el user lo cierra durante grabación, marcamos el ref
  // para no re-abrirlo automáticamente al siguiente recording-start-complete.
  const toggleDrawer = () => {
    const next = !drawerOpen;
    setDrawerOpen(next);
    if (recordingActive && !next) {
      // User cerró manualmente durante grabación → guard contra auto-reapertura.
      userManuallyClosedDrawerRef.current = true;
    }
    invoke('coach_float_set_size', { drawer: next }).catch(console.error);
    // Telemetría: separar acciones del user (reason: 'user') de los toggles
    // automáticos (auto_on_start / auto_on_stop) permite filtrar engagement real.
    Analytics.track('coach_float.drawer_toggled', {
      open: next.toString(),
      reason: 'user',
      recording_active: recordingActive.toString(),
    }).catch(() => {});
  };

  const close = () => {
    Analytics.track('coach_float.window_closed', {
      reason: 'user_x_button',
      recording_active: recordingActive.toString(),
      drawer_was_open: drawerOpen.toString(),
    }).catch(() => {});
    invoke('close_floating_coach').catch(console.error);
  };

  // Iter 11: el ciclo de vida del drawer (auto-abrir on rec-start, cerrar on
  // rec-stop) vive en los listeners de eventos arriba. La barra superior es
  // siempre constante con todas las controls inline (Play/Stop/Mic/Sys/Timer).
  // El drawer es opt-in cuando el user quiere ver coaching (Tips, Health, etc).

  // Handler para "Iniciar grabación" (footer idle). Delega al main window
  // vía evento para reusar useRecordingStart (validación de proveedor,
  // setea contextos React, etc.) — el bypass directo al comando Rust falla
  // si Deepgram no tiene proxy config cacheado, como pasaba en iter 2.
  const handleStart = async () => {
    if (busy || recordingActive) return;
    setErrorMsg(null);
    setBusy(true);
    try {
      // Iter 6: si el usuario eligió dispositivos en el coach-float, los
      // propagamos al main window vía el comando _with_devices. El listener
      // global en RecordingWidgetListener aplica el ConfigContext antes de
      // disparar handleRecordingStart. Si selectedMic/Sys son null, el
      // listener mantiene los devices actuales del context.
      if (selectedMic || selectedSys) {
        await invoke('coach_float_request_start_with_devices', {
          micDevice: selectedMic,
          sysDevice: selectedSys,
        });
      } else {
        await invoke('coach_float_request_start');
      }
      // Si no llega `recording-start-complete` en 5s, asumimos fallo
      // silencioso (típicamente validación de proveedor) y mostramos error.
      if (startTimeoutRef.current) clearTimeout(startTimeoutRef.current);
      startTimeoutRef.current = setTimeout(() => {
        setBusy(false);
        setErrorMsg('No se pudo iniciar. Revisa la configuración en la app.');
        startTimeoutRef.current = null;
      }, 5000);
    } catch (err) {
      console.error('coach-float: start failed', err);
      setBusy(false);
      setErrorMsg(typeof err === 'string' ? err : 'Error al iniciar grabación');
    }
  };

  const handleStop = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // Wrapper Rust que genera save_path internamente (frontend no necesita
      // app_data_dir). Mismo patrón que el handler del tray.
      await invoke('coach_float_stop_recording');
    } catch (err) {
      console.error('coach-float: stop failed', err);
    } finally {
      setBusy(false);
    }
  };

  // Wrapper para diferenciar (en telemetria) clicks en el CTA del idle drawer
  // vs el Play icon de la barra superior. Asi podemos medir cual convierte mas.
  const handleStartFromCta = () => {
    Analytics.track('coach_float.idle_cta_clicked', {
      source: 'idle_drawer_cta',
    }).catch(() => {});
    handleStart();
  };

  // Iter 9: handler para selección de dispositivo desde la mini-ventana
  // device-picker (que emite el evento global `device-picker-selected`).
  // - Idle: solo guarda la elección. Se aplica al próximo start_recording.
  // - Grabando: además invoca `switch_audio_device` para hot-swap.
  //
  // El backend `switch_audio_device` espera 'Microphone' o 'SystemAudio'.
  const applyPickedDevice = async (
    deviceName: string,
    backendType: 'Microphone' | 'SystemAudio',
  ) => {
    if (backendType === 'Microphone') setSelectedMic(deviceName);
    else setSelectedSys(deviceName);
    if (recordingActiveRef.current) {
      try {
        await invoke('switch_audio_device', {
          deviceName,
          deviceType: backendType,
        });
      } catch (err) {
        console.error('coach-float: switch_audio_device failed', err);
      }
    }
  };

  // Handler para abrir la mini-ventana device-picker. Calcula coordenadas
  // globales del icono (suma posición de la ventana coach-float + offset del
  // icono dentro del webview) y las pasa al comando Rust.
  const handleOpenDevicePicker = async (type: 'mic' | 'sys') => {
    const btnRef = type === 'mic' ? micButtonRef : sysButtonRef;
    const btn = btnRef.current;
    if (!btn) return;
    try {
      const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      const win = getCurrentWebviewWindow();
      const [outerPos, scaleFactor] = await Promise.all([
        win.outerPosition(),
        win.scaleFactor(),
      ]);
      const rect = btn.getBoundingClientRect();
      // outerPosition retorna pixels físicos; rect retorna pixels lógicos del webview.
      // Convertimos todo a lógicos para el comando Rust que espera lógicos.
      const anchorX = outerPos.x / scaleFactor + rect.left;
      const anchorY = outerPos.y / scaleFactor + rect.top;
      await invoke('open_device_picker', {
        deviceType: type,
        anchorX,
        anchorY,
        width: 240,
      });
    } catch (err) {
      console.error('coach-float: open_device_picker failed', err);
    }
  };

  // Drag fallback programatico para Windows con decorations:false + transparent:true.
  // Ignora botones y elementos interactivos para no atrapar clicks.
  const handleDragMouseDown = async (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, a, input, textarea, select, [role="button"]')) return;
    try {
      const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      await getCurrentWebviewWindow().startDragging();
    } catch (err) {
      console.warn('startDragging failed', err);
    }
  };

  const sendFeedback = async (rating: 'like' | 'dislike') => {
    // Permitir feedback en cualquier tip, no solo el mas reciente. El gate
    // ahora es solo "ya votado" — un tip con rating registrado queda fijo.
    if (!tip || !tipKey || feedback !== null) return;
    setFeedbackByTip(prev => ({ ...prev, [tipKey]: rating }));
    try {
      // 1. Persistencia local (autoritativa). El UUID retornado se reusa como
      // p_id en la RPC para que la fila cloud comparta PK con la local — un
      // retry idempotente colapsa via UNIQUE.
      const feedbackId = await invoke<string>('save_user_feedback', {
        meetingId: meetingIdRef.current ?? undefined,
        feedbackType: 'coach_tip_feedback',
        rating,
        message: undefined,
        metadata: JSON.stringify({
          tip_key: tipKey,
          tip_text: tip.tip,
          tip_category: tip.category,
          tip_priority: tip.priority,
          tip_type: tip.tip_type,
          tip_timestamp_secs: tip.timestamp_secs,
        }),
      });

      // 2. Sync a Supabase via RPC (fire-and-forget, mismo patrón que
      // SessionFeedbackModal → insert_user_feedback). La RPC es SECURITY
      // DEFINER y resuelve user_id/auth_id desde auth.uid() server-side;
      // el cliente solo manda datos de negocio.
      supabase
        .rpc('insert_user_feedback', {
          p_feedback_type: 'coach_tip_feedback',
          p_message: tip.tip,
          p_id: feedbackId,
          p_metadata: {
            platform: 'desktop',
            rating,
            meeting_id: meetingIdRef.current ?? null,
            tip_category: tip.category,
            tip_priority: tip.priority,
            tip_type: tip.tip_type,
            tip_timestamp_secs: tip.timestamp_secs,
            tip_key: tipKey,
          },
        })
        .then(({ error }) => {
          if (error) console.warn('[CoachFloat] Supabase sync failed (non-fatal):', error);
        });
    } catch (e) {
      console.error('[CoachFloat] feedback save failed:', e);
      // Revertir el optimistic update para que el usuario pueda reintentar
      setFeedbackByTip(prev => {
        const next = { ...prev };
        delete next[tipKey];
        return next;
      });
    }
  };

  const prioMeta = tip?.priority ? PRIORITY_META[tip.priority] : null;
  const tipColor = tip ? getPriorityColor(tip.priority) : '#a8b3ff';
  const catMeta = tip?.category ? getCategoryMeta(tip.category) : null;

  // ── Barra transport (siempre visible) + Drawer panel opcional ─────────
  // Layout en una sola fila: logo Maity | mic + 5 barras | sis + 5 barras |
  // (timer si graba) | botón Play/Stop icon-only | drawer toggle + close.
  // Dimensiones 360×76. El drawer suma 260 px adicionales cuando se abre.
  const hasLiveAudio = levels.micRms > 0.005 || levels.sysRms > 0.005;
  const barsActive = recordingActive || hasLiveAudio;
  // Iter 11: layout único — barra horizontal SIEMPRE visible (76 px) + drawer
  // panel opcional debajo (260 px). Antes había dos returns separados (compact
  // vs expanded) que producían layouts mutuamente exclusivos. Ahora la barra
  // superior es ancla constante; el drawer se despliega hacia abajo al grabar
  // (auto) o al click en ChevronDown (manual).
  //
  // clipPath dinámico evita "costura" visible en la unión barra↔drawer cuando
  // está abierto: barra redondea solo arriba, drawer redondea solo abajo.
  const barClipPath = drawerOpen
    ? 'inset(0 round 24px 24px 0 0)'
    : 'inset(0 round 24px)';

  return (
    <div className="h-screen w-screen flex flex-col select-none">
      {/* Barra constante 76px — logo · mic · sis · timer · play/stop · controls */}
      <div
        onMouseDown={handleDragMouseDown}
        className="h-[76px] w-full flex items-center gap-2 px-2.5 relative shrink-0"
        style={{
          ...GLASS_STYLE_COMPACT,
          clipPath: barClipPath,
          // Iter 11: boxShadow CSS interior — antes 0 8px 32px (alto rango)
          // proyectaba sombra rectangular fuera del rounded del WebView2. Con
          // -4px de spread negativo, la sombra se mantiene dentro de los
          // contornos redondeados del card.
          boxShadow: '0 8px 24px -4px rgba(0,0,0,0.65)',
        }}
        data-tauri-drag-region
      >
        {/* 1. Logo Maity + dot rec — iter 12: ahora es <button> que abre el
            drawer. Antes era un <div pointer-events-none> que solo era visual.
            El hover:scale-105 da feedback de clickeable sin agregar bg.
            El <img> mantiene pointer-events-none para que el hit-test caiga
            sobre el button parent (un solo elemento clickeable). */}
        <button
          onClick={toggleDrawer}
          className="relative shrink-0 w-7 h-7 rounded-md transition-transform hover:scale-105 active:scale-95 outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          title={drawerOpen ? 'Cerrar panel' : 'Ver panel de coaching'}
          aria-label={drawerOpen ? 'Cerrar panel' : 'Abrir panel'}
        >
          <img
            src="/logo-collapsed.png"
            alt="Maity"
            className="w-7 h-7 rounded-md select-none pointer-events-none"
            draggable={false}
          />
          {recordingActive && (
            <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5 pointer-events-none">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
            </span>
          )}
        </button>

        {/* Sección Mic: icono circular clickeable + barras de audio */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            ref={micButtonRef}
            onClick={() => handleOpenDevicePicker('mic')}
            className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center relative transition-colors"
            title={selectedMic ?? 'Cambiar micrófono'}
            aria-label="Seleccionar micrófono"
          >
            <Mic className={`w-4 h-4 transition-colors ${recordingActive ? 'text-red-400' : 'text-white/70'}`} />
          </button>
          <AudioBars5
            rms={levels.micRms}
            active={barsActive}
            color={recordingActive ? '#f87171' : 'rgba(72,93,244,0.7)'}
          />
        </div>

        {/* Sección Sistema: icono circular + barras */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            ref={sysButtonRef}
            onClick={() => handleOpenDevicePicker('sys')}
            className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center transition-colors"
            title={selectedSys ?? 'Cambiar audio del sistema'}
            aria-label="Seleccionar audio del sistema"
          >
            <Volume2 className="w-4 h-4 text-white/70" />
          </button>
          <AudioBars5
            rms={levels.sysRms}
            active={barsActive}
            color={recordingActive ? 'rgb(16,185,129)' : 'rgba(16,185,129,0.7)'}
          />
        </div>

        {/* Spacer + timer + Play/Stop + Chevron grande — todos en la fila
            principal (iter 12). Antes el Chevron vivía en `absolute top-1.5
            right-2` y se encimaba con el rojo del Stop. Moverlo aquí elimina
            el conflicto y le da al usuario el "icono grande a la derecha del
            grabar/detener" que pidió. */}
        <div className="ml-auto flex items-center gap-1.5 pr-5">
          {/* Reloj inline removido (iter 13): consumía espacio visual al lado
              del logo y duplicaba la info del drawer. El timer sigue visible
              en el drawer expandido cuando el user lo abre. */}

          {/* Play/Stop icon-only (h-9 w-9 circular).
              Idle = Play blanco hover indigo. Recording = Square rojo. */}
          <button
            onClick={recordingActive ? handleStop : handleStart}
            disabled={busy}
            className={
              recordingActive
                ? 'h-9 w-9 rounded-full bg-red-500 hover:bg-red-400 text-white disabled:opacity-50 flex items-center justify-center transition-all shadow-lg shadow-red-500/30'
                : 'h-9 w-9 rounded-full bg-white hover:bg-indigo-500 text-black hover:text-white disabled:opacity-50 flex items-center justify-center transition-all'
            }
            title={recordingActive ? 'Detener grabación' : 'Iniciar grabación'}
            aria-label={recordingActive ? 'Detener' : 'Grabar'}
          >
            {busy ? (
              <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
            ) : recordingActive ? (
              <Square className="w-3.5 h-3.5 fill-current" />
            ) : (
              <Play className="w-4 h-4 fill-current ml-0.5" />
            )}
          </button>

          {/* Iter 12: Chevron grande inline — abre/cierra drawer.
              Tamaño h-9 w-9 igual que Play/Stop. Color neutro (bg blanco/8) para
              que no compita visualmente con el botón rojo de grabación. */}
          <button
            onClick={toggleDrawer}
            className="h-9 w-9 rounded-full bg-white/[0.08] hover:bg-white/15 border border-white/10 text-white/75 hover:text-white flex items-center justify-center transition-all"
            title={drawerOpen ? 'Cerrar panel' : 'Ver panel completo'}
            aria-label={drawerOpen ? 'Cerrar panel' : 'Abrir panel'}
          >
            {drawerOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>

        {/* X de cerrar app — aislada en la esquina superior derecha.
            Iter 12: chiquita (w-3 h-3) y con padding mínimo para que no
            compita con el chevron grande. Antes estaba en un contenedor
            junto al chevron, ambos absolute, y se encimaban con el Play/Stop. */}
        <button
          onClick={close}
          className="absolute top-1.5 right-2 p-1 hover:bg-red-500/30 rounded text-white/40 hover:text-red-300 transition-colors"
          title="Cerrar"
          aria-label="Cerrar"
        >
          <X className="w-3 h-3" />
        </button>

        {/* Error inline (overlay debajo del modal, fuera del flow horizontal) */}
        {errorMsg && (
          <div
            className="absolute -bottom-5 left-3 right-3 text-[9px] text-red-400 truncate"
            title={errorMsg}
          >
            {errorMsg}
          </div>
        )}
      </div>

      {/* Drawer panel — solo cuando drawerOpen=true. Sumando 260 px (76+260=336).
          Contenido: HealthGauge + Tiempo + TalkSplit + tip card (solo si recording).
          Los handlers de Stop viven en la barra superior. Pause/Resume eliminado
          en iter 13. */}
      {drawerOpen && (
        <div
          className="flex-1 w-full overflow-hidden flex flex-col text-white"
          style={{
            background: 'rgba(15,16,24,0.92)',
            backdropFilter: 'blur(22px) saturate(180%)',
            WebkitBackdropFilter: 'blur(22px) saturate(180%)',
            clipPath: 'inset(0 round 0 0 24px 24px)',
            borderTop: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          {(recordingActive || totalTips > 0) ? (
          <>
          {/* HealthGauge + Tiempo card */}
          <div className="px-3 py-2 shrink-0 flex items-center gap-3">
            <HealthGauge value={health} />
            <div className="flex-1 min-w-0">
              <div className="flex flex-col rounded-lg bg-white/5 border border-white/10 p-2">
                <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-white/55">
                  <Timer className="w-2.5 h-2.5" />
                  <span>Tiempo</span>
                </div>
                <div className="text-base font-bold mt-0.5 tabular-nums text-[#a8b3ff]">
                  {sessionTime}
                </div>
              </div>
            </div>
          </div>

          {/* TalkSplit */}
          <div className="px-3 pb-2 shrink-0">
            <div className="flex items-center justify-between text-[9px] uppercase tracking-wider text-white/55 mb-1">
              <span>Tiempo de palabra</span>
            </div>
            <TalkSplitBar
              userPct={userPct}
              interlocutorPct={interlocutorPct}
              empty={isWaitingForAudio}
            />
          </div>

          {/* Tip card + nav + feedback. El gate condicional se movio al outer
              ternary del drawer (idle empty state vs full content), asi que
              cuando llegamos aqui ya sabemos que recordingActive || totalTips>0. */}
          <div className="flex-1 flex flex-col px-3 pb-2 gap-2 min-h-0 overflow-hidden">
            <div
              className="flex-1 rounded-lg border p-2.5 flex flex-col min-h-0 overflow-hidden"
              style={{
                background: tip
                  ? `linear-gradient(135deg, ${tipColor}1a 0%, rgba(255,255,255,0.04) 100%)`
                  : 'rgba(255,255,255,0.04)',
                borderColor: tip ? `${tipColor}55` : 'rgba(255,255,255,0.08)',
                transition: 'border-color 0.3s ease, background 0.3s ease',
              }}
            >
              <div className="flex items-center justify-between mb-1.5 shrink-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  {tip ? (
                    <>
                      {tip.priority === 'critical' ? (
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" style={{ color: tipColor }} />
                      ) : (
                        <Sparkles className="w-3.5 h-3.5 shrink-0" style={{ color: tipColor }} />
                      )}
                      <span
                        className="text-[10px] font-bold uppercase tracking-wider truncate"
                        style={{ color: tipColor }}
                      >
                        {prioMeta?.label ?? 'Sugerencia'}
                      </span>
                      {catMeta && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/10 text-white/70 font-semibold truncate">
                          {catMeta.label}
                        </span>
                      )}
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5 text-white/50" />
                      <span className="text-[10px] font-bold uppercase tracking-wider text-white/50">
                        Esperando
                      </span>
                    </>
                  )}
                </div>
                {totalTips > 1 && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={goPrev}
                      disabled={!canPrev}
                      className="w-6 h-6 flex items-center justify-center rounded-md bg-white/10 hover:bg-white/20 disabled:opacity-25 disabled:cursor-not-allowed text-white transition"
                      title="Tip anterior"
                      aria-label="Tip anterior"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>
                    <span className="text-[10px] tabular-nums text-white/80 px-1 font-semibold">
                      {tipIndex + 1}/{totalTips}
                    </span>
                    <button
                      onClick={goNext}
                      disabled={!canNext}
                      className="w-6 h-6 flex items-center justify-center rounded-md bg-white/10 hover:bg-white/20 disabled:opacity-25 disabled:cursor-not-allowed text-white transition"
                      title="Tip siguiente"
                      aria-label="Tip siguiente"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>

              <div className="text-xs text-white/95 leading-snug overflow-y-auto custom-scrollbar flex-1 font-medium">
                {tip?.tip ?? (
                  <div className="text-white/55 text-[11px] italic">
                    Escuchando...
                  </div>
                )}
              </div>
            </div>

            {/* Feedback Like/Dislike (solo cuando hay tip). El botón Pause se
                removió en iter 13: el flujo coach-float ya no expone pausa —
                solo Iniciar/Detener desde la barra superior. */}
            {tip && (
              <div className="flex items-center gap-1.5 shrink-0">
                {(['like', 'dislike'] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => sendFeedback(r)}
                    disabled={feedback !== null}
                    className={[
                      'flex items-center gap-1 px-2 py-1 rounded-md text-[10px] border transition-all',
                      feedback === r
                        ? r === 'like'
                          ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-400'
                          : 'border-red-500/50 bg-red-500/15 text-red-400'
                        : feedback !== null
                        ? 'border-white/5 text-zinc-700 cursor-not-allowed'
                        : r === 'like'
                        ? 'border-white/10 text-zinc-400 hover:border-emerald-500/40 hover:text-emerald-400'
                        : 'border-white/10 text-zinc-400 hover:border-red-500/40 hover:text-red-400',
                    ].join(' ')}
                  >
                    {r === 'like' ? <ThumbsUp className="w-3 h-3" /> : <ThumbsDown className="w-3 h-3" />}
                    {r === 'like' ? 'Útil' : 'No útil'}
                  </button>
                ))}
              </div>
            )}
          </div>
          </>
          ) : (
            <CoachFloatIdleEmptyState
              onStart={handleStartFromCta}
              busy={busy}
              errorMsg={errorMsg}
            />
          )}
        </div>
      )}
    </div>
  );
}
