'use client';

import React from 'react';

// §2.2 Barra horizontal segmentada con % tiempo de palabra Tu vs Otro.
// Reemplaza la barra word-split simplificada actual del flotante.
// Colores: Tu = #485df4 (azul), Otro = #1bea9a (verde).

const USER_COLOR = '#485df4';
const INTERLOCUTOR_COLOR = '#1bea9a';

export interface TalkSplitBarProps {
  /** % usuario (0-100). Se asume userPct + interlocutorPct = 100. */
  userPct: number;
  /** % interlocutor (0-100). */
  interlocutorPct: number;
  /** Si true, muestra estado "Esperando audio…" en lugar de la barra (cuando no hay turns). */
  empty?: boolean;
  /** Label del usuario. Default "Tú". */
  userLabel?: string;
  /** Label del interlocutor. Default "Otro". */
  interlocutorLabel?: string;
  className?: string;
}

export function TalkSplitBar({
  userPct,
  interlocutorPct,
  empty = false,
  userLabel = 'Tú',
  interlocutorLabel = 'Otro',
  className,
}: TalkSplitBarProps) {
  if (empty) {
    return (
      <div
        className={`flex h-7 items-center justify-center rounded-md bg-white/5 px-3 text-xs text-zinc-500 ${className ?? ''}`}
      >
        Esperando audio…
      </div>
    );
  }

  // Defensivo: clamp y normalizar para garantizar que la barra rinda algo coherente
  // incluso si el backend manda valores inconsistentes.
  const u = Math.max(0, Math.min(100, Math.round(userPct)));
  const i = Math.max(0, Math.min(100, Math.round(interlocutorPct)));

  return (
    <div
      className={`flex h-7 w-full overflow-hidden rounded-md ${className ?? ''}`}
      role="img"
      aria-label={`${userLabel} ${u}% / ${interlocutorLabel} ${i}%`}
    >
      <div
        className="flex items-center justify-center text-[11px] font-medium text-white tabular-nums"
        style={{
          width: `${u}%`,
          background: USER_COLOR,
          transition: 'width 0.5s ease',
        }}
      >
        {u >= 12 ? `${userLabel} ${u}%` : ''}
      </div>
      <div
        className="flex items-center justify-center text-[11px] font-medium text-zinc-900 tabular-nums"
        style={{
          width: `${i}%`,
          background: INTERLOCUTOR_COLOR,
          transition: 'width 0.5s ease',
        }}
      >
        {i >= 12 ? `${interlocutorLabel} ${i}%` : ''}
      </div>
    </div>
  );
}

export default TalkSplitBar;
