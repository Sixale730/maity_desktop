/**
 * Shell v5 design tokens — chat redesign with the calendar sidebar.
 *
 * v5 keeps the same color semantics as v4 (zone, urgency, entry_type) but is
 * a fresh module so the v4 directory can be removed cleanly in one pass.
 *
 * Tokenizado para respetar temas del desktop (claro/oscuro/neutral/cool/warm).
 * Apunta a CSS vars en globals.css.
 */

export type Zone = 'productividad' | 'practica' | 'cuenta';

/** Brand color per zone (CSS color, vía tokens). */
export const ZONE_COLOR: Record<Zone, string> = {
  productividad: 'hsl(var(--maity-blue))',
  practica: 'hsl(var(--chart-3))',
  cuenta: 'hsl(var(--maity-warning))',
};

/** Color per urgency level (CSS color, vía tokens). */
export const URGENCY_COLOR = {
  now: 'hsl(var(--primary))',
  week: 'hsl(var(--maity-warning))',
  calm: 'hsl(var(--chart-3))',
} as const;

/**
 * Color per entry_type tag (CSS color, vía tokens). `thinking` se agregó en
 * 20260522_add_thinking_entry_type.sql — renderéalo azul Maity para matchear
 * la starter card "Algo que estoy pensando".
 */
export const ENTRY_TYPE_COLOR = {
  decision: 'hsl(var(--primary))',
  conversation: 'hsl(var(--chart-3))',
  focus: 'hsl(var(--maity-blue))',
  reflection: 'hsl(var(--maity-warning))',
  rehearsal: 'hsl(var(--chart-3))',
  thinking: 'hsl(var(--maity-blue))',
} as const;
