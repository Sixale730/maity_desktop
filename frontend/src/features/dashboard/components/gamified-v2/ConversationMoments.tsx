'use client';
// Origen: web Sixale730/maity@3ef2914 src/features/dashboard/components/gamified-v2/ConversationMoments.tsx
// Adaptaciones desktop: 'use client'; react-router-dom → @/lib/router-compat (mapa web→desktop y externos a maity.cloud); @/features/omi/* resuelve a los adapters del desktop por alias (features/dashboard/adapters, dashboard-v1/adapter).
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@/lib/router-compat';
import { ArrowUpRight, CheckCircle2, MessageSquareQuote, Sparkles } from 'lucide-react';
import { getOmiTranscriptSegments, type OmiConversationListItem } from '@/features/omi/services/omi.service';
import { buildConversationMoments, canVerifyMomentEvidence, latestAnalyzedConversation } from './conversation-moments';
import './conversation-moments.css';

export function ConversationMoments({ conversations }: { conversations: OmiConversationListItem[] }) {
  const conversation = latestAnalyzedConversation(conversations);
  return conversation ? <SessionMoments key={conversation.id} conversation={conversation} /> :
    <div className="conversation-moments moments-empty"><MessageSquareQuote size={24}/><strong>Tu conversación tiene pistas</strong><p>Cuando tengas un análisis, verás qué funcionó y qué puedes probar.</p><Link to="/conversaciones">Ver conversaciones <ArrowUpRight size={14}/></Link></div>;
}

function SessionMoments({ conversation }: { conversation: OmiConversationListItem }) {
  const [selection, setSelection] = useState<'strength' | 'improvement'>('improvement');
  const { data: segments = [], isLoading, isError } = useQuery({
    queryKey: ['dashboard-moment-segments', conversation.user_id, conversation.id],
    queryFn: () => getOmiTranscriptSegments(conversation.id),
    enabled: canVerifyMomentEvidence(conversation),
    staleTime: 60_000,
    retry: false,
    throwOnError: false,
  });
  const moments = buildConversationMoments(conversation, segments);
  const active = moments[selection] ? selection : moments.improvement ? 'improvement' : 'strength';
  const moment = moments[active];
  const date = new Date(conversation.created_at);
  const dateLabel = Number.isFinite(date.getTime()) ? date.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }) : '';
  const seconds = moment?.evidence?.seconds;
  const timestamp = seconds === undefined ? '' : `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  return <section className="conversation-moments" aria-label="Momentos clave de tu conversación">
    <header><span>Último análisis · {dateLabel}</span><Link to={`/conversaciones/${conversation.id}`} title={conversation.title}>{conversation.title || 'Ver conversación'} <ArrowUpRight size={13}/></Link></header>
    {moments.unavailable ? <p className="moments-empty">La grabación no permite dar feedback fiable. Revisa el análisis de esta conversación.</p> : <>
      <div className="moments-choices" role="group" aria-label="Explorar feedback">
        <button disabled={!moments.strength} aria-pressed={active === 'strength'} onClick={() => setSelection('strength')}><CheckCircle2 size={14}/>Funcionó</button>
        <button disabled={!moments.improvement} aria-pressed={active === 'improvement'} onClick={() => setSelection('improvement')}><Sparkles size={14}/>Prueba esto</button>
      </div>
      {moment ? <article className={`moment-card moment-${active}`}>
        <h3>{moment.title}</h3>
        {moment.explanation && <p>{moment.explanation}</p>}
        {moment.evidence ? <details className="moment-evidence"><summary><MessageSquareQuote size={13}/>{timestamp ? `Fragmento · ${timestamp}` : 'Fragmento verificado'}<span>Leer</span></summary><blockquote>{moment.evidence.quote}</blockquote><p className="moment-context">Contexto: {moment.evidence.context}</p></details> : <small>{isLoading ? 'Verificando fragmento…' : isError ? 'No se pudo verificar el fragmento.' : 'Este hallazgo no tiene un fragmento verificable.'}</small>}
        {active === 'improvement' && moment.suggestion && <div className="moment-next"><strong>En tu próxima conversación</strong><p>{moment.suggestion}</p></div>}
      </article> : <p className="moments-empty">Este análisis todavía no incluye momentos destacados. Puedes revisar la conversación completa.</p>}
      <footer>Feedback de IA · basado en esta conversación</footer>
    </>}
  </section>;
}
