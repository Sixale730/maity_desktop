'use client';

/**
 * Gráfica de tendencia "Cómo va tu Comunicación" (estado D del dashboard:
 * 2+ conversaciones analizadas).
 *
 * Es el ÚNICO archivo del arranque que importa `recharts` (~345 KB), y por
 * eso vive aparte: `LazyCommunicationTrendChart` lo carga con `dynamic()`
 * sólo cuando la rama D se renderiza (#24 de la auditoría de recursos).
 * NO importar este archivo directo desde `GamifiedDashboardV2` ni desde
 * nada que entre al home — usar el wrapper Lazy.
 */

import {
  AreaChart, Area, ResponsiveContainer, YAxis,
  XAxis, CartesianGrid, Tooltip,
} from 'recharts';

export interface CommunicationTrendPoint {
  fecha: string;
  score: number;
}

export function CommunicationTrendChart({ data }: { data: CommunicationTrendPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
        <defs>
          <linearGradient id="commTrendGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ec4899" stopOpacity={0.4} />
            <stop offset="100%" stopColor="#ec4899" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#1a1a2e" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="fecha" tick={{ fontSize: 10, fill: '#6b7280' }} axisLine={false} tickLine={false} />
        <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={{ fontSize: 10, fill: '#6b7280' }} axisLine={false} tickLine={false} />
        <Tooltip
          contentStyle={{ background: '#141418', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
          labelStyle={{ color: '#a0a0b0' }}
          itemStyle={{ color: '#fff' }}
          formatter={(v) => [typeof v === 'number' ? v : 0, 'Score']}
        />
        <Area
          type="monotone"
          dataKey="score"
          stroke="#ec4899"
          strokeWidth={2.5}
          fill="url(#commTrendGrad)"
          dot={{ r: 5, fill: '#0a0a12', stroke: '#ec4899', strokeWidth: 2 }}
          activeDot={{ r: 7, fill: '#ec4899', stroke: '#fff', strokeWidth: 2 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
