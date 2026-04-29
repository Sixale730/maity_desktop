// §3.9 Single source of truth para metadata de categorias y prioridades de tips.
//
// Antes el mapping prioridad -> color/label estaba duplicado en LiveFeedbackPanel.tsx
// y en coach-float/page.tsx. Cualquier cambio futuro de paleta exige tocar N componentes.
// Centralizar aqui previene drift y permite que componentes nuevos (HealthGauge, etc.)
// reutilicen el mismo lenguaje visual.

export interface CategoryMeta {
  label: string;
  color: string;
  icon?: string;
}

export interface PriorityMeta {
  label: string;
  /** Color base sin alpha. Usar con `${color}1a` (~10%) para fondos y `${color}55` (~33%) para borde. */
  color: string;
  /** Alpha hex de 2 chars para gradient lineal de fondo. */
  bgAlpha: string;
  /** Alpha hex de 2 chars para borde. */
  borderAlpha: string;
}

export const CATEGORY_META: Record<string, CategoryMeta> = {
  discovery:   { label: 'Descubrimiento', color: '#485df4' },
  objection:   { label: 'Objeción',       color: '#ff0050' },
  closing:     { label: 'Cierre',         color: '#1bea9a' },
  pacing:      { label: 'Ritmo',          color: '#a8b3ff' },
  rapport:     { label: 'Rapport',        color: '#1bea9a' },
  service:     { label: 'Servicio',       color: '#f59e0b' },
  negotiation: { label: 'Negociación',    color: '#ff0050' },
  listening:   { label: 'Escucha',        color: '#a8b3ff' },
};

export const PRIORITY_META: Record<string, PriorityMeta> = {
  critical:  { label: '🔴 Crítico',    color: '#ff0050', bgAlpha: '1a', borderAlpha: '55' },
  important: { label: '🟡 Importante', color: '#f59e0b', bgAlpha: '1a', borderAlpha: '55' },
  soft:      { label: '🟢 Sugerencia', color: '#1bea9a', bgAlpha: '1a', borderAlpha: '55' },
};

/** Devuelve el color base de una prioridad (fallback al color de "soft"). */
export function getPriorityColor(priority: string): string {
  return PRIORITY_META[priority]?.color ?? PRIORITY_META.soft.color;
}

/** Devuelve la metadata de una categoria (fallback con label capitalizado). */
export function getCategoryMeta(category: string): CategoryMeta {
  return (
    CATEGORY_META[category] ?? {
      label: category.charAt(0).toUpperCase() + category.slice(1),
      color: '#a8b3ff',
    }
  );
}
