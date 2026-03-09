import { User, Bot } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { OmiTranscriptSegment } from '../../services/conversations.service';

interface TranscriptSectionProps {
  segments: OmiTranscriptSegment[] | undefined;
  loading: boolean;
  fallbackText?: string | null;
  userName?: string;
  error?: string;
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

export function TranscriptSection({ segments, loading, fallbackText, userName, error }: TranscriptSectionProps) {
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
      <div className="space-y-3 p-4">
        {segments.map((segment) => {
          const isUser = segment.is_user;
          return (
            <div
              key={segment.id}
              className={`flex gap-3 ${isUser ? '' : 'flex-row-reverse'}`}
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
