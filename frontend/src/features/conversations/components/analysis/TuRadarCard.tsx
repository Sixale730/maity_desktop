'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { RadarCalidad } from '../charts';
import type { CommunicationFeedbackV4 } from '../../services/conversations.service';

interface TuRadarCardProps {
  feedback: CommunicationFeedbackV4;
}

function getScoreColor(score: number): string {
  if (score >= 75) return '#00d4aa';
  if (score >= 50) return '#fbbf24';
  return '#ef4444';
}

export function TuRadarCard({ feedback }: TuRadarCardProps) {
  const { calidad_global } = feedback;
  if (!calidad_global) return null;

  const scoreColor = getScoreColor(calidad_global.puntaje);

  return (
    <Card className="bg-card border-border">
      <CardContent className="p-5">
        <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-1">
          Tu Radar de Calidad
        </h3>
        {calidad_global.que_mide && (
          <p className="text-sm text-muted-foreground mb-4">{calidad_global.que_mide}</p>
        )}
        {!calidad_global.que_mide && (
          <p className="text-sm text-muted-foreground mb-4">
            6 componentes que definen la calidad de tu comunicación.
          </p>
        )}

        {/* Radar with score overlay */}
        <div className="relative w-full">
          <RadarCalidad calidad={calidad_global} />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center">
              <span className="text-4xl font-extrabold" style={{ color: scoreColor }}>
                {calidad_global.puntaje}
              </span>
              {calidad_global.nivel && (
                <p className="text-xs text-muted-foreground mt-0.5">{calidad_global.nivel}</p>
              )}
            </div>
          </div>
        </div>

        {/* Badges centered below radar */}
        <div className="flex justify-center gap-2 mt-3">
          {calidad_global.fortaleza && (
            <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20">
              &#10003; {calidad_global.fortaleza}
            </Badge>
          )}
          {calidad_global.mejorar && (
            <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/20 hover:bg-amber-500/20">
              &uarr; {calidad_global.mejorar}
            </Badge>
          )}
        </div>

        {/* tu_resultado */}
        {calidad_global.tu_resultado && (
          <p className="text-xs text-muted-foreground text-center mt-3">{calidad_global.tu_resultado}</p>
        )}
      </CardContent>
    </Card>
  );
}
