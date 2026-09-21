'use client';
// Origen: web Sixale730/maity@3ef2914 src/shared/components/shell-v6/PortalNavIcon.tsx
// Adaptaciones desktop: 'use client' (usa useId). Resto tal cual.
import { useId } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ExpeditionIcon } from '@/features/expedition/ExpeditionIcon';
import './portal-nav-icons.css';

type SymbolKind = 'home' | 'microphone' | 'masks' | 'gamepad' | 'book' | 'monitor' | 'folder' | 'note' | 'settings' | 'team' | 'building' | 'users' | 'chart' | 'card';
const ROUTE_SYMBOLS: Record<string, SymbolKind> = {
  '/hoy': 'home', '/conversaciones': 'microphone', '/roleplay': 'masks',
  '/skills-arena': 'gamepad', '/learning-content': 'book', '/download': 'monitor',
  '/documentos': 'folder', '/base-conocimiento': 'book', '/notas': 'note',
  '/configuracion': 'settings',
  '/team': 'team', '/organizations': 'building', '/usuarios': 'users',
  '/analytics': 'chart', '/settings': 'settings', '/admin/billing': 'card',
};
const PALETTE: Record<SymbolKind, string> = {
  home: '#485DF4', microphone: '#1BEA9A', masks: '#FF0050', gamepad: '#485DF4',
  book: '#1BEA9A', monitor: '#485DF4', folder: '#1BEA9A', note: '#FF0050', settings: '#485DF4',
  team: '#1BEA9A', building: '#485DF4', users: '#FF0050', chart: '#485DF4', card: '#1BEA9A',
};

/** Decorative navigation art; link text supplies the accessible name. */
export function PortalNavIcon({ to, fallback: Fallback }: { to: string; fallback: LucideIcon }) {
  const id = `portal-nav-${useId().replace(/:/g, '')}`;
  const kind = ROUTE_SYMBOLS[to];
  if (to === '/dashboard' || to === '/chat') {
    return <span className="portal-nav-art" aria-hidden="true"><ExpeditionIcon kind={to === '/dashboard' ? 'mountains' : 'chat'} /></span>;
  }
  if (!kind) return <Fallback size={18} strokeWidth={2} aria-hidden="true" />;
  const color = PALETTE[kind];
  return <span className="portal-nav-art" aria-hidden="true">
    <svg viewBox="0 0 40 40" focusable="false">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2=".7" y2="1">
          <stop stopColor="white" /><stop offset=".25" stopColor={color} stopOpacity=".62" /><stop offset="1" stopColor={color} />
        </linearGradient>
      </defs>
      <g fill={`url(#${id})`} strokeLinejoin="round" strokeLinecap="round">
        {kind === 'home' && <><path d="M7 18 20 6l13 12v15a3 3 0 0 1-3 3H10a3 3 0 0 1-3-3Z"/><path d="m4 19 14-14a3 3 0 0 1 4 0l14 14" fill="none" stroke={color} strokeWidth="4"/><rect x="16" y="23" width="8" height="13" rx="3" fill="white"/><path d="m11 17 7-7" stroke="white" strokeWidth="2" opacity=".8"/></>}
        {kind === 'microphone' && <><path d="M9 20a11 11 0 0 0 22 0M20 31v5m-6 0h12" fill="none" stroke="#485DF4" strokeWidth="3"/><rect x="13" y="3" width="14" height="24" rx="7"/><path d="M17 9v8" fill="none" stroke="white" strokeWidth="3"/><path d="M24 11h3m-3 5h3" stroke={color} strokeWidth="2"/></>}
        {kind === 'masks' && <><path d="M17 11q10 5 20-1v12q-1 11-10 14-9-4-10-14Z" fill="#485DF4"/><path d="M3 6q10 5 22-1v13q-1 11-11 15Q3 28 3 17Z"/><path d="m7 15 3-1m7 0 3 1m-11 7q5 5 10-1" fill="none" stroke="white" strokeWidth="2.5"/><path d="m29 18 3-1m-6 11q3-3 6-1" fill="none" stroke="white" strokeWidth="2"/></>}
        {kind === 'gamepad' && <><path d="M12 10h16c5 0 7 5 9 16 2 8-4 11-9 4l-2-2H14l-3 3c-5 6-11 2-9-5 3-11 5-16 10-16Z"/><path d="M12 16v10m-5-5h10" fill="none" stroke="white" strokeWidth="3.5"/><circle cx="29" cy="18" r="2.5" fill="#FF0050"/><circle cx="25" cy="24" r="2.5" fill="#1BEA9A"/><path d="M12 12h15" stroke="white" strokeWidth="2" opacity=".5"/></>}
        {kind === 'book' && <><path d="M4 8q8-4 16 1 8-5 16-1v24q-8-4-16 1-8-5-16-1Z"/><path d="M20 10v22" stroke="#485DF4" strokeWidth="2.5"/><path d="M8 14q4-1 8 1m-8 5q4-1 8 1m8-6q4-2 8-1m-8 7q4-2 8-1" fill="none" stroke="white" strokeWidth="2.5"/></>}
        {kind === 'monitor' && <><path d="M17 28h6l2 7H15Z" fill={color}/><rect x="3" y="5" width="34" height="25" rx="5"/><rect x="7" y="9" width="26" height="16" rx="2" fill="white"/><path d="M20 12v9m-4-4 4 4 4-4" fill="none" stroke="#FF0050" strokeWidth="3"/><path d="M12 35h16" stroke={color} strokeWidth="3"/></>}
        {kind === 'folder' && <><path d="M4 10a4 4 0 0 1 4-4h8l4 5h12a4 4 0 0 1 4 4v16H4Z" fill="#485DF4"/><path d="M4 16h32l-3 16a4 4 0 0 1-4 3H10a4 4 0 0 1-4-3Z"/><path d="M9 21h20" stroke="white" strokeWidth="2.5" opacity=".8"/></>}
        {kind === 'note' && <><path d="M9 4h22a4 4 0 0 1 4 4v19l-10 9H9a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4Z"/><path d="M25 36v-6a3 3 0 0 1 3-3h7Z" fill="white"/><path d="M12 13h16m-16 6h16m-16 6h7" stroke="white" strokeWidth="2.5"/></>}
        {kind === 'settings' && <><rect x="5" y="5" width="30" height="30" rx="9"/><path d="M12 12v16m8-16v16m8-16v16" stroke="white" strokeWidth="2"/><circle cx="12" cy="17" r="4" fill="#1BEA9A"/><circle cx="20" cy="24" r="4" fill="white"/><circle cx="28" cy="15" r="4" fill="#FF0050"/></>}
        {kind === 'team' && <><circle cx="9" cy="14" r="5" fill="#485DF4"/><circle cx="31" cy="14" r="5" fill="#485DF4"/><path d="M1 30v-5a8 8 0 0 1 16 0v5Zm22 0v-5a8 8 0 0 1 16 0v5Z" fill="#485DF4"/><circle cx="20" cy="11" r="7"/><path d="M9 35v-6a11 11 0 0 1 22 0v6Z"/><path d="m16 27 3 3 5-6" fill="none" stroke="white" strokeWidth="3"/></>}
        {kind === 'building' && <><rect x="5" y="4" width="24" height="32" rx="4"/><path d="M29 15h4a3 3 0 0 1 3 3v18h-7Z" fill="#1BEA9A"/><path d="M11 11h3m7 0h2m-12 7h3m7 0h2m-12 7h3m7 0h2" stroke="white" strokeWidth="3"/><path d="M16 36v-7h6v7" fill="white"/></>}
        {kind === 'users' && <><circle cx="28" cy="12" r="6" fill="#485DF4"/><path d="M22 22a10 10 0 0 1 16 8v5H22Z" fill="#485DF4"/><circle cx="14" cy="12" r="8"/><path d="M2 35v-5a12 12 0 0 1 24 0v5Z"/><path d="M8 28q6-4 12 0" fill="none" stroke="white" strokeWidth="2.5"/></>}
        {kind === 'chart' && <><rect x="4" y="21" width="8" height="14" rx="3" fill="#1BEA9A"/><rect x="16" y="14" width="8" height="21" rx="3"/><rect x="28" y="5" width="8" height="30" rx="3" fill="#FF0050"/><path d="M19 19v7m12-15v8" stroke="white" strokeWidth="2" opacity=".8"/></>}
        {kind === 'card' && <><rect x="3" y="7" width="34" height="27" rx="6"/><path d="M3 15h34v6H3Z" fill="#485DF4"/><rect x="8" y="25" width="9" height="4" rx="2" fill="white"/><circle cx="28" cy="27" r="3" fill="#FF0050"/><circle cx="32" cy="27" r="3" fill="white" fillOpacity=".85"/></>}
      </g>
    </svg>
  </span>;
}
