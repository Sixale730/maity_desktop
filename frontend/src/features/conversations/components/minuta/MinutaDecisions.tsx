'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { MinutaDecision } from '../../services/conversations.service';

const STATUS_STYLES: Record<string, string> = {
  CONFIRMADA: 'bg-emerald-500/20 text-emerald-300',
  TENTATIVA: 'bg-amber-500/20 text-amber-300',
  DIFERIDA: 'bg-red-500/20 text-red-300',
};

interface MinutaDecisionsProps {
  decisiones: MinutaDecision[];
}

export function MinutaDecisions({ decisiones }: MinutaDecisionsProps) {
  if (!decisiones || decisiones.length === 0) return null;

  return (
    <Card className="bg-card border-border">
      <CardContent className="p-5">
        <h3 className="text-base font-bold text-foreground mb-4">Decisiones</h3>

        <div className="space-y-3">
          {decisiones.map((dec, i) => {
            const status = dec.clasificacion || 'CONFIRMADA';
            return (
              <div key={i} className="rounded-lg border border-border bg-muted/30 p-3">
                <div className="flex items-start gap-2 mb-1">
                  <Badge className={STATUS_STYLES[status] ?? 'bg-muted text-muted-foreground'}>
                    {status}
                  </Badge>
                  <p className="text-sm font-medium text-foreground flex-1">
                    {dec.titulo || dec.descripcion}
                  </p>
                </div>

                {dec.decidio && (
                  <p className="text-xs text-muted-foreground">Decidió: {dec.decidio}</p>
                )}
                {dec.responsable && (
                  <p className="text-xs text-muted-foreground">Responsable: {dec.responsable}</p>
                )}
                {dec.razonamiento && (
                  <p className="text-xs text-muted-foreground mt-1">{dec.razonamiento}</p>
                )}
                {dec.cita && (
                  <blockquote className="text-xs text-muted-foreground italic border-l-2 border-muted pl-2 mt-1.5">
                    &ldquo;{dec.cita}&rdquo;
                  </blockquote>
                )}
                {dec.condiciones && status === 'TENTATIVA' && (
                  <p className="text-xs text-amber-400 mt-1">Condiciones: {dec.condiciones}</p>
                )}
                {dec.fecha_resolucion && status === 'DIFERIDA' && (
                  <p className="text-xs text-red-400 mt-1">Resolución: {dec.fecha_resolucion}</p>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
