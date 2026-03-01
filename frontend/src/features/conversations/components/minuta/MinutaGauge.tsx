'use client';

import { GaugeChart } from '../charts';
import type { MinutaEfectividad } from '../../services/conversations.service';

interface MinutaGaugeProps {
  efectividad: MinutaEfectividad;
}

function getEtiquetaColor(score: number): string {
  if (score >= 80) return 'bg-emerald-500/20 text-emerald-300';
  if (score >= 60) return 'bg-amber-500/20 text-amber-300';
  if (score >= 40) return 'bg-orange-500/20 text-orange-300';
  return 'bg-red-500/20 text-red-300';
}

export function MinutaGauge({ efectividad }: MinutaGaugeProps) {
  return (
    <div className="flex flex-col items-center gap-3">
      <GaugeChart score={efectividad.score_global} maxScore={100} size={200} />
      {efectividad.etiqueta && (
        <span className={`px-3 py-1 rounded-full text-sm font-semibold ${getEtiquetaColor(efectividad.score_global)}`}>
          {efectividad.etiqueta}
        </span>
      )}
      {efectividad.veredicto && (
        <p className="text-sm text-muted-foreground text-center max-w-md">{efectividad.veredicto}</p>
      )}
    </div>
  );
}
