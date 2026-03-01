'use client';

import { Card, CardContent } from '@/components/ui/card';
import { RadarCalidad } from '../charts';
import type { CommunicationFeedbackV4 } from '../../services/conversations.service';

interface TuRadarCardProps {
  feedback: CommunicationFeedbackV4;
}

export function TuRadarCard({ feedback }: TuRadarCardProps) {
  const { calidad_global } = feedback;
  if (!calidad_global) return null;

  return (
    <Card className="bg-card border-border">
      <CardContent className="p-5">
        <h3 className="text-base font-bold text-foreground mb-1">Tu Radar de Calidad</h3>
        <p className="text-sm text-muted-foreground mb-4">
          6 componentes que definen la calidad de tu comunicación.
        </p>

        <div className="flex flex-col md:flex-row gap-4 items-center">
          <div className="flex-1 w-full">
            <RadarCalidad calidad={calidad_global} />
          </div>

          <div className="flex-1 space-y-3">
            <div className="text-center md:text-left">
              <span className="text-3xl font-bold text-foreground">{calidad_global.puntaje}</span>
              <span className="text-sm text-muted-foreground ml-1">/ 100</span>
              {calidad_global.nivel && (
                <span className="ml-2 text-xs px-2 py-0.5 rounded bg-primary/10 text-primary">{calidad_global.nivel}</span>
              )}
            </div>

            {calidad_global.tu_resultado && (
              <p className="text-sm text-muted-foreground">{calidad_global.tu_resultado}</p>
            )}

            <div className="flex flex-wrap gap-2">
              {calidad_global.fortaleza && (
                <span className="text-xs px-2 py-1 rounded bg-emerald-500/10 text-emerald-400">
                  ✓ {calidad_global.fortaleza}
                </span>
              )}
              {calidad_global.mejorar && (
                <span className="text-xs px-2 py-1 rounded bg-amber-500/10 text-amber-400">
                  ↑ {calidad_global.mejorar}
                </span>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
