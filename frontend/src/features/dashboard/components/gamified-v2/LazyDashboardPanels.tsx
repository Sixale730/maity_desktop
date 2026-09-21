'use client';

/**
 * Paneles del aside del dashboard cargados en diferido (Momentos y Contexto).
 *
 * El home entra en el bundle de arranque de la main (#24, `scripts/lint-main-bundle.js`,
 * presupuesto 1400 KB ejecutados). Con el dashboard de expedición el arranque quedó en el
 * límite; estos dos paneles viven bajo el radar, en pestañas, así que diferirlos no retrasa
 * lo primero que se ve (mapa + radar). Mismo molde que `LazyProgressChartsSection`.
 * `ConversationMoments` y `PerformanceSummary` siguen siendo copias tal cual de la web.
 */

import dynamic from 'next/dynamic';

const PanelSkeleton = () => <div className="min-h-[180px] rounded-lg bg-muted animate-pulse" />;

export const LazyConversationMoments = dynamic(
  () => import('./ConversationMoments').then((m) => ({ default: m.ConversationMoments })),
  { ssr: false, loading: PanelSkeleton },
);

export const LazyPerformanceSummary = dynamic(
  () => import('./PerformanceSummary').then((m) => ({ default: m.PerformanceSummary })),
  { ssr: false, loading: PanelSkeleton },
);
