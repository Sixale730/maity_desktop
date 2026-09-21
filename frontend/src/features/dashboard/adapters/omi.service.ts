/**
 * Adapter de `@/features/omi/services/omi.service` (web Sixale730/maity@3ef2914)
 * para el dashboard de expedición portado. Resuelve por alias en `tsconfig.json`
 * y `vitest.config.ts` — los archivos copiados de la web NO cambian su import.
 *
 * En el desktop el servicio de conversaciones es
 * `features/conversations/services/conversations.service.ts`; aquí solo se
 * re-exporta lo que consume el dashboard:
 *  - `getOmiTranscriptSegments` (Momentos verifica la cita contra la transcripción;
 *    ya usa `.schema('maity')`).
 *  - `OmiTranscriptSegment` (mismo shape que la web).
 *  - `OmiConversationListItem`: el tipo "ligero" de la web. Se define para que
 *    tanto la fila completa del desktop (`OmiConversation`, lo que devuelve
 *    `getOmiConversationsForAnalysis`) como los literales de los tests de la
 *    web sean asignables. No añade campos que el desktop no traiga.
 */
import type {
  CommunicationFeedback,
  OmiConversation,
} from '@/features/conversations/services/conversations.service';

export {
  getOmiTranscriptSegments,
  type OmiTranscriptSegment,
} from '@/features/conversations/services/conversations.service';

export interface OmiConversationListItem {
  id: string;
  user_id: string | null;
  created_at: string;
  title: string;
  overview: string;
  emoji: string | null;
  category: string | null;
  source?: string | null;
  words_count: number | null;
  duration_seconds: number | null;
  communication_feedback: CommunicationFeedback | null;
  /** V4 (estándar actual). Puede ser el marcador `AnalysisSkipped`: los consumidores
   *  del dashboard filtran con `isFullAnalysis` antes de leerlo (#72). */
  communication_feedback_v4: OmiConversation['communication_feedback_v4'] | Record<string, unknown> | null;
}
