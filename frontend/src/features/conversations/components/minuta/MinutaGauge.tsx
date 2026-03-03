'use client';

import { GaugeChart } from '../charts';
import type { MinutaEfectividad } from '../../services/conversations.service';

interface MinutaGaugeProps {
  efectividad: MinutaEfectividad;
}

export function MinutaGauge({ efectividad }: MinutaGaugeProps) {
  const score = efectividad.score_global;
  const badgeColor = score >= 85 ? 'bg-emerald-500/15 text-emerald-400' : score >= 70 ? 'bg-amber-500/15 text-amber-400' : score >= 50 ? 'bg-orange-500/15 text-orange-400' : 'bg-red-500/15 text-red-400';
  const scoreColor = score >= 85 ? 'text-emerald-400' : score >= 70 ? 'text-amber-400' : score >= 50 ? 'text-orange-400' : 'text-red-400';

  return (
    <div className="bg-gradient-to-br from-slate-800 to-slate-700 rounded-xl p-6 md:p-8 text-white shadow-lg">
      <div className="flex flex-col md:flex-row gap-6 items-center">
        <div className="flex-none text-center">
          <GaugeChart score={score} maxScore={100} size={200} />
          <div className={`text-4xl md:text-5xl font-extrabold leading-none mt-2 ${scoreColor}`}>
            {score}
          </div>
          <span className={`inline-block mt-2 px-3 py-1 rounded-full text-sm font-semibold ${badgeColor}`}>
            {efectividad.etiqueta}
          </span>
          <div className="text-sm opacity-70 mt-1">Efectividad</div>
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-base leading-relaxed opacity-95">
            {efectividad.veredicto}
          </p>
        </div>
      </div>
    </div>
  );
}
