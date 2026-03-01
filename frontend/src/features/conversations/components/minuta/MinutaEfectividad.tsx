'use client';

import { Card, CardContent } from '@/components/ui/card';
import type { MinutaEfectividad, MinutaComponenteEfectividad } from '../../services/conversations.service';

interface MinutaEfectividadProps {
  efectividad: MinutaEfectividad;
}

function normalizeComponentes(componentes: MinutaEfectividad['componentes']): MinutaComponenteEfectividad[] {
  if (Array.isArray(componentes)) return componentes;
  // V7 format: Record<string, { valor, peso, justificacion }>
  return Object.entries(componentes).map(([nombre, val]) => ({
    nombre,
    score: val.valor,
    justificacion: val.justificacion,
    peso: val.peso,
  }));
}

function getBarColor(score: number): string {
  if (score >= 80) return 'bg-emerald-500';
  if (score >= 60) return 'bg-amber-500';
  return 'bg-red-500';
}

export function MinutaEfectividadSection({ efectividad }: MinutaEfectividadProps) {
  const componentes = normalizeComponentes(efectividad.componentes);
  if (componentes.length === 0) return null;

  return (
    <Card className="bg-card border-border">
      <CardContent className="p-5">
        <h3 className="text-base font-bold text-foreground mb-4">Desglose de Efectividad</h3>

        <div className="space-y-3">
          {componentes.map((comp) => (
            <div key={comp.nombre}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-foreground">{comp.nombre}</span>
                <span className="text-sm font-semibold text-foreground">{comp.score}</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${getBarColor(comp.score)}`}
                  style={{ width: `${Math.min(comp.score, 100)}%` }}
                />
              </div>
              {comp.justificacion && (
                <p className="text-xs text-muted-foreground mt-0.5">{comp.justificacion}</p>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
