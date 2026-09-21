/**
 * Shim de ruta: los archivos copiados de la web (Sixale730/maity@3ef2914) importan
 * `../../hooks/useGamifiedDashboardDataV2` desde `features/dashboard/components/gamified-v2/`.
 * En el desktop el hook vive en `features/gamification/hooks/` (queryKey propia
 * `['omi-conversations-analysis', maityUser.id]`, #05) — se re-exporta, no se duplica.
 */
export { useGamifiedDashboardDataV2 } from '@/features/gamification/hooks/useGamifiedDashboardDataV2';
export type {
  GamifiedDashboardDataV2,
  Competency,
  MountainNode,
  RankingEntry,
} from '@/features/gamification/hooks/useGamifiedDashboardDataV2';
