'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { CommunicationFeedbackV4 } from '../../services/conversations.service';

const PRIORITY_STYLES: Record<number, string> = {
  1: 'bg-red-500/20 text-red-300',
  2: 'bg-amber-500/20 text-amber-300',
  3: 'bg-blue-500/20 text-blue-300',
};

interface RecomendacionesSectionProps {
  feedback: CommunicationFeedbackV4;
}

export function RecomendacionesSection({ feedback }: RecomendacionesSectionProps) {
  const recs = feedback.recomendaciones;
  if (!recs || recs.length === 0) return null;

  return (
    <Card className="bg-card border-border">
      <CardContent className="p-5">
        <h3 className="text-base font-bold text-foreground mb-1">Top Recomendaciones</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Acciones concretas para mejorar tu comunicación.
        </p>

        <div className="space-y-3">
          {recs.slice(0, 3).map((rec, i) => (
            <div key={i} className="rounded-lg border border-border bg-muted/30 p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg font-bold text-foreground">#{rec.prioridad ?? i + 1}</span>
                <h4 className="text-sm font-semibold text-foreground flex-1">{rec.titulo}</h4>
                <Badge className={PRIORITY_STYLES[rec.prioridad] ?? PRIORITY_STYLES[3]}>
                  P{rec.prioridad ?? i + 1}
                </Badge>
              </div>

              <p className="text-sm text-muted-foreground">{rec.texto_mejorado || rec.descripcion}</p>

              {rec.impacto && (
                <p className="text-xs text-emerald-400 mt-2">Impacto: {rec.impacto}</p>
              )}
              {rec.por_que && (
                <p className="text-xs text-muted-foreground/80 mt-1">Por qué: {rec.por_que}</p>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
