'use client';

import { Card, CardContent } from '@/components/ui/card';
import type { MinutaComponenteEfectividad } from '../../services/conversations.service';

interface MinutaEfectividadProps {
  componentes: MinutaComponenteEfectividad[];
}

function getBarColor(score: number): string {
  if (score >= 80) return 'bg-emerald-500';
  if (score >= 60) return 'bg-amber-500';
  return 'bg-red-500';
}

function getTextColor(score: number): string {
  if (score >= 80) return 'text-emerald-400';
  if (score >= 60) return 'text-amber-400';
  return 'text-red-400';
}

export function MinutaEfectividad({ componentes }: MinutaEfectividadProps) {
  if (!componentes || componentes.length === 0) {
    return (
      <Card className="bg-card border-border">
        <CardContent className="p-6">
          <p className="text-sm text-muted-foreground text-center">Sin datos de efectividad</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card border-border">
      <CardContent className="p-6">
        <div className="space-y-4">
          {componentes.map((comp) => (
            <div key={comp.nombre}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-medium text-foreground">
                  {comp.nombre}
                  {comp.peso != null && (
                    <span className="text-xs text-muted-foreground ml-1.5">
                      (peso {Math.round(comp.peso * 100)}%)
                    </span>
                  )}
                </span>
                <span className={`text-lg font-bold ${getTextColor(comp.score)}`}>{comp.score}</span>
              </div>
              <div className="h-2.5 bg-muted rounded-full overflow-hidden mb-1.5">
                <div
                  className={`h-full rounded-full ${getBarColor(comp.score)} transition-all duration-700`}
                  style={{ width: `${Math.min(comp.score, 100)}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {comp.justificacion}
              </p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
