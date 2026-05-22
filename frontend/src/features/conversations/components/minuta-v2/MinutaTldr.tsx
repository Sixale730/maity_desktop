'use client';

import { Card } from '@/components/ui/card';

interface MinutaTldrProps {
  tldr: string;
  keywords: string[];
}

export function MinutaTldr({ tldr, keywords }: MinutaTldrProps) {
  if (!tldr) return null;

  return (
    <Card className="bg-gradient-to-br from-cyan-500/5 to-emerald-500/5 border border-cyan-500/20 p-5">
      <div className="text-xs uppercase tracking-wider text-cyan-300/80 mb-2">
        En 30 segundos
      </div>
      <p className="text-base text-gray-100 leading-relaxed">{tldr}</p>

      {keywords && keywords.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {keywords.map((kw, i) => (
            <span
              key={`${kw}-${i}`}
              className="text-xs px-2 py-0.5 rounded bg-white/5 border border-white/10 text-gray-300"
            >
              {kw}
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}
