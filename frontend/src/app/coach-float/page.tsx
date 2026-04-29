'use client';

import React, { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { Sparkles, Minus, Maximize2, ThumbsUp, ThumbsDown } from 'lucide-react';
import { useCoachTips } from '@/hooks/useCoachTips';

interface AudioLevels {
  micRms: number;
  micPeak: number;
  sysRms: number;
  sysPeak: number;
}

interface TranscriptUpdate {
  text: string;
  source_type: string;
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

// §3.9 Adapters de la metadata centralizada (tipMeta.ts) a clases Tailwind para
// no romper el look actual. Importar desde tipMeta directamente cuando se haga
// la migracion full-glass de Fase 6.
import { getPriorityColor } from '@/components/coach/tipMeta';
const borderColor = (p: string) =>
  p === 'critical' ? 'border-red-500/50' : p === 'important' ? 'border-amber-500/50' : 'border-emerald-500/30';
const iconStyle = (p: string): React.CSSProperties => ({ color: getPriorityColor(p) });

export default function CoachFloatPage() {
  const { tips, latestTip } = useCoachTips(20);
  const [compact, setCompact] = useState(false);
  const [levels, setLevels] = useState({ micRms: 0, sysRms: 0 });
  const [words, setWords] = useState({ user: 0, inter: 0 });
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
    const subs = [
      listen<AudioLevels>('recording-audio-levels', (e) => {
        setLevels({ micRms: e.payload.micRms, sysRms: e.payload.sysRms });
      }),
      listen<TranscriptUpdate>('transcript-update', (e) => {
        const count = e.payload.text.trim().split(/\s+/).filter(Boolean).length;
        if (e.payload.source_type === 'user') {
          setWords((w) => ({ ...w, user: w.user + count }));
        } else {
          setWords((w) => ({ ...w, inter: w.inter + count }));
        }
      }),
      listen('recording-start-complete', () => {
        setWords({ user: 0, inter: 0 });
        setFeedback(null);
      }),
      listen<string>('early-meeting-id', (e) => {
        meetingIdRef.current = e.payload;
      }),
    ];
    return () => { subs.forEach((p) => p.then((fn) => fn())); };
  }, []);

  const isRecording = levels.micRms > 0 || levels.sysRms > 0;
  const total = words.user + words.inter;
  const userPct = total > 0 ? Math.round((words.user / total) * 100) : 50;

  const toggleCompact = () =>
    invoke('floating_toggle_compact')
      .then(() => setCompact((c) => !c))
      .catch(console.error);

  const close = () => invoke('close_floating_coach').catch(console.error);

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
  return (
    <div className="h-screen flex flex-col bg-zinc-900 border border-white/10 rounded-xl overflow-hidden select-none">

      {/* Title bar */}
      <div
        data-tauri-drag-region
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
          <span className="text-[10px] font-mono text-red-400 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block animate-pulse" />
            REC
          </span>
        )}
      </div>

      {/* Word split bar */}
      <div className="px-3 py-2 border-b border-white/5 shrink-0">
        <div className="flex items-center justify-between text-[10px] text-zinc-500 mb-1">
          <span>Tú {total > 0 ? `${userPct}%` : '—'}</span>
          <span className="text-zinc-700">palabras</span>
          <span>Ellos {total > 0 ? `${100 - userPct}%` : '—'}</span>
        </div>
        <div className="flex rounded-full overflow-hidden h-1.5 bg-white/5">
          <div className="bg-[#485df4] transition-all duration-500" style={{ width: `${userPct}%` }} />
          <div className="bg-emerald-500 transition-all duration-500" style={{ width: `${100 - userPct}%` }} />
        </div>
      </div>

      {/* Tips — más reciente arriba, historial debajo */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
        {tips.length > 0 ? (
          <>
            {/* Tip más reciente: estilo completo + like/dislike */}
            {latestTip && (
              <>
                <div className={`rounded-lg border p-3 ${borderColor(latestTip.priority)}`}>
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
