// El dashboard de la home es el de expedición portado de la web (sep-2026):
// features/dashboard/components/gamified-v2/GamifiedDashboardV2.tsx. Este barrel se conserva
// para que `app/(main)/page.tsx` y `app/(main)/gamification/page.tsx` no cambien su import.
export { GamifiedDashboardV2 } from '@/features/dashboard/components/gamified-v2';
export { RadarChartV2 } from './components/RadarChartV2';
export { useGamifiedDashboardDataV2 } from './hooks/useGamifiedDashboardDataV2';
export type { GamifiedDashboardDataV2, Competency, MountainNode } from './hooks/useGamifiedDashboardDataV2';
