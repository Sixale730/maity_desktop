'use client';

import React, { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import {
  Sparkles, AlertTriangle, ChevronLeft, ChevronRight,
  Minus, Maximize2, X, Timer, ThumbsUp, ThumbsDown,
} from 'lucide-react';
import { useCoachTips } from '@/hooks/useCoachTips';
import { useMeetingMetrics } from '@/hooks/useMeetingMetrics';
import { HealthGauge } from '@/components/coach/HealthGauge';
import { TalkSplitBar } from '@/components/coach/TalkSplitBar';
import { getPriorityColor, getCategoryMeta, PRIORITY_META } from '@/components/coach/tipMeta';

interface AudioLevels {
  micRms: number;
  micPeak: number;
  sysRms: number;
  sysPeak: number;
}

type TipFeedback = 'like' | 'dislike' | null;

const MIC_SCALES = [0.7, 1.0, 0.8];
const SYS_SCALES = [0.8, 1.0, 0.7];

// Wrapper con altura fija (h-5 = 20px = max altura de barra). Antes el flex
// items-end tenia altura auto y crecia con el RMS — empujando el layout entero.
function AudioBars({ rms, scales, color }: { rms: number; scales: number[]; color: string }) {
  return (
    <div className="h-5 flex items-end gap-[2px]">
      {scales.map((scale, i) => {
        const h = Math.max(3, Math.min(20, rms * 200 * scale));
        return (
          <div
            key={i}
            className="w-[3px] rounded-full transition-all duration-75"
            style={{ height: `${h}px`, backgroundColor: color }}
          />
        );
      })}
    </div>
  );
}

function healthColor(score: number): string {
  if (score >= 70) return '#1bea9a';
  if (score >= 40) return '#f59e0b';
  return '#ff0050';
}

function formatDuration(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

// Glass styles compartidos por compact/expanded — el fix del body transparent
// en layout.tsx deja que la ventana Tauri (transparent: true) muestre el blur
// del SO debajo de este div. Antes el body con `bg-background` (negro solido)
// tapaba el efecto.
const GLASS_STYLE: React.CSSProperties = {
  background: 'rgba(15, 16, 24, 0.92)',
  backdropFilter: 'blur(22px) saturate(180%)',
  WebkitBackdropFilter: 'blur(22px) saturate(180%)',
  border: '1px solid rgba(255,255,255,0.14)',
  boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
};

export default function CoachFloatPage() {
  const { tips } = useCoachTips(50);
  const { metrics, isWaitingForAudio } = useMeetingMetrics();
  const [compact, setCompact] = useState(false);
  const [levels, setLevels] = useState({ micRms: 0, sysRms: 0 });
  const [feedback, setFeedback] = useState<TipFeedback>(null);
  // tipIndex 0 = mas reciente. Reverse local del array de useCoachTips
  // (que llega cronologico, mas viejo primero).
  const [tipIndex, setTipIndex] = useState(0);
  const meetingIdRef = useRef<string | null>(null);
  // Timer local que tickea cada 1s para que el contador no salte de 3 en 3.
  // El backend emite meeting-metrics cada 3s; entre eventos extrapolamos via
  // Date.now() - lastMetricAt para evitar drift acumulado.
  const [displaySecs, setDisplaySecs] = useState(0);
  const lastMetricRef = useRef<{ secs: number; at: number } | null>(null);

  const reversedTips = [...tips].reverse();
  const totalTips = reversedTips.length;
  const tip = reversedTips[tipIndex] ?? null;
  const canPrev = tipIndex < totalTips - 1;
  const canNext = tipIndex > 0;
  const goPrev = () => canPrev && setTipIndex(i => i + 1);
  const goNext = () => canNext && setTipIndex(i => i - 1);
  const isLatest = tipIndex === 0;

  // Cuando llega tip nuevo (totalTips cambia), saltar al mas reciente y
  // resetear feedback. Tambien cubre el caso de recording-start-complete
  // (useCoachTips limpia el array internamente -> totalTips = 0).
  useEffect(() => {
    setTipIndex(0);
    setFeedback(null);
  }, [totalTips]);

  // Reset feedback al navegar entre tips manualmente.
  useEffect(() => {
    setFeedback(null);
  }, [tipIndex]);

  useEffect(() => {
    const subs = [
      listen<AudioLevels>('recording-audio-levels', (e) => {
        setLevels({ micRms: e.payload.micRms, sysRms: e.payload.sysRms });
      }),
      listen<string>('early-meeting-id', (e) => {
        meetingIdRef.current = e.payload;
      }),
    ];
    return () => { subs.forEach(p => p.then(fn => fn())); };
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

  const isRecording = levels.micRms > 0 || levels.sysRms > 0;
  const sessionTime = formatDuration(displaySecs);
  const health = metrics?.health ?? 70;
  const userPct = metrics?.userTalkPct ?? 50;
  const interlocutorPct = metrics?.interlocutorTalkPct ?? 50;

  const toggleCompact = () =>
    invoke('floating_toggle_compact')
      .then(() => setCompact(c => !c))
      .catch(console.error);

  const close = () => invoke('close_floating_coach').catch(console.error);

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
    if (!tip || !isLatest || feedback !== null) return;
    setFeedback(rating);
    try {
      await invoke('save_user_feedback', {
        meetingId: meetingIdRef.current ?? undefined,
        feedbackType: 'coach_tip_feedback',
        rating,
        message: undefined,
        metadata: JSON.stringify({
          tip_text: tip.tip,
          tip_category: tip.category,
          tip_priority: tip.priority,
          tip_type: tip.tip_type,
        }),
      });
    } catch (e) {
      console.error('[CoachFloat] feedback save failed:', e);
    }
  };

  const prioMeta = tip?.priority ? PRIORITY_META[tip.priority] : null;
  const tipColor = tip ? getPriorityColor(tip.priority) : '#a8b3ff';
  const catMeta = tip?.category ? getCategoryMeta(tip.category) : null;

  // ── Compact ─────────────────────────────────────────────────────
  if (compact) {
    return (
      <div
        onMouseDown={handleDragMouseDown}
        className="h-screen w-screen flex flex-col p-2 select-none rounded-xl"
        style={GLASS_STYLE}
        data-tauri-drag-region
      >
        <div className="flex items-center justify-between mb-1.5" data-tauri-drag-region>
          <div className="flex items-center gap-1 text-[9px] uppercase font-bold tracking-wider text-white/70">
            <Sparkles className="w-3 h-3 text-[#485df4]" /> Maity
          </div>
          <div className="flex items-center gap-0.5">
            <button
              onClick={toggleCompact}
              className="p-0.5 hover:bg-white/15 rounded text-white/70"
              title="Expandir"
            >
              <Maximize2 className="w-3 h-3" />
            </button>
            <button
              onClick={close}
              className="p-0.5 hover:bg-red-500/30 rounded text-white/70"
              title="Cerrar"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>
        {/* Body sin onClick: el handler React le ganaba al data-tauri-drag-region
            y rompia el drag de la ventana. Para expandir esta el boton explicito
            arriba. */}
        <div className="flex-1 flex items-center gap-2 px-1" data-tauri-drag-region>
          <div
            className="text-3xl font-bold tabular-nums leading-none"
            style={{ color: healthColor(health) }}
          >
            {Math.round(health)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] text-white/55 uppercase tracking-wider mb-0.5">
              {prioMeta?.label ?? 'Esperando'}
            </div>
            <div className="text-[11px] text-white/95 line-clamp-2 leading-tight font-medium">
              {tip?.tip ?? 'Sin tips aún'}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Expanded ────────────────────────────────────────────────────
  return (
    <div
      onMouseDown={handleDragMouseDown}
      className="h-screen flex flex-col overflow-hidden select-none rounded-xl text-white"
      style={GLASS_STYLE}
      data-tauri-drag-region
    >
      {/* Header — pulsing dot + MAITY COACH + counter + actions */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b border-white/10 shrink-0"
        data-tauri-drag-region
      >
        <div className="flex items-center gap-1.5 text-xs">
          <div className="relative w-2 h-2">
            {isRecording && (
              <div className="absolute inset-0 rounded-full bg-[#1bea9a] animate-ping opacity-75" />
            )}
            <div className={`absolute inset-0 rounded-full ${isRecording ? 'bg-[#1bea9a]' : 'bg-zinc-600'}`} />
          </div>
          <span className="font-bold tracking-wider text-white">MAITY COACH</span>
          {totalTips > 0 && (
            <span className="ml-1 text-[9px] px-1.5 py-0.5 rounded bg-[#485df4]/30 text-[#a8b3ff] font-semibold">
              {totalTips} tip{totalTips !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={toggleCompact}
            className="p-1 hover:bg-white/15 rounded text-white/70 transition"
            title="Modo compacto"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={close}
            className="p-1 hover:bg-red-500/30 hover:text-red-300 rounded text-white/70 transition"
            title="Cerrar"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* AudioBars — wrapper con altura fija para que el RMS no haga bailar el layout. */}
      <div className="px-3 py-2 border-b border-white/5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-xs">🎤</span>
            <AudioBars rms={levels.micRms} scales={MIC_SCALES} color="#485df4" />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs">🔊</span>
            <AudioBars rms={levels.sysRms} scales={SYS_SCALES} color="#10b981" />
          </div>
        </div>
        {isRecording && (
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-zinc-200 tabular-nums">{sessionTime}</span>
            <span className="text-[10px] font-mono text-red-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              REC
            </span>
          </div>
        )}
      </div>

      {/* Métricas — HealthGauge 96x96 + tarjeta Tiempo (sin WPM) */}
      <div
        className="px-3 py-3 border-b border-white/5 shrink-0 flex items-center gap-3"
        data-tauri-drag-region
      >
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

      {/* Talk split bar (componente compartido del repo) */}
      <div className="px-3 py-2 border-b border-white/5 shrink-0" data-tauri-drag-region>
        <div className="flex items-center justify-between text-[9px] uppercase tracking-wider text-white/55 mb-1">
          <span>Tiempo de palabra</span>
        </div>
        <TalkSplitBar
          userPct={userPct}
          interlocutorPct={interlocutorPct}
          empty={isWaitingForAudio}
        />
      </div>

      {/* Card de tip con gradient por prioridad + nav historial chevrons */}
      <div className="flex-1 flex flex-col p-3 gap-2 min-h-0 overflow-hidden">
        <div
          className="flex-1 rounded-lg border p-3 flex flex-col min-h-0 overflow-hidden"
          style={{
            background: tip
              ? `linear-gradient(135deg, ${tipColor}1a 0%, rgba(255,255,255,0.04) 100%)`
              : 'rgba(255,255,255,0.04)',
            borderColor: tip ? `${tipColor}55` : 'rgba(255,255,255,0.08)',
            transition: 'border-color 0.3s ease, background 0.3s ease',
          }}
        >
          <div className="flex items-center justify-between mb-2 shrink-0">
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
                  className="w-7 h-7 flex items-center justify-center rounded-md bg-white/10 hover:bg-white/20 disabled:opacity-25 disabled:cursor-not-allowed text-white transition"
                  title="Tip anterior"
                  aria-label="Tip anterior"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-[10px] tabular-nums text-white/80 px-1.5 font-semibold">
                  {tipIndex + 1}/{totalTips}
                </span>
                <button
                  onClick={goNext}
                  disabled={!canNext}
                  className="w-7 h-7 flex items-center justify-center rounded-md bg-white/10 hover:bg-white/20 disabled:opacity-25 disabled:cursor-not-allowed text-white transition"
                  title="Tip siguiente"
                  aria-label="Tip siguiente"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          <div className="text-sm text-white/95 leading-relaxed overflow-y-auto custom-scrollbar flex-1 font-medium">
            {tip?.tip ?? (
              <div className="text-white/55 text-xs italic">
                {isRecording ? 'Escuchando...' : 'Inicia una grabación para recibir coaching.'}
              </div>
            )}
          </div>
        </div>

        {/* Like/Dislike — solo en el tip mas reciente */}
        {tip && isLatest && (
          <div className="flex gap-2 justify-center shrink-0">
            {(['like', 'dislike'] as const).map((r) => (
              <button
                key={r}
                onClick={() => sendFeedback(r)}
                disabled={feedback !== null}
                className={[
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-all',
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
    </div>
  );
}
