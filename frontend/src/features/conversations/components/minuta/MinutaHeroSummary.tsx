'use client';

import { Card, CardContent } from '@/components/ui/card';
import type { MinutaMeta, MinutaTema } from '../../services/conversations.service';

interface MinutaHeroSummaryProps {
  meta: MinutaMeta;
  temas: MinutaTema[];
}

export function MinutaHeroSummary({ meta, temas }: MinutaHeroSummaryProps) {
  const firstTemaResumen = temas[0]?.resumen;
  const temasResumen = temas.slice(0, 3).map(t => t.nombre || t.titulo).join(' · ');

  return (
    <Card className="bg-card border-border">
      <CardContent className="p-6">
        <div className="flex items-start gap-3 mb-3">
          <span className="text-2xl">⚡</span>
          <div>
            <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">
              En 30 segundos
            </h3>
            <h2 className="text-lg font-bold text-foreground mt-1">
              {meta.titulo}
            </h2>
          </div>
        </div>

        {firstTemaResumen && (
          <p className="text-sm text-muted-foreground leading-relaxed mb-3">
            {firstTemaResumen}
          </p>
        )}

        {temasResumen && (
          <div className="text-xs text-muted-foreground/70">
            <span className="font-semibold text-muted-foreground">Temas cubiertos:</span>{' '}
            {temasResumen}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
