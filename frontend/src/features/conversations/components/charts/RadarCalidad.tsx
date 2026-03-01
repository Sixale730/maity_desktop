'use client';

import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ResponsiveContainer,
} from 'recharts';
import type { CalidadGlobalV4 } from '../../services/conversations.service';

const GRID_STROKE = 'rgba(255,255,255,0.1)';
const TICK_STYLE = { fill: 'rgba(255,255,255,0.6)', fontSize: 11, fontWeight: 600 };

interface RadarCalidadProps {
  calidad: CalidadGlobalV4;
}

export function RadarCalidad({ calidad }: RadarCalidadProps) {
  const c = calidad.componentes;
  const data = [
    { label: 'Claridad', value: c.claridad ?? 0 },
    { label: 'Estructura', value: c.estructura ?? 0 },
    { label: 'Persuasión', value: c.persuasion ?? 0 },
    { label: 'Propósito', value: c.proposito ?? 0 },
    { label: 'Adaptación', value: c.adaptacion ?? 0 },
    { label: 'Empatía', value: c.empatia ?? 0 },
  ];

  return (
    <ResponsiveContainer width="100%" height={260}>
      <RadarChart data={data}>
        <PolarGrid stroke={GRID_STROKE} />
        <PolarAngleAxis dataKey="label" tick={TICK_STYLE} />
        <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
        <Radar
          dataKey="value"
          stroke="#3b82f6"
          fill="#3b82f6"
          fillOpacity={0.2}
          strokeWidth={2}
        />
      </RadarChart>
    </ResponsiveContainer>
  );
}
