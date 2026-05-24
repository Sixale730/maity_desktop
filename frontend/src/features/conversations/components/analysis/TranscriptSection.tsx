import { useEffect, useRef, useState } from 'react';
import { User, Bot } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { OmiTranscriptSegment } from '../../services/conversations.service';

interface TranscriptSectionProps {
  segments: OmiTranscriptSegment[] | undefined;
  loading: boolean;
  fallbackText?: string | null;
  userName?: string;
  error?: string;
  /** Cuando cambia, hace scrollIntoView al segmento correspondiente y aplica
   *  un pulso cian de 2s. Sirve para el jump-to-transcript desde la minuta v2.
   *  El nonce permite re-disparar el efecto al clickear el mismo segment_ref. */
  highlightedSegment?: { index: number; nonce: number } | null;
}

const GENERIC_LABELS = new Set([
  'SPEAKER_0', 'SPEAKER_1', 'SPEAKER_2', 'SPEAKER_3',
  'SPEAKER_4', 'SPEAKER_5', 'SPEAKER_6', 'SPEAKER_7',
  'user', 'interlocutor', 'Usuario', 'Desconocido',
  'Participante 1', 'Participante 2',
]);

function resolveSpeakerLabel(segment: OmiTranscriptSegment, userName?: string): string {
  // Preserve proper names (e.g. "Julio Gonzalez")
  if (segment.speaker && !GENERIC_LABELS.has(segment.speaker)) {
    return segment.speaker;
  }
  // Label based on role
  return segment.is_user ? (userName || 'Tú') : 'Interlocutor';
}

export function TranscriptSection({
  segments,
  loading,
  fallbackText,
  userName,
  error,
  highlightedSegment,
}: TranscriptSectionProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pulseIndex, setPulseIndex] = useState<number | null>(null);
  // Recordar el ultimo nonce cumplido evita re-scrollear cuando solo cambio
  // la lista de segmentos (ej. paginacion lazy carga un chunk nuevo).
  const lastFulfilledNonceRef = useRef<number | null>(null);

  useEffect(() => {
    if (!highlightedSegment || !containerRef.current) return;
    if (lastFulfilledNonceRef.current === highlightedSegment.nonce) return;

    const target = containerRef.current.querySelector<HTMLElement>(
      `[data-segment-index="${highlightedSegment.index}"]`
    );
    if (!target) {
      // El segmento aun no esta en el DOM (probable lazy-load pendiente).
      // Cuando llegue un nuevo chunk, el effect re-corre via dep `segments`.
      console.warn(
        `[TranscriptSection] segmento ${highlightedSegment.index} no encontrado en el DOM (posible carga pendiente)`
      );
      return;
    }
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setPulseIndex(highlightedSegment.index);
    lastFulfilledNonceRef.current = highlightedSegment.nonce;
    const timer = window.setTimeout(() => setPulseIndex(null), 2000);
    return () => window.clearTimeout(timer);
  }, [highlightedSegment, segments]);

  // On error, skip loading and try fallback text
  if (error && fallbackText) {
    return (
      <div className="p-4">
        <p className="text-xs text-muted-foreground mb-3">No se pudieron cargar los segmentos. Mostrando transcripción completa.</p>
        <p className="text-sm whitespace-pre-wrap text-muted-foreground">
          {fallbackText}
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-4 p-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="h-8 w-8 rounded-full" />
            <div className="flex-1">
              <Skeleton className="h-4 w-20 mb-1" />
              <Skeleton className="h-12 w-full rounded-xl" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (segments && segments.length > 0) {
    return (
      <div ref={containerRef} className="space-y-3 p-4">
        {segments.map((segment) => {
          const isUser = segment.is_user;
          const isPulsing = pulseIndex === segment.segment_index;
          return (
            <div
              key={segment.id}
              data-segment-index={segment.segment_index}
              className={`flex gap-3 ${isUser ? '' : 'flex-row-reverse'} rounded-md transition-colors duration-700 ${
                isPulsing ? 'bg-cyan-500/10 ring-1 ring-cyan-500/30 -mx-2 px-2 py-1' : ''
              }`}
            >
              {/* Avatar */}
              <div
                className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                  isUser ? 'bg-emerald-500/20' : 'bg-muted'
                }`}
              >
                {isUser ? (
                  <User className="h-4 w-4 text-emerald-500" />
                ) : (
                  <Bot className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
              {/* Bubble */}
              <div className={`max-w-[75%] ${isUser ? '' : 'text-right'}`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-medium text-foreground">
                    {resolveSpeakerLabel(segment, userName)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {Math.floor(segment.start_time / 60)}:
                    {Math.floor(segment.start_time % 60)
                      .toString()
                      .padStart(2, '0')}
                  </span>
                </div>
                <div
                  className={`inline-block rounded-2xl px-4 py-2 text-sm ${
                    isUser
                      ? 'bg-emerald-500/10 border border-emerald-500/20 text-foreground'
                      : 'bg-muted border border-border text-foreground'
                  }`}
                >
                  {segment.text}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  if (fallbackText) {
    return (
      <p className="text-sm whitespace-pre-wrap text-muted-foreground p-4">
        {fallbackText}
      </p>
    );
  }

  return (
    <p className="text-sm text-muted-foreground text-center py-8">
      Sin transcripcion disponible
    </p>
  );
}
