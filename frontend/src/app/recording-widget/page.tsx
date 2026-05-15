'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import {
  ChevronDown, ChevronUp, X, Play, Pause, Square, Mic, Volume2,
} from 'lucide-react';

interface AudioLevels {
  micRms: number;
  micPeak: number;
  sysRms: number;
  sysPeak: number;
}

// Patrón glass copiado de coach-float — el body con bg-transparent del
// recording-widget layout deja pasar el blur Tauri detrás de esto.
const GLASS_STYLE: React.CSSProperties = {
  background: 'rgba(15, 16, 24, 0.92)',
  backdropFilter: 'blur(22px) saturate(180%)',
  WebkitBackdropFilter: 'blur(22px) saturate(180%)',
  border: '1px solid rgba(255,255,255,0.14)',
  boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
};

// Barras pequeñas para el panel idle (poca info visual).
const MIC_SCALES_SMALL = [0.7, 1.0, 0.85, 0.6];
const SYS_SCALES_SMALL = [0.6, 0.85, 1.0, 0.7];
// Barras grandes para el panel grabando (8 barras, look coach-float).
const MIC_SCALES_LARGE = [0.45, 0.7, 0.9, 1.0, 0.95, 0.8, 0.65, 0.5];
const SYS_SCALES_LARGE = [0.5, 0.65, 0.8, 0.95, 1.0, 0.9, 0.7, 0.45];

function AudioBars({
  rms,
  scales,
  color,
  maxH = 16,
  barW = 3,
}: {
  rms: number;
  scales: number[];
  color: string;
  maxH?: number;
  barW?: number;
}) {
  return (
    <div className="flex items-end gap-[2px]" style={{ height: `${maxH}px` }}>
      {scales.map((scale, i) => {
        const h = Math.max(2, Math.min(maxH, rms * 200 * scale));
        return (
          <div
            key={i}
            className="rounded-full transition-all duration-75"
            style={{
              width: `${barW}px`,
              height: `${h}px`,
              backgroundColor: color,
            }}
          />
        );
      })}
    </div>
  );
}

function formatDuration(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export default function RecordingWidgetPage() {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [levels, setLevels] = useState({ micRms: 0, sysRms: 0 });
  const [displaySecs, setDisplaySecs] = useState(0);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Anchor para timer local. Lo refrescamos al detectar transiciones idle→rec.
  const recordingStartRef = useRef<number | null>(null);
  // Si el usuario colapsa manualmente durante una grabación, NO re-expandir
  // automáticamente con el polling. Sólo auto-expand una vez en la transición.
  const userManuallyCollapsedRef = useRef(false);
  // Timer que descarta el spinner si la grabación no arranca en 5s.
  const startTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Polling fallback: el widget no tiene acceso al RecordingStateContext de la
  // main window, así que sincroniza estado vía invoke periódico cada 2s. Esto
  // cubre escenarios donde el usuario arranca grabación desde la main window
  // o el tray y el widget no recibe un evento (defensa en profundidad sobre
  // los listeners de abajo).
  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      try {
        const [rec, paused] = await Promise.all([
          invoke<boolean>('is_recording'),
          invoke<boolean>('is_recording_paused'),
        ]);
        if (cancelled) return;
        setIsRecording(rec);
        setIsPaused(paused);
        if (rec && recordingStartRef.current === null) {
          // Detectamos grabación ya en curso al abrir el widget — no podemos
          // saber el tiempo exacto sin invocar get_recording_state, así que
          // intentamos leerlo.
          try {
            const state = await invoke<{ active_duration?: number | null }>(
              'get_recording_state',
            );
            const active = state?.active_duration ?? 0;
            recordingStartRef.current = Date.now() - Math.floor(active * 1000);
            setDisplaySecs(Math.floor(active));
          } catch {
            recordingStartRef.current = Date.now();
            setDisplaySecs(0);
          }
        }
        if (!rec) {
          recordingStartRef.current = null;
          setDisplaySecs(0);
          // Resetear el flag al volver a idle: la próxima vez que arranque
          // grabación SI debe auto-expandirse.
          userManuallyCollapsedRef.current = false;
        }
      } catch {
        // best-effort, ignorar
      }
    };
    sync();
    const id = setInterval(sync, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Listeners de eventos para reacciones instantáneas (start/stop sin esperar
  // al polling de 2s). Patrón: el evento es la señal rápida, el polling cura
  // desalineamientos.
  useEffect(() => {
    const subs = [
      listen<AudioLevels>('recording-audio-levels', (e) => {
        setLevels({ micRms: e.payload.micRms, sysRms: e.payload.sysRms });
      }),
      listen('recording-start-complete', () => {
        setIsRecording(true);
        setIsPaused(false);
        recordingStartRef.current = Date.now();
        setDisplaySecs(0);
        setBusy(false);
        setErrorMsg(null);
        if (startTimeoutRef.current) {
          clearTimeout(startTimeoutRef.current);
          startTimeoutRef.current = null;
        }
      }),
      listen('recording-stop-complete', () => {
        setIsRecording(false);
        setIsPaused(false);
        recordingStartRef.current = null;
        setDisplaySecs(0);
        setLevels({ micRms: 0, sysRms: 0 });
        setBusy(false);
        userManuallyCollapsedRef.current = false;
      }),
      listen('recording-stopped', () => {
        setIsRecording(false);
        setIsPaused(false);
        recordingStartRef.current = null;
        setDisplaySecs(0);
        setLevels({ micRms: 0, sysRms: 0 });
        setBusy(false);
        userManuallyCollapsedRef.current = false;
      }),
    ];
    return () => { subs.forEach(p => p.then(fn => fn())); };
  }, []);

  // Timer local cada 1s. Recalcula desde el anchor en lugar de incrementar
  // (evita drift acumulado cuando setInterval se atrasa por throttling del
  // webview oculto). Pausa al pausar la grabación.
  useEffect(() => {
    if (!isRecording || isPaused) return;
    const id = setInterval(() => {
      if (recordingStartRef.current === null) return;
      const elapsed = Math.floor((Date.now() - recordingStartRef.current) / 1000);
      setDisplaySecs(elapsed);
    }, 1000);
    return () => clearInterval(id);
  }, [isRecording, isPaused]);

  // Auto-expand al detectar transición idle→grabando, SOLO si el usuario no
  // colapsó manualmente. Sin esto, el widget queda chiquito durante la
  // sesión y los niveles no se aprecian.
  useEffect(() => {
    if (isRecording && !isExpanded && !userManuallyCollapsedRef.current) {
      setIsExpanded(true);
      invoke('recording_widget_set_size', { expanded: true }).catch((e) => {
        console.warn('auto-expand failed', e);
      });
    }
    // No incluir isExpanded como dependencia — sólo queremos disparar al
    // momento exacto en que isRecording cambia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRecording]);

  // Drag fallback programático para Windows con decorations:false + transparent:true.
  // Copiado literal de coach-float/page.tsx. Ignora botones para no atrapar clicks.
  const handleDragMouseDown = useCallback(async (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, a, input, textarea, select, [role="button"]')) return;
    try {
      const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      await getCurrentWebviewWindow().startDragging();
    } catch (err) {
      console.warn('startDragging failed', err);
    }
  }, []);

  const toggleExpand = useCallback(async () => {
    const next = !isExpanded;
    setIsExpanded(next);
    // Si el usuario colapsa MIENTRAS GRABA, marcamos que fue manual para que
    // el auto-expand no lo re-expanda inmediatamente.
    if (!next && isRecording) {
      userManuallyCollapsedRef.current = true;
    }
    try {
      await invoke('recording_widget_set_size', { expanded: next });
    } catch (err) {
      console.warn('recording_widget_set_size failed', err);
    }
  }, [isExpanded, isRecording]);

  const closeWidget = useCallback(async () => {
    try {
      // X solo cierra la ventana actual SIN persistir false. Semánticamente
      // significa "ocultar ahora", no "no abrir nunca más".
      await invoke('close_recording_widget');
    } catch (err) {
      console.warn('close widget failed', err);
    }
  }, []);

  const handleStart = useCallback(async () => {
    if (busy) return;
    setErrorMsg(null);
    setBusy(true);
    try {
      // Delegamos al main window vía evento: useRecordingStart valida
      // Deepgram proxy, Parakeet ready, setea contextos React, etc. El widget
      // no puede hacer esto solo porque vive en webview aislado sin esos
      // providers.
      await invoke('recording_widget_request_start');
      // Si no llega `recording-start-complete` en 5s, asumimos que algo
      // falló silenciosamente y mostramos error.
      if (startTimeoutRef.current) clearTimeout(startTimeoutRef.current);
      startTimeoutRef.current = setTimeout(() => {
        setBusy(false);
        setErrorMsg('No se pudo iniciar. Abre Maity y revisa la configuración.');
        startTimeoutRef.current = null;
      }, 5000);
    } catch (err) {
      console.error('Failed to start recording from widget:', err);
      setBusy(false);
      setErrorMsg(typeof err === 'string' ? err : 'Error al iniciar grabación');
    }
  }, [busy]);

  const handlePause = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await invoke('pause_recording');
      setIsPaused(true);
    } catch (err) {
      console.error('Failed to pause recording:', err);
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const handleResume = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await invoke('resume_recording');
      setIsPaused(false);
      // Re-anclar timer descontando lo ya transcurrido.
      recordingStartRef.current = Date.now() - displaySecs * 1000;
    } catch (err) {
      console.error('Failed to resume recording:', err);
    } finally {
      setBusy(false);
    }
  }, [busy, displaySecs]);

  const handleStop = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await invoke('stop_recording_from_widget');
    } catch (err) {
      console.error('Failed to stop recording:', err);
    } finally {
      setBusy(false);
    }
  }, [busy]);

  // ── Renderers de botones inline (compactos para colapsado) ──────────────
  const renderInlineActionButtons = () => {
    if (!isRecording) {
      return (
        <button
          onClick={handleStart}
          disabled={busy}
          className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-red-500 hover:bg-red-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-[11px] transition shadow shadow-red-500/30"
          title="Iniciar grabación"
        >
          <Play className="w-3 h-3 fill-current" />
          {busy ? '...' : 'Grabar'}
        </button>
      );
    }
    if (isPaused) {
      return (
        <>
          <button
            onClick={handleResume}
            disabled={busy}
            className="flex items-center justify-center w-7 h-7 rounded-md bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed text-white transition"
            title="Reanudar"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
          </button>
          <button
            onClick={handleStop}
            disabled={busy}
            className="flex items-center justify-center w-7 h-7 rounded-md bg-red-500 hover:bg-red-400 disabled:opacity-50 disabled:cursor-not-allowed text-white transition"
            title="Detener"
          >
            <Square className="w-3 h-3 fill-current" />
          </button>
        </>
      );
    }
    return (
      <>
        <button
          onClick={handlePause}
          disabled={busy}
          className="flex items-center justify-center w-7 h-7 rounded-md bg-white/10 hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed text-white transition"
          title="Pausar"
        >
          <Pause className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={handleStop}
          disabled={busy}
          className="flex items-center justify-center w-7 h-7 rounded-md bg-red-500 hover:bg-red-400 disabled:opacity-50 disabled:cursor-not-allowed text-white transition"
          title="Detener"
        >
          <Square className="w-3 h-3 fill-current" />
        </button>
      </>
    );
  };

  // ── Status text/timer del header (compartido entre colapsado y expandido) ──
  const renderStatusBlock = () => {
    if (isRecording) {
      return (
        <div className="flex items-center gap-1.5 min-w-0" data-tauri-drag-region>
          <span className="relative flex h-2 w-2 shrink-0">
            {!isPaused && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
            )}
            <span className={`relative inline-flex rounded-full h-2 w-2 ${isPaused ? 'bg-amber-400' : 'bg-red-500'}`} />
          </span>
          <span className="text-[13px] font-semibold tabular-nums text-white">
            {formatDuration(displaySecs)}
          </span>
          {isPaused && (
            <span className="text-[9px] uppercase tracking-wider text-amber-400 font-bold">
              pausa
            </span>
          )}
        </div>
      );
    }
    return (
      <div className="flex items-center gap-1.5 min-w-0" data-tauri-drag-region>
        <span className="inline-flex h-2 w-2 rounded-full bg-zinc-500 shrink-0" />
        <span className="text-[11px] uppercase tracking-wider font-bold text-white/80">
          Maity
        </span>
      </div>
    );
  };

  // ── Botones de control de ventana (expand/collapse + cerrar) ────────────
  const renderWindowButtons = () => (
    <div className="flex items-center gap-0.5 shrink-0">
      <button
        onClick={toggleExpand}
        className="p-1 hover:bg-white/15 rounded text-white/70 transition"
        title={isExpanded ? 'Colapsar' : 'Expandir'}
        aria-label={isExpanded ? 'Colapsar' : 'Expandir'}
      >
        {isExpanded ? (
          <ChevronUp className="w-3.5 h-3.5" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5" />
        )}
      </button>
      <button
        onClick={closeWidget}
        className="p-1 hover:bg-red-500/30 hover:text-red-300 rounded text-white/70 transition"
        title="Ocultar widget"
        aria-label="Ocultar widget"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );

  // ── Colapsado (310×48) ─────────────────────────────────────────────────
  // Layout: [status] [botones inline acción] [expand] [cerrar]
  if (!isExpanded) {
    return (
      <div
        onMouseDown={handleDragMouseDown}
        className="h-screen w-screen flex items-center px-2.5 gap-2 rounded-xl overflow-hidden text-white cursor-grab active:cursor-grabbing"
        style={GLASS_STYLE}
        data-tauri-drag-region
      >
        {renderStatusBlock()}
        <div className="flex items-center gap-1 ml-auto" data-tauri-drag-region>
          {renderInlineActionButtons()}
        </div>
        {renderWindowButtons()}
        {errorMsg && (
          <div
            className="absolute left-2.5 right-2.5 -bottom-5 text-[9px] text-red-400 truncate"
            title={errorMsg}
          >
            {errorMsg}
          </div>
        )}
      </div>
    );
  }

  // ── Expandido (320×340) — idle ─────────────────────────────────────────
  // Layout más simple: header + niveles pequeños + botón Iniciar centrado.
  if (!isRecording) {
    return (
      <div
        onMouseDown={handleDragMouseDown}
        className="h-screen w-screen flex flex-col rounded-xl overflow-hidden text-white cursor-grab active:cursor-grabbing"
        style={GLASS_STYLE}
        data-tauri-drag-region
      >
        <div
          className="flex items-center justify-between px-3 h-12 select-none border-b border-white/5"
          data-tauri-drag-region
        >
          {renderStatusBlock()}
          {renderWindowButtons()}
        </div>

        <div className="flex-1 flex flex-col gap-3 px-4 py-4" data-tauri-drag-region>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Mic className="w-3.5 h-3.5 text-white/55" />
              <AudioBars rms={levels.micRms} scales={MIC_SCALES_SMALL} color="#485df4" maxH={14} />
            </div>
            <div className="flex items-center gap-2">
              <Volume2 className="w-3.5 h-3.5 text-white/55" />
              <AudioBars rms={levels.sysRms} scales={SYS_SCALES_SMALL} color="#10b981" maxH={14} />
            </div>
          </div>

          <div className="flex-1 flex items-center justify-center">
            <button
              onClick={handleStart}
              disabled={busy}
              className="flex items-center gap-2.5 px-6 py-3 rounded-xl bg-red-500 hover:bg-red-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-sm transition shadow-lg shadow-red-500/40"
            >
              <Play className="w-5 h-5 fill-current" />
              {busy ? 'Iniciando...' : 'Iniciar grabación'}
            </button>
          </div>

          {errorMsg ? (
            <p className="text-[10px] text-center text-red-400 leading-tight">
              {errorMsg}
            </p>
          ) : (
            <p className="text-[10px] text-center text-white/40 leading-tight">
              Arrancar grabación sin abrir la app principal.
            </p>
          )}
        </div>
      </div>
    );
  }

  // ── Expandido (320×340) — grabando: look glass coach-float ─────────────
  // Layout vertical: header REC pulsante + timer enorme + niveles grandes +
  // controles. Sin tips de IA (eso lo hace la otra ventana coach-float).
  return (
    <div
      onMouseDown={handleDragMouseDown}
      className="h-screen w-screen flex flex-col rounded-xl overflow-hidden text-white cursor-grab active:cursor-grabbing"
      style={GLASS_STYLE}
      data-tauri-drag-region
    >
      {/* Header REC */}
      <div
        className="flex items-center justify-between px-3 h-12 select-none border-b border-white/10"
        data-tauri-drag-region
      >
        <div className="flex items-center gap-1.5" data-tauri-drag-region>
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            {!isPaused && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
            )}
            <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${isPaused ? 'bg-amber-400' : 'bg-red-500'}`} />
          </span>
          <span className="text-[11px] uppercase tracking-widest font-bold text-white">
            {isPaused ? 'PAUSADO' : 'GRABANDO'}
          </span>
        </div>
        {renderWindowButtons()}
      </div>

      {/* Timer grande */}
      <div className="flex flex-col items-center py-3" data-tauri-drag-region>
        <span className="text-3xl font-bold tabular-nums tracking-wider text-white">
          {formatDuration(displaySecs)}
        </span>
        <span className="text-[9px] uppercase tracking-wider text-white/40 mt-0.5">
          Tiempo de sesión
        </span>
      </div>

      {/* Niveles grandes — barras 8 elementos, h-8 estilo coach-float */}
      <div className="flex flex-col gap-2 px-4 py-2 border-y border-white/5" data-tauri-drag-region>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-white/55 w-16">
            <Mic className="w-3 h-3" />
            Mic
          </div>
          <AudioBars
            rms={levels.micRms}
            scales={MIC_SCALES_LARGE}
            color="#485df4"
            maxH={28}
            barW={5}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-white/55 w-16">
            <Volume2 className="w-3 h-3" />
            Sistema
          </div>
          <AudioBars
            rms={levels.sysRms}
            scales={SYS_SCALES_LARGE}
            color="#10b981"
            maxH={28}
            barW={5}
          />
        </div>
      </div>

      {/* Controles grandes */}
      <div className="flex-1 flex items-center justify-center gap-2 px-4 pb-3">
        {!isPaused && (
          <button
            onClick={handlePause}
            disabled={busy}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-xs transition"
          >
            <Pause className="w-4 h-4" />
            Pausa
          </button>
        )}
        {isPaused && (
          <button
            onClick={handleResume}
            disabled={busy}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-xs transition shadow shadow-emerald-500/30"
          >
            <Play className="w-4 h-4 fill-current" />
            Reanudar
          </button>
        )}
        <button
          onClick={handleStop}
          disabled={busy}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-red-500 hover:bg-red-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-xs transition shadow shadow-red-500/30"
        >
          <Square className="w-4 h-4 fill-current" />
          Detener
        </button>
      </div>
    </div>
  );
}
