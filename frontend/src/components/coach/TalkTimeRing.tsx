'use client';

import React from 'react';

/**
 * Anillo de tiempo de palabra (Tú vs Otro), a juego con `HealthGauge`.
 *
 * Variante C elegida el 2026-09-11 para el hero de grabación en lote
 * (mockups: artifact "Pantalla de grabación"): un donut azul/verde con el %
 * del usuario al centro y, al lado, los minutos de voz de cada canal cuando
 * el backend los manda (`MeetingMetrics.userVoicedSecs`, sólo modo audio);
 * sin ellos la leyenda cae a porcentajes. Mismos colores que `TalkSplitBar`.
 */

const USER_COLOR = '#485df4';
const INTERLOCUTOR_COLOR = '#1bea9a';
const SIZE = 72;
const STROKE = 8;

/** `0:05`, `12:04`, `1:02:05`. Puro, exportado para tests. */
export function formatClock(totalSecs: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(totalSecs) ? totalSecs : 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

export interface TalkTimeRingProps {
  /** % usuario (0-100). Se asume userPct + interlocutorPct = 100. */
  userPct: number;
  /** % interlocutor (0-100). */
  interlocutorPct: number;
  /** Segundos de voz del usuario; sin ellos la leyenda muestra el %. */
  userSecs?: number;
  /** Segundos de voz del interlocutor; sin ellos la leyenda muestra el %. */
  interlocutorSecs?: number;
  /** Si true, anillo vacío + "Esperando audio…" (aún no hubo voz). */
  empty?: boolean;
  userLabel?: string;
  interlocutorLabel?: string;
  className?: string;
}

export function TalkTimeRing({
  userPct,
  interlocutorPct,
  userSecs,
  interlocutorSecs,
  empty = false,
  userLabel = 'Tú',
  interlocutorLabel = 'Otro',
  className,
}: TalkTimeRingProps) {
  const u = Math.max(0, Math.min(100, Math.round(userPct)));
  const i = Math.max(0, Math.min(100, Math.round(interlocutorPct)));
  const radius = (SIZE - STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  const userLen = empty ? 0 : circumference * (u / 100);
  const otherLen = empty ? 0 : circumference * (i / 100);
  const userValue = userSecs !== undefined ? formatClock(userSecs) : `${u} %`;
  const otherValue = interlocutorSecs !== undefined ? formatClock(interlocutorSecs) : `${i} %`;

  return (
    <div
      className={`flex items-center gap-4 ${className ?? ''}`}
      role="img"
      aria-label={empty ? 'Esperando audio' : `${userLabel} ${u}% / ${interlocutorLabel} ${i}%`}
    >
      <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.1)"
            strokeWidth={STROKE}
          />
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={radius}
            fill="none"
            stroke={INTERLOCUTOR_COLOR}
            strokeWidth={STROKE}
            strokeDasharray={`${otherLen} ${circumference}`}
            strokeDashoffset={-userLen}
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
            style={{ transition: 'stroke-dasharray 0.5s ease, stroke-dashoffset 0.5s ease' }}
          />
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={radius}
            fill="none"
            stroke={USER_COLOR}
            strokeWidth={STROKE}
            strokeDasharray={`${userLen} ${circumference}`}
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
            style={{ transition: 'stroke-dasharray 0.5s ease' }}
          />
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[15px] font-semibold leading-none tabular-nums text-foreground">
            {empty ? '–' : `${u} %`}
          </span>
          <span className="mt-[3px] text-[9px] uppercase leading-none tracking-wide text-zinc-400">
            {userLabel.toLowerCase()}
          </span>
        </div>
      </div>

      {empty ? (
        <span className="text-xs text-zinc-500">Esperando audio…</span>
      ) : (
        <div className="flex flex-1 flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: USER_COLOR }} />
              {userLabel}
            </span>
            <span className="text-[13px] font-semibold tabular-nums text-foreground">{userValue}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: INTERLOCUTOR_COLOR }} />
              {interlocutorLabel}
            </span>
            <span className="text-[13px] font-semibold tabular-nums text-foreground">{otherValue}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default TalkTimeRing;
