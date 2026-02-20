import { User, Bot } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { OmiTranscriptSegment } from '../../services/conversations.service';

interface TranscriptSectionProps {
  segments: OmiTranscriptSegment[] | undefined;
  loading: boolean;
  fallbackText?: string | null;
}

export function TranscriptSection({ segments, loading, fallbackText }: TranscriptSectionProps) {
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
                    {segment.speaker || (isUser ? 'Tu' : 'Otro')}
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
