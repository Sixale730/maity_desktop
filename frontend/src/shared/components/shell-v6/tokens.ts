// Origen: web Sixale730/maity@3ef2914 src/shared/components/shell-v6/tokens.ts
// Copia tal cual (sin adaptaciones).
/**
 * Shell v6 design tokens — unified sidebar redesign.
 *
 * Drop-in replacement for shell-v5/tokens.ts. Same color semantics for
 * urgency/entry_type so the chat primitives keep rendering identically.
 * Adds SIDEBAR_WIDTH + ROUTE_COLOR for the new UnifiedSidebar layout.
 */

export type Zone = 'productividad' | 'practica' | 'admin' | 'legacy';

/** Brand color per zone. Blue, mint and pink identify the main portal zones. */
export const ZONE_COLOR: Record<Zone, string> = {
  productividad: '#485df4',
  practica: '#1bea9a',
  admin: '#ff0050',
  legacy: '#9ca3af',
};

/** Per-route accent — color of each nav item's icon in inactive state. */
export const ROUTE_COLOR = {
  hoy: 'hsl(var(--muted-foreground))',
  sesiones: '#485df4',
  convs: '#00f5d4',
  notas: '#a78bfa',
  tareas: '#f97316',
  progreso: '#1bea9a',
  roleplay: '#ff7eb6',
  skills: '#fbbf24',
  recursos: '#34d399',
  equipo: '#60a5fa',
  descargar: '#60a5fa',
} as const;

/** Sidebar widths (px). Single source of truth — components read these. */
export const SIDEBAR_WIDTH = {
  EXPANDED: 272,
  COLLAPSED: 60,
} as const;

/** localStorage key for sidebar collapsed state. */
export const SIDEBAR_COLLAPSED_KEY = 'maity.sidebar.collapsed';

/** Urgency colors — same as v5 (--maity-pink/amber/green). */
export const URGENCY_COLOR = {
  now: '#ff0050',
  week: '#f6b352',
  calm: '#1bea9a',
} as const;

/** Entry_type tag colors — same as v5. */
export const ENTRY_TYPE_COLOR = {
  decision: '#ff0050',
  conversation: '#1bea9a',
  focus: '#485df4',
  reflection: '#f6b352',
  rehearsal: '#1bea9a',
  thinking: '#485df4',
} as const;
