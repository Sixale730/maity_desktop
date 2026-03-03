'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { GaugeChart } from '../charts';
import type { CommunicationFeedbackV4 } from '../../services/conversations.service';

interface ResumenHeroProps {
  feedback: CommunicationFeedbackV4;
}

function getScoreColor(score: number): string {
  if (score >= 85) return 'text-emerald-400';
  if (score >= 70) return 'text-amber-400';
  if (score >= 50) return 'text-orange-400';
  return 'text-red-400';
}

function getNivelColor(nivel: string): string {
  const l = nivel.toLowerCase();
  if (l.includes('excelente') || l.includes('sobresaliente')) return 'bg-emerald-500/20 text-emerald-300';
  if (l.includes('bueno') || l.includes('competente')) return 'bg-blue-500/20 text-blue-300';
  if (l.includes('aceptable') || l.includes('adecuado')) return 'bg-yellow-500/20 text-yellow-300';
  return 'bg-red-500/20 text-red-300';
}

export function ResumenHero({ feedback }: ResumenHeroProps) {
  const { resumen, calidad_global } = feedback;
  if (!resumen) return null;

  const score = resumen.puntuacion_global ?? calidad_global?.puntaje ?? 0;

  return (
    <Card className="bg-card border-border">
      <CardContent className="p-6">
        <div className="flex flex-wrap gap-8 items-center">
          {/* Left: Gauge + score + level */}
          <div className="w-[200px] shrink-0 flex flex-col items-center">
            <GaugeChart score={score} maxScore={100} size={200} />
            <div className="mt-2 text-center">
              <span className={`text-5xl font-extrabold ${getScoreColor(score)}`}>{score}</span>
              <p className="text-xs text-muted-foreground mt-1">de 100 puntos</p>
            </div>
            {resumen.nivel && (
              <span className={`mt-2 px-3 py-1 rounded-full text-sm font-semibold ${getNivelColor(resumen.nivel)}`}>
                {resumen.nivel}
              </span>
            )}
          </div>

          {/* Right: Description + badges */}
          <div className="flex-1 min-w-[280px]">
            {resumen.descripcion && (
              <p className="text-sm text-muted-foreground mb-4">{resumen.descripcion}</p>
            )}

            <div className="flex flex-wrap gap-3">
              {resumen.fortaleza && (
                <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20">
                  <span className="mr-1">&#10003;</span> {resumen.fortaleza}
                </Badge>
              )}
              {resumen.mejorar && (
                <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/20 hover:bg-amber-500/20">
                  <span className="mr-1">&uarr;</span> {resumen.mejorar}
                </Badge>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
