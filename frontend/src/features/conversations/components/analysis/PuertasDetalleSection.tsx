'use client';

import { Card } from '@/components/ui/card';
import type { CommunicationFeedbackV4 } from '../../services/conversations.service';

interface PuertasDetalleSectionProps {
  feedback: CommunicationFeedbackV4;
}

export function PuertasDetalleSection({ feedback }: PuertasDetalleSectionProps) {
  const puertas = feedback.radiografia?.puertas_detalle;
  const stats = feedback.radiografia?.puertas_emocionales;
  if (!puertas || puertas.length === 0) return null;

  return (
    <div>
      <h3 className="text-base font-bold text-foreground mb-1">Puertas Emocionales</h3>
      <p className="text-sm text-muted-foreground mb-4">
        Momentos de vulnerabilidad donde alguien abrió un espacio emocional.
      </p>

      {/* Stats grid */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <Card className="bg-card border-border p-4 text-center">
            <div className="text-2xl font-extrabold text-foreground">{stats.momentos_vulnerabilidad}</div>
            <div className="text-xs text-muted-foreground mt-1">Momentos de vulnerabilidad</div>
          </Card>
          <Card className="bg-card border-border p-4 text-center">
            <div className="text-2xl font-extrabold text-foreground">{stats.abiertas}</div>
            <div className="text-xs text-muted-foreground mt-1">Abiertas</div>
          </Card>
          <Card className="bg-card border-border p-4 text-center">
            <div className="text-2xl font-extrabold text-emerald-400">{stats.exploradas}</div>
            <div className="text-xs text-muted-foreground mt-1">Exploradas</div>
          </Card>
          <Card className="bg-card border-border p-4 text-center">
            <div className="text-2xl font-extrabold text-amber-400">{stats.no_exploradas}</div>
            <div className="text-xs text-muted-foreground mt-1">No exploradas</div>
          </Card>
        </div>
      )}

      <div className="space-y-3">
        {puertas.map((puerta, i) => {
          const borderColor = puerta.explorada ? 'border-l-emerald-500' : 'border-l-amber-500';

          return (
            <div key={i} className={`rounded-lg border border-border bg-card p-4 border-l-[4px] ${borderColor}`}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">{puerta.explorada ? '✅' : '⚠️'}</span>
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
    </div>
  );
}
