'use client';
// Origen: web Sixale730/maity@3ef2914 src/features/dashboard/components/gamified-v2/PerformanceSummary.tsx
// Adaptaciones desktop: 'use client'; react-router-dom → @/lib/router-compat (mapa web→desktop y externos a maity.cloud); @/features/omi/* resuelve a los adapters del desktop por alias (features/dashboard/adapters, dashboard-v1/adapter).
import { Link } from '@/lib/router-compat';
import type { RadarDataPoint, SessionHistoryRow } from '../../hooks/useProgressChartsData';
import type { OmiConversationListItem } from '@/features/omi/services/omi.service';
import { getNormalizedScores } from '@/features/omi/utils/feedback-scores';
import { buildConversationMoments } from './conversation-moments';

export function PerformanceSummary({ sessions, conversations = [] }: { radar: RadarDataPoint[]; sessions: SessionHistoryRow[]; conversations?: OmiConversationListItem[] }) {
  const latest = sessions[0];
  const earlier = sessions[sessions.length - 1];
  // Follow the same newest-first evaluated session as the history. The analysis
  // supplies the recommendation; radar zeros cannot distinguish absent scores.
  const conversation = conversations.find(c => getNormalizedScores(c));
  const focus = conversation ? buildConversationMoments(conversation, []).improvement : undefined;
  if (!latest) return <div className="performance-summary"><p>Aún no hay conversaciones evaluadas. Tu nivel de XP no sustituye esta evaluación.</p><Link to="/conversaciones">Ver mis conversaciones</Link></div>;
  const delta = latest.global - earlier.global;
  return <div className="performance-summary">
    <div className="performance-score"><strong>{latest.global}<small>/100</small></strong><span>Última evaluación<br/>{latest.fecha} · {latest.tipo}</span></div>
    {sessions.length > 1 ? <p>{delta > 0 ? '+' : ''}{delta} puntos frente a {earlier.global}/100 del {earlier.fecha}. Comparación entre las {sessions.length} sesiones recientes; no demuestra por sí sola una tendencia.</p> : <p>Una evaluación disponible. Aún no hay comparación.</p>}
    {focus && (focus.suggestion || focus.explanation) && <p><strong>{focus.title}:</strong> {focus.suggestion || focus.explanation}</p>}
    <Link to="/conversaciones">Revisar mi retroalimentación →</Link>
  </div>;
}
