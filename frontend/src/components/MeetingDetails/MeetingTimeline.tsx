'use client';

import React, { useMemo, useState } from 'react';
import { TranscriptSegmentData } from '@/types';

interface MeetingTimelineProps {
  segments: TranscriptSegmentData[];
  className?: string;
}

interface Marker {
  id: string;
  startSec: number;
  durationSec: number;
  speaker: 'user' | 'interlocutor' | 'unknown';
  text: string;
  leftPct: number;
  widthPct: number;
}

const MIN_VISIBLE_PCT = 0.18;

function formatMmss(totalSeconds: number): string {
  const t = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function classifySpeaker(source: string | null | undefined): 'user' | 'interlocutor' | 'unknown' {
  if (source === 'user') return 'user';
  if (source === 'interlocutor') return 'interlocutor';
  return 'unknown';
}

/**
 * MeetingTimeline — visualización horizontal de la sesión por hablante.
 *
 * Inspirado en patrón Director (timeline + transcript con speaker attribution sincronizado):
 * - Lane superior: micrófono (usuario) — azul
 * - Lane inferior: sistema (interlocutor) — verde
 * - Click en segmento → scrollea al transcript correspondiente vía DOM id
 * - Hover muestra timestamp + preview
 *
 * Reusa la atribución de speaker que ya hace el pipeline (DeviceType.Microphone → "user",
 * DeviceType.System → "interlocutor"), por lo que no requiere lógica de speaker diarization.
 */
export function MeetingTimeline({ segments, className }: MeetingTimelineProps) {
  const [hovered, setHovered] = useState<Marker | null>(null);

  const { markers, totalSec } = useMemo(() => {
    if (!segments || segments.length === 0) {
      return { markers: [] as Marker[], totalSec: 0 };
    }

    let earliest = Number.POSITIVE_INFINITY;
    let latest = 0;
    for (const seg of segments) {
      const start = seg.timestamp ?? 0;
      const end = (seg.endTime ?? start) || start;
      if (start < earliest) earliest = start;
      if (end > latest) latest = end;
    }
    if (!isFinite(earliest)) earliest = 0;

    const total = Math.max(1, latest - earliest);
    const built: Marker[] = segments.map((seg) => {
      const start = seg.timestamp ?? 0;
      const end = (seg.endTime ?? start) || start;
      const startRel = start - earliest;
      const dur = Math.max(0.2, end - start);
      const widthRaw = (dur / total) * 100;
      return {
        id: seg.id,
        startSec: startRel,
        durationSec: dur,
        speaker: classifySpeaker(seg.source_type),
        text: (seg.text || '').slice(0, 120),
        leftPct: (startRel / total) * 100,
        widthPct: Math.max(MIN_VISIBLE_PCT, widthRaw),
      };
    });

    return { markers: built, totalSec: total };
  }, [segments]);

  const handleClick = (markerId: string) => {
    const el = document.getElementById(`segment-${markerId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('ring-2', 'ring-blue-400/70');
      setTimeout(() => el.classList.remove('ring-2', 'ring-blue-400/70'), 1500);
    }
  };

  if (markers.length === 0) {
    return null;
  }

  const userMarkers = markers.filter((m) => m.speaker === 'user' || m.speaker === 'unknown');
  const sysMarkers = markers.filter((m) => m.speaker === 'interlocutor');

  return (
    <div
      className={`relative w-full px-4 py-3 bg-gray-50 dark:bg-gray-900/40 border-b border-gray-200 dark:border-gray-800 ${className ?? ''}`}
      role="region"
      aria-label="Timeline de la reunión"
    >
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-3 text-[10px] text-gray-500">
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-blue-500" /> Usuario
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-emerald-500" /> Interlocutor
          </span>
        </div>
        <div className="text-[10px] font-medium text-gray-500">
          Duración: {formatMmss(totalSec)} · {markers.length} segmentos
        </div>
      </div>

      <div className="relative h-12 rounded-md bg-gray-100 dark:bg-gray-800/60 overflow-hidden">
        {/* User lane (top) */}
        <div className="absolute inset-x-0 top-0 h-1/2 border-b border-gray-200 dark:border-gray-700/60">
          {userMarkers.map((m) => (
            <button
              key={`u-${m.id}`}
              type="button"
              onClick={() => handleClick(m.id)}
              onMouseEnter={() => setHovered(m)}
              onMouseLeave={() => setHovered((h) => (h?.id === m.id ? null : h))}
              className="absolute top-1 bottom-1 bg-blue-500/70 hover:bg-blue-400 rounded-sm transition-colors cursor-pointer"
              style={{ left: `${m.leftPct}%`, width: `${m.widthPct}%` }}
              aria-label={`Usuario en ${formatMmss(m.startSec)}`}
            />
          ))}
        </div>
        {/* Interlocutor lane (bottom) */}
        <div className="absolute inset-x-0 bottom-0 h-1/2">
          {sysMarkers.map((m) => (
            <button
              key={`s-${m.id}`}
              type="button"
              onClick={() => handleClick(m.id)}
              onMouseEnter={() => setHovered(m)}
              onMouseLeave={() => setHovered((h) => (h?.id === m.id ? null : h))}
              className="absolute top-1 bottom-1 bg-emerald-500/70 hover:bg-emerald-400 rounded-sm transition-colors cursor-pointer"
              style={{ left: `${m.leftPct}%`, width: `${m.widthPct}%` }}
              aria-label={`Interlocutor en ${formatMmss(m.startSec)}`}
            />
          ))}
        </div>
      </div>

      {/* Tooltip preview */}
      {hovered && (
        <div className="mt-1.5 text-[11px] text-gray-700 dark:text-gray-300 px-2 py-1 rounded bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm">
          <span className="font-mono text-gray-500">[{formatMmss(hovered.startSec)}]</span>{' '}
          <span className={hovered.speaker === 'user' ? 'text-blue-600 dark:text-blue-300' : 'text-emerald-600 dark:text-emerald-300'}>
            {hovered.speaker === 'user' ? '🎤 Usuario' : hovered.speaker === 'interlocutor' ? '👥 Interlocutor' : '❓ Desconocido'}
          </span>
          {' · '}
          <span className="text-gray-600 dark:text-gray-400">{hovered.text || '(sin texto)'}</span>
        </div>
      )}
    </div>
  );
}
