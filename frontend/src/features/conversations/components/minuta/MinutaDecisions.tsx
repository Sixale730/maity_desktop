'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { MinutaDecision } from '../../services/conversations.service';
import { getClasificacion } from '../../utils/normalize-meeting-minutes';

interface MinutaDecisionsProps {
  decisiones: MinutaDecision[];
}

const STATUS_STYLES: Record<string, { badge: string; label: string }> = {
  CONFIRMADA: { badge: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', label: 'Confirmada' },
  TENTATIVA: { badge: 'bg-amber-500/15 text-amber-400 border-amber-500/30', label: 'Tentativa' },
  DIFERIDA: { badge: 'bg-blue-500/15 text-blue-400 border-blue-500/30', label: 'Diferida' },
};

export function MinutaDecisions({ decisiones }: MinutaDecisionsProps) {
  if (!decisiones || decisiones.length === 0) {
    return (
      <Card className="bg-card border-border">
        <CardContent className="p-6">
          <p className="text-sm text-muted-foreground text-center">Sin decisiones identificadas</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card border-border">
      <CardContent className="p-6">
        <div className="space-y-3">
          {decisiones.map((decision) => {
            const clasificacion = getClasificacion(decision);
            const style = STATUS_STYLES[clasificacion] || STATUS_STYLES.TENTATIVA;
            return (
              <div
                key={decision.id}
                className="p-4 bg-muted/30 border border-border rounded-lg"
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <p className="text-sm font-medium text-foreground leading-relaxed flex-1">
                    {decision.titulo || decision.descripcion}
                  </p>
                  <Badge variant="outline" className={`shrink-0 text-xs ${style.badge}`}>
                    {style.label}
                  </Badge>
                </div>

                {decision.decidio && (
                  <p className="text-xs text-muted-foreground mb-1">
                    👤 {decision.decidio}
                  </p>
                )}
                {!decision.decidio && decision.responsable && (
                  <p className="text-xs text-muted-foreground mb-1">
                    👤 {decision.responsable}
                  </p>
                )}

                {decision.razonamiento && (
                  <p className="text-xs text-muted-foreground mb-1">
                    <span className="font-semibold text-muted-foreground">Razonamiento:</span> {decision.razonamiento}
                  </p>
                )}

                {clasificacion === 'TENTATIVA' && decision.condiciones && (
                  <p className="text-xs text-amber-400/80 mb-1">
                    <span className="font-semibold">Condiciones:</span> {decision.condiciones}
                  </p>
                )}

                {clasificacion === 'DIFERIDA' && decision.fecha_resolucion && (
                  <p className="text-xs text-blue-400/80 mb-1">
                    <span className="font-semibold">Fecha resolución:</span> {decision.fecha_resolucion}
                  </p>
                )}

                {decision.voto && (
                  <p className="text-xs text-muted-foreground mb-1">
                    <span className="font-semibold">Voto:</span> {decision.voto}
                  </p>
                )}

                {(decision.cita || decision.cita_textual) && (
                  <blockquote className="mt-2 pl-3 border-l-2 border-border text-xs text-muted-foreground italic leading-relaxed">
                    «{decision.cita || decision.cita_textual}»
                  </blockquote>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
