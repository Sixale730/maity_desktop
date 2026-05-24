'use client';

import { Card } from '@/components/ui/card';
import { ChevronRight } from 'lucide-react';
import type { MinutaV2Chapter } from '@/features/conversations/services/conversations.service';

interface MinutaChaptersProps {
  chapters: MinutaV2Chapter[];
  onJumpToSegment?: (segmentIndex: number) => void;
}

export function MinutaChapters({ chapters, onJumpToSegment }: MinutaChaptersProps) {
  if (!chapters || chapters.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-xs uppercase tracking-wider text-gray-500 px-1">Capítulos</h2>

      <div className="space-y-2.5">
        {chapters.map((chapter) => {
          const canJumpChapter = chapter.start_segment != null && !!onJumpToSegment;
          const headingContent = (
            <>
              <h3 className="text-base font-medium text-gray-100 group-hover:text-cyan-300 transition-colors">
                {chapter.titulo}
              </h3>
              {chapter.start_time_sec != null && (
                <span className="text-xs font-mono text-gray-500 group-hover:text-cyan-400/70 shrink-0 transition-colors">
                  {formatTimestamp(chapter.start_time_sec)}
                </span>
              )}
            </>
          );

          return (
          <Card key={chapter.id} className="bg-card border border-white/10 p-4">
            {canJumpChapter ? (
              <button
                type="button"
                onClick={() => onJumpToSegment!(chapter.start_segment!)}
                className="group w-full flex items-baseline justify-between gap-3 mb-3 -mx-1 px-1 py-0.5 rounded text-left hover:bg-white/5 transition-colors"
              >
                {headingContent}
              </button>
            ) : (
              <div className="flex items-baseline justify-between gap-3 mb-3">
                {headingContent}
              </div>
            )}

            <ul className="space-y-2">
              {(chapter.bullets ?? []).map((bullet, i) => {
                const canJump = bullet.segment_ref != null && !!onJumpToSegment;
                const content = (
                  <>
                    <span className="text-cyan-400/60 mt-1 shrink-0">•</span>
                    <span className="flex-1 text-sm text-gray-300 leading-relaxed">
                      {bullet.texto}
                    </span>
                    {canJump && (
                      <ChevronRight className="h-3.5 w-3.5 text-gray-600 group-hover:text-cyan-400 shrink-0 mt-1 transition-colors" />
                    )}
                  </>
                );

                return canJump ? (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => onJumpToSegment(bullet.segment_ref!)}
                      className="group w-full flex items-start gap-2 text-left rounded -mx-1 px-1 py-0.5 hover:bg-white/5 transition-colors"
                    >
                      {content}
                    </button>
                  </li>
                ) : (
                  <li key={i} className="flex items-start gap-2">
                    {content}
                  </li>
                );
              })}
            </ul>
          </Card>
          );
        })}
      </div>
    </section>
  );
}

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
