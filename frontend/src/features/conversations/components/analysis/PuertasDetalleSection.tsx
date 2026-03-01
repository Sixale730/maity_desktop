'use client';

import { Card, CardContent } from '@/components/ui/card';
import type { CommunicationFeedbackV4 } from '../../services/conversations.service';

const ESTADO_STYLES: Record<string, { icon: string; color: string }> = {
  abierta: { icon: '🚪', color: 'border-emerald-500/30 bg-emerald-500/5' },
  explorada: { icon: '✅', color: 'border-blue-500/30 bg-blue-500/5' },
  'no explorada': { icon: '⚠️', color: 'border-amber-500/30 bg-amber-500/5' },
  cerrada: { icon: '🔒', color: 'border-red-500/30 bg-red-500/5' },
  entreabierta: { icon: '🚪', color: 'border-yellow-500/30 bg-yellow-500/5' },
};

interface PuertasDetalleSectionProps {
  feedback: CommunicationFeedbackV4;
}

export function PuertasDetalleSection({ feedback }: PuertasDetalleSectionProps) {
  const puertas = feedback.radiografia?.puertas_detalle;
  if (!puertas || puertas.length === 0) return null;

  return (
    <Card className="bg-card border-border">
      <CardContent className="p-5">
        <h3 className="text-base font-bold text-foreground mb-1">Puertas Emocionales</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Momentos de vulnerabilidad donde alguien abrió un espacio emocional.
        </p>

        <div className="space-y-3">
          {puertas.map((puerta, i) => {
            const estado = puerta.explorada ? 'explorada' : 'no explorada';
            const style = ESTADO_STYLES[estado] ?? ESTADO_STYLES['cerrada'];

            return (
              <div key={i} className={`rounded-lg border p-4 ${style.color}`}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-lg">{style.icon}</span>
                  <span className="text-sm font-semibold text-foreground">{puerta.quien}</span>
                  <span className="text-xs text-muted-foreground ml-auto">min {puerta.minuto}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    puerta.explorada ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'
                  }`}>
                    {puerta.explorada ? 'Explorada' : 'No explorada'}
                  </span>
                </div>

                {puerta.cita && (
                  <blockquote className="text-sm text-muted-foreground italic border-l-2 border-muted pl-3 mb-2">
                    &ldquo;{puerta.cita}&rdquo;
                  </blockquote>
                )}

                {puerta.respuesta && (
                  <p className="text-xs text-muted-foreground">
                    <strong>Respuesta:</strong> {puerta.respuesta}
                  </p>
                )}

                {puerta.alternativa && !puerta.explorada && (
                  <p className="text-xs text-emerald-400 mt-1">💡 {puerta.alternativa}</p>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
