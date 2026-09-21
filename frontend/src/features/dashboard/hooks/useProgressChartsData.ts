/**
 * Shim de ruta: los archivos copiados de la web (Sixale730/maity@3ef2914) importan
 * `../../hooks/useProgressChartsData` desde `features/dashboard/components/gamified-v2/`.
 * El hook real vive en `features/gamification/hooks/useProgressChartsData.ts`
 * (puntajes vía `utils/scoring.ts::getCommScore`, #72-#74).
 *
 * Única adaptación: la web tipa las conversaciones como `OmiConversationListItem`
 * (tipo ligero, ver `features/dashboard/adapters/omi.service.ts`) y el hook del
 * desktop como `OmiConversation`. En runtime son las MISMAS filas de
 * `getOmiConversationsForAnalysis`; el hook solo lee `created_at`,
 * `duration_seconds` y los JSONB de feedback (vía `getCommScore`), que ambos tipos traen.
 */
import type { OmiConversation } from '@/features/conversations/services/conversations.service';
import type { OmiConversationListItem } from '@/features/dashboard/adapters/omi.service';
import {
  useProgressChartsData as useDesktopProgressChartsData,
  type ProgressChartsData,
} from '@/features/gamification/hooks/useProgressChartsData';

export type {
  TrendDataPoint,
  DimensionSummaryItem,
  RadarDataPoint,
  SessionHistoryRow,
  ProgressChartsData,
} from '@/features/gamification/hooks/useProgressChartsData';

export function useProgressChartsData(conversations: OmiConversationListItem[]): ProgressChartsData {
  return useDesktopProgressChartsData(conversations as unknown as OmiConversation[]);
}
