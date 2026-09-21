'use client';
// Origen: web Sixale730/maity@3ef2914 src/features/expedition/ExpeditionIcon.tsx
// Adaptaciones desktop: 'use client' (usa useId). Resto tal cual.
import { useId } from 'react';
import './expedition-icons.css';

export type IconKind = 'mountains' | 'achievements' | 'equipment' | 'forge' | 'benefits' | 'flag' | 'camp' | 'chat' | 'target' | 'fire' | 'light' | 'heart' | 'layers' | 'leaf' | 'compass';
const COLORS: Record<IconKind, [string, string]> = {
  mountains: ['#ae8cff', '#6545ef'], achievements: ['#ffe682', '#ffae19'],
  equipment: ['#75f2e1', '#08bcb6'], forge: ['#ce95ff', '#8145ee'], benefits: ['#ff91d5', '#ed2691'],
  flag: ['#ff83cf', '#ed169b'], camp: ['#a08cff', '#6350e8'], chat: ['#9c9cff', '#5650ed'],
  target: ['#ff89c5', '#ed2589'], fire: ['#ffac58', '#ff2989'], light: ['#ffe999', '#ffb22e'],
  heart: ['#7cf0c7', '#0abd96'], layers: ['#80c5ff', '#4275ed'], leaf: ['#75efd5', '#0ab99d'], compass: ['#bca3ff', '#7351e8'],
};

/** Filled, softly faceted game symbols; accessible names belong to their controls. */
export function ExpeditionIcon({ kind }: { kind: IconKind }) {
  const id = `expedition-${useId().replace(/:/g, '')}`;
  const [light, dark] = COLORS[kind];
  return <span className={`expedition-icon expedition-icon-${kind}`} aria-hidden="true">
    <svg viewBox="0 0 40 40" focusable="false">
      <defs><linearGradient id={id} x1="0" y1="0" x2=".7" y2="1"><stop stopColor={light}/><stop offset="1" stopColor={dark}/></linearGradient></defs>
      <g fill={`url(#${id})`} strokeLinejoin="round">
        {kind === 'mountains' && <><path d="M2 32 14 8 25 32Z"/><path d="m17 32 10-21 12 21Z"/><path d="m14 8 2 24h9Z" fill={dark}/><path d="m9 18 5-10 5 10-5-3Z" fill="#f6f2ff"/><path d="m23 19 4-8 5 9-5-3Z" fill="#f6f2ff"/></>}
        {kind === 'achievements' && <><path d="m20 3 5 11 12 2-9 9 2 12-10-6-11 6 3-12-9-9 12-2Z"/><path d="m20 3 0 18-17-5 12-2Z" fill="#fff3ad" opacity=".6"/><path d="m20 21 10 16-2-12 9-9Z" fill={dark}/></>}
        {kind === 'equipment' && <><path d="M15 10V7q5-6 10 0v3" fill="none" stroke={dark} strokeWidth="3"/><rect x="9" y="9" width="22" height="27" rx="7"/><path d="M7 20v10m26-10v10" stroke={dark} strokeWidth="4" strokeLinecap="round"/><rect x="13" y="23" width="14" height="8" rx="3" fill="#c8fff1"/><path d="M15 12v7m10-7v7" stroke="#dcfff6" strokeWidth="3" strokeLinecap="round"/></>}
        {kind === 'forge' && <><path d="m20 3 6 12 10 5-10 5-6 12-5-12L4 20l11-5Z"/><path d="m20 3 0 17L4 20l11-5Z" fill="#eee0ff" opacity=".6"/></>}
        {kind === 'benefits' && <><rect x="7" y="16" width="26" height="19" rx="4"/><rect x="5" y="12" width="30" height="7" rx="3"/><path d="M20 12c-15 0-12-12-5-7l5 7c15 0 12-12 5-7Z"/><path d="M20 13v22" stroke="#ffe0f3" strokeWidth="5"/></>}
        {kind === 'flag' && <><path d="M12 5h3v29h-3zM15 6q7-5 18 0l-4 7 4 6q-10-5-18 0Z"/><path d="M7 34h17" stroke={dark} strokeWidth="4" strokeLinecap="round"/><path d="M16 7q6-3 13-1" fill="none" stroke="#ffc9ee" strokeWidth="2"/></>}
        {kind === 'camp' && <><path d="M3 33 20 6l17 27Z"/><path d="m20 6 17 27H21Z" fill={dark}/><path d="m20 19-7 14h14Z" fill="#eee7ff"/></>}
        {kind === 'chat' && <><path d="M5 16C5 1 35 1 35 17c0 10-9 15-19 11l-9 5 2-9Z"/>{[13,20,27].map(x=><circle key={x} cx={x} cy="17" r="2" fill="white"/>)}</>}
        {kind === 'target' && <><circle cx="19" cy="22" r="14"/><circle cx="19" cy="22" r="9" fill="none" stroke="#ffe6f3" strokeWidth="3"/><circle cx="19" cy="22" r="4" fill="#ffe6f3"/><path d="m19 22 13-14m-6 1 6-6v6h6l-6 6" fill="none" stroke={dark} strokeWidth="3" strokeLinecap="round"/></>}
        {kind === 'fire' && <><path d="M21 2c3 12 14 14 12 24-3 16-29 13-27-3 1-6 6-10 7-15 0 8 3 10 5 12 4-5 4-11 3-18Z"/><path d="M20 19c-1 6-8 8-5 13 5 7 14 0 9-6Z" fill="#ffe995"/></>}
        {kind === 'light' && <><path d="M12 23a12 12 0 1 1 16 0l-3 6H15Z"/><path d="M16 32h8m-7 4h6" stroke={dark} strokeWidth="3" strokeLinecap="round"/><path d="M14 12q2-5 7-5" fill="none" stroke="#fff5ce" strokeWidth="3" strokeLinecap="round"/></>}
        {kind === 'heart' && <><path d="M20 34C-8 17 8-4 20 10 32-4 48 17 20 34Z"/><path d="M10 12q3-4 7 0" fill="none" stroke="#d8ffed" strokeWidth="3" strokeLinecap="round"/></>}
        {kind === 'layers' && <><path d="m3 26 17-9 17 9-17 10Z"/><path d="m3 19 17-9 17 9-17 10Z" stroke="#edf6ff" strokeWidth="2"/><path d="m3 12 17-9 17 9-17 10Z" stroke="#edf6ff" strokeWidth="2"/></>}
        {kind === 'leaf' && <><path d="M33 5C9 3 2 17 12 28 25 39 36 23 33 5Z"/><path d="M7 35 27 13" stroke="#d3fff2" strokeWidth="3" strokeLinecap="round"/></>}
        {kind === 'compass' && <><circle cx="20" cy="20" r="16"/><circle cx="20" cy="20" r="12" fill="none" stroke="#e6ddff" strokeWidth="2"/><path d="m27 11-4 12-12 6 5-13Z" fill="#f9f5ff"/><path d="m27 11-7 9-4-4Z" fill={dark}/></>}
      </g>
    </svg>
  </span>;
}
