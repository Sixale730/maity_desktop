'use client';

import React, { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { Sparkles, Minus, Maximize2, ThumbsUp, ThumbsDown } from 'lucide-react';
import { useCoachTips } from '@/hooks/useCoachTips';
import { useMeetingMetrics } from '@/hooks/useMeetingMetrics';
import { HealthGauge } from '@/components/coach/HealthGauge';
import { TalkSplitBar } from '@/components/coach/TalkSplitBar';

interface AudioLevels {
  micRms: number;
  micPeak: number;
  sysRms: number;
  sysPeak: number;
}

type TipFeedback = 'like' | 'dislike' | null;

const MIC_SCALES = [0.7, 1.0, 0.8];
const SYS_SCALES = [0.8, 1.0, 0.7];

function AudioBars({ rms, scales, color }: { rms: number; scales: number[]; color: string }) {
  return (
    <div className="flex items-end gap-[2px]">
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

// §3.9 Adapter del color de prioridad inline (style en lugar de className porque
// tipMeta.ts da hex y tailwind no parsea clases dinamicas). Cards usan gradient
// con alpha-hex 8 digitos directamente, ver §3.8 en el render.
import { getPriorityColor } from '@/components/coach/tipMeta';
const iconStyle = (p: string): React.CSSProperties => ({ color: getPriorityColor(p) });

export default function CoachFloatPage() {
  // §3.7 Cap historial 20 -> 50 para sesiones largas con buena cadencia.
  const { tips, latestTip } = useCoachTips(50);
  // §2.3 + §2.4 Listener meeting-metrics + render HealthGauge + TalkSplitBar.
  const { metrics, isWaitingForAudio } = useMeetingMetrics();
  const [compact, setCompact] = useState(false);
  const [levels, setLevels] = useState({ micRms: 0, sysRms: 0 });
  const [feedback, setFeedback] = useState<TipFeedback>(null);
  const meetingIdRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Reset feedback cuando cambia el tip más reciente
  useEffect(() => {
    setFeedback(null);
  }, [latestTip]);

  // Auto-scroll al top cuando llega un nuevo tip
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [tips.length]);

  useEffect(() => {
    // §2.4 Quitamos el listener transcript-update + setWords: el split-bar
    // ahora consume meeting-metrics, no contadores locales de palabras.
    const subs = [
      listen<AudioLevels>('recording-audio-levels', (e) => {
        setLevels({ micRms: e.payload.micRms, sysRms: e.payload.sysRms });
      }),
      listen('recording-start-complete', () => {
        setFeedback(null);
      }),
      listen<string>('early-meeting-id', (e) => {
        meetingIdRef.current = e.payload;
      }),
    ];
    return () => { subs.forEach((p) => p.then((fn) => fn())); };
  }, []);

  const isRecording = levels.micRms > 0 || levels.sysRms > 0;

  // §2.4 Contador de tiempo a partir de metrics.sessionSecs (fuente de verdad
  // backend, evita drift con timers locales). Formato MM:SS o HH:MM:SS.
  const sessionTime = (() => {
    const secs = metrics?.sessionSecs ?? 0;
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    const pad = (n: number) => n.toString().padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  })();

  const toggleCompact = () =>
    invoke('floating_toggle_compact')
      .then(() => setCompact((c) => !c))
      .catch(console.error);

  const close = () => invoke('close_floating_coach').catch(console.error);

  // §3.6 Drag fallback programatico para Windows. data-tauri-drag-region puede
  // no funcionar consistentemente en Win con decorations:false + transparent:true.
  // El handler ignora botones no-izq y elementos interactivos para no atrapar clicks.
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
    if (!latestTip || feedback !== null) return;
    setFeedback(rating);
    try {
      await invoke('save_user_feedback', {
        meetingId: meetingIdRef.current ?? undefined,
        feedbackType: 'coach_tip_feedback',
        rating,
        message: undefined,
        metadata: JSON.stringify({
          tip_text: latestTip.tip,
          tip_category: latestTip.category,
          tip_priority: latestTip.priority,
          tip_type: latestTip.tip_type,
        }),
      });
    } catch (e) {
      console.error('[CoachFloat] feedback save failed:', e);
    }
  };

  // ── Compact ─────────────────────────────────────────────────────
  if (compact) {
    return (
      <div
        className="h-screen flex items-center justify-between px-3 bg-zinc-900 border border-white/10 rounded-xl cursor-pointer select-none"
        onClick={toggleCompact}
      >
        <div className="flex items-center gap-2">
          {isRecording
            ? <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            : <span className="w-1.5 h-1.5 rounded-full bg-zinc-600" />}
          <span className="text-xs text-zinc-400">Coach</span>
        </div>
        {latestTip && <span className="text-xs text-white truncate max-w-[200px] mx-2">{latestTip.tip}</span>}
        <Maximize2 className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
      </div>
    );
  }

  // ── Expanded ────────────────────────────────────────────────────
  // §3.2 Glass background con backdrop-filter blur 22px. La ventana Tauri es
  // transparent (§3.1), asi que el bg rgba(15,16,24,0.92) + blur dan el efecto.
  return (
    <div
      className="h-screen flex flex-col overflow-hidden select-none rounded-xl"
      style={{
        background: 'rgba(15, 16, 24, 0.92)',
        backdropFilter: 'blur(22px) saturate(180%)',
        WebkitBackdropFilter: 'blur(22px) saturate(180%)',
        border: '1px solid rgba(255,255,255,0.14)',
        boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
      }}
    >

      {/* Title bar — §3.6 doble drag: data-tauri-drag-region nativo + onMouseDown
          fallback que llama startDragging() programatico (Win con decorations:false
          + transparent:true a veces ignora el atributo nativo). */}
      <div
        data-tauri-drag-region
        onMouseDown={handleDragMouseDown}
        className="flex items-center justify-between px-3 py-2 border-b border-white/10 cursor-move shrink-0"
      >
        <div className="flex items-center gap-2">
          {isRecording
            ? <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            : <span className="w-1.5 h-1.5 rounded-full bg-zinc-600" />}
          <span className="text-xs font-medium text-zinc-400">Maity Coach</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={toggleCompact} className="p-1 rounded hover:bg-white/10 text-zinc-500 hover:text-white transition-colors">
            <Minus className="w-3 h-3" />
          </button>
          <button onClick={close} className="p-1 rounded hover:bg-red-500/20 text-zinc-500 hover:text-red-400 transition-colors">
            ✕
          </button>
        </div>
      </div>

      {/* Audio bars */}
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
            {/* §2.4 Timer de sesion (fuente: metrics.sessionSecs del backend) */}
            <span className="text-[10px] font-mono text-zinc-300 tabular-nums">{sessionTime}</span>
            <span className="text-[10px] font-mono text-red-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block animate-pulse" />
              REC
            </span>
          </div>
        )}
      </div>

      {/* §2.4 Header de metricas: HealthGauge 96x96 + TalkSplitBar.
          Reemplaza la barra word-split simplificada anterior. Datos vienen del
          evento meeting-metrics (3s) — antes se calculaban a partir de
          `words` (eventos transcript-update) que ya no son la fuente de verdad. */}
      <div className="px-3 py-3 border-b border-white/5 shrink-0 flex items-center gap-3">
        <HealthGauge value={metrics?.health ?? 70} />
        <div className="flex-1">
          <TalkSplitBar
            userPct={metrics?.userTalkPct ?? 50}
            interlocutorPct={metrics?.interlocutorTalkPct ?? 50}
            empty={isWaitingForAudio}
          />
        </div>
      </div>

      {/* Tips — más reciente arriba, historial debajo */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
        {tips.length > 0 ? (
          <>
            {/* Tip más reciente: estilo completo + like/dislike.
                §3.8 Card con gradient lineal por priority — alpha-hex 8 digitos
                (1a=10%, 55=33%) sobre el color base de tipMeta.ts. El border
                simple anterior hacia que todos los tips se vieran iguales. */}
            {latestTip && (
              <>
                <div
                  className="rounded-lg border p-3"
                  style={{
                    background: `linear-gradient(135deg, ${getPriorityColor(latestTip.priority)}1a 0%, rgba(255,255,255,0.04) 100%)`,
                    borderColor: `${getPriorityColor(latestTip.priority)}55`,
                    transition: 'border-color 0.3s ease, background 0.3s ease',
                  }}
                >
                  <div className="flex items-start gap-2">
                    <Sparkles className="w-4 h-4 mt-0.5 shrink-0" style={iconStyle(latestTip.priority)} />
                    <p className="text-sm text-white leading-snug">{latestTip.tip}</p>
                  </div>
                  {(latestTip.category || latestTip.trigger) && (
                    <div className="flex items-center gap-2 mt-2 ml-6">
                      <span className="text-xs text-zinc-500 capitalize">{latestTip.category}</span>
                      {latestTip.trigger && (
                        <>
                          <span className="text-zinc-700">·</span>
                          <span className="text-xs text-zinc-600">{latestTip.trigger}</span>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* Like / Dislike — solo para el tip más reciente */}
                <div className="flex gap-2 justify-center">
                  {(['like', 'dislike'] as const).map((r) => (
                    <button
                      key={r}
                      onClick={() => sendFeedback(r)}
                      disabled={feedback !== null}
                      className={[
                        'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-all',
                        feedback === r
                          ? r === 'like' ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-400' : 'border-red-500/50 bg-red-500/15 text-red-400'
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
              </>
            )}

            {/* Historial de tips anteriores — compacto y opaco */}
            {tips.length > 1 && (
              <div className="border-t border-white/5 pt-2 space-y-1.5">
                <p className="text-[10px] text-zinc-600 uppercase tracking-wide px-1">Anteriores</p>
                {[...tips].reverse().slice(1).map((tip, idx) => (
                  <div key={`${tip.timestamp_secs}-${idx}`} className="flex items-start gap-2 opacity-40 px-1">
                    <Sparkles className="w-3 h-3 mt-0.5 shrink-0 text-zinc-500" />
                    <p className="text-xs text-zinc-400 leading-snug">{tip.tip}</p>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center flex-1 gap-3 text-center py-8">
            <Sparkles className="w-7 h-7 text-zinc-700" />
            <p className="text-xs text-zinc-600">
              {isRecording ? 'Escuchando...' : 'Inicia una grabación para recibir coaching.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
