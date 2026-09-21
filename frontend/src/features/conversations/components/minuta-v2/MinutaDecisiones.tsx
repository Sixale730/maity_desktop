'use client';

import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ExternalLink } from 'lucide-react';
import type { MinutaV2Decision } from '@/features/conversations/services/conversations.service';

interface MinutaDecisionesProps {
  decisiones: MinutaV2Decision[];
  onJumpToSegment?: (segmentIndex: number) => void;
}

export function MinutaDecisiones({ decisiones, onJumpToSegment }: MinutaDecisionesProps) {
  if (!decisiones || decisiones.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-xs uppercase tracking-wider text-muted-foreground px-1">
        Decisiones{' '}
        <span className="text-muted-foreground/70 normal-case font-normal">({decisiones.length})</span>
      </h2>

      <div className="space-y-2">
        {decisiones.map((d) => (
          <Card key={d.id} className="bg-card border border-border p-4">
            <div className="flex items-start justify-between gap-3 mb-1">
              <h3 className="text-sm font-medium text-foreground leading-snug">{d.titulo}</h3>
              {d.estado !== 'confirmada' && (
                <Badge
                  variant="outline"
                  className={
                    d.estado === 'tentativa'
                      ? 'border-amber-500/40 text-amber-700 dark:text-amber-300 bg-amber-500/10 text-xs shrink-0'
                      : 'border-border text-muted-foreground bg-muted text-xs shrink-0'
                  }
                >
                  {d.estado === 'tentativa' ? 'Tentativa' : 'Diferida'}
                </Badge>
              )}
            </div>

            {d.descripcion && (
              <p className="text-sm text-muted-foreground leading-relaxed">{d.descripcion}</p>
            )}

            <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              {d.decidio && (
                <span className="text-muted-foreground">
                  <span className="text-muted-foreground/70">Decidió:</span>{' '}
                  <span className="text-foreground/80">{d.decidio}</span>
                </span>
              )}
              {d.condiciones && (
                <span className="text-muted-foreground">
                  <span className="text-muted-foreground/70">Condiciones:</span>{' '}
                  <span className="text-amber-700 dark:text-amber-200/80">{d.condiciones}</span>
                </span>
              )}
              {d.fecha_resolucion && (
                <span className="text-muted-foreground">
                  <span className="text-muted-foreground/70">Fecha de resolución:</span>{' '}
                  <span className="text-foreground">{d.fecha_resolucion}</span>
                </span>
              )}
            </div>

            {d.cita && (
              <p className="mt-2.5 text-xs italic text-muted-foreground border-l-2 border-border pl-2.5">
                «{d.cita}»
              </p>
            )}

            {d.segment_ref != null && onJumpToSegment && (
              <button
                type="button"
                onClick={() => onJumpToSegment(d.segment_ref!)}
                className="mt-2.5 inline-flex items-center gap-1 text-xs text-cyan-700 dark:text-cyan-400/80 hover:text-cyan-800 dark:hover:text-cyan-300 transition-colors"
              >
                <ExternalLink className="h-3 w-3" />
                Ver en transcripción
              </button>
            )}
          </Card>
        ))}
      </div>
    </section>
  );
}
