'use client';
/**
 * Radar "IA vs Autoevaluación" del dashboard — SVG propio (SIN recharts: entra
 * al home en el arranque, #24 de la auditoría de recursos).
 *
 * Recoloreado sep-2026 para la paridad con la web (Sixale730/maity@3ef2914
 * `gamified-v2/RadarChart.tsx`): mismos colores por serie vía `--radar-*`
 * (`radar-palette.css`, cambian con el tema claro/oscuro), mismo trazo
 * (primera sesión punteada, autoevaluación a rayas), sin glow, y la misma DOM
 * de leyenda (`maity-radar-colors` / `maity-radar-plot` / `maity-radar-legend`)
 * para que el CSS portado (`dashboard-unified.css`, `dashboard-fit.css`) aplique igual.
 * El color va en CSS (`radar-v2.css`), no en atributos de presentación del SVG:
 * `fill="var(--x)"` no resuelve variables.
 */
import { useMemo } from 'react';
import '@/features/dashboard/components/gamified-v2/radar-palette.css';
import './radar-v2.css';

export interface RadarSeriesPoint {
  name: string;
  color: string;
  s1: number;
  s6: number;
  auto: number;
}

interface RadarChartProps {
  data: RadarSeriesPoint[];
  size?: number;
}

const SERIES = [
  { key: 's1' as const, label: 'Primera sesión', color: 'var(--radar-first)' },
  { key: 's6' as const, label: 'Última sesión', color: 'var(--radar-last)' },
  { key: 'auto' as const, label: 'Autoevaluación', color: 'var(--radar-self)' },
];

export function RadarChartV2({ data, size = 220 }: RadarChartProps) {
  const center = size / 2;
  const radius = (size / 2) - 50;
  const angleSlice = data.length > 0 ? (Math.PI * 2) / data.length : 0;

  const getPoint = (value: number, index: number, scale = 1) => {
    const angle = index * angleSlice - Math.PI / 2;
    const r = (value / 100) * radius * scale;
    return {
      x: center + r * Math.cos(angle),
      y: center + r * Math.sin(angle),
    };
  };

  const getLabelPosition = (index: number) => {
    const angle = index * angleSlice - Math.PI / 2;
    const labelRadius = radius + 28;
    return {
      x: center + labelRadius * Math.cos(angle),
      y: center + labelRadius * Math.sin(angle),
    };
  };

  const seriesPaths = useMemo(() => {
    return SERIES.map(s => ({
      ...s,
      points: data.map((d, i) => getPoint(d[s.key], i)).map(p => `${p.x},${p.y}`).join(' '),
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, size]);

  const averages = useMemo(() => {
    if (data.length === 0) return { s1: 0, s6: 0, auto: 0 };
    const sum = (key: 's1' | 's6' | 'auto') => data.reduce((acc, d) => acc + d[key], 0);
    return {
      s1: Math.round(sum('s1') / data.length),
      s6: Math.round(sum('s6') / data.length),
      auto: Math.round(sum('auto') / data.length),
    };
  }, [data]);

  const gridLevels = [0.25, 0.5, 0.75, 1];

  return (
    <div className="maity-radar-colors radar-v2 flex flex-col items-center gap-4 w-full">
      <div className="w-full maity-radar-plot" style={{ height: size }}>
        <svg width="100%" height="100%" viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Radar de habilidades">
          {/* Grid */}
          {gridLevels.map((level, i) => (
            <polygon
              key={i}
              className="radar-v2-grid"
              points={data.map((_, idx) => {
                const p = getPoint(100, idx, level);
                return `${p.x},${p.y}`;
              }).join(' ')}
            />
          ))}

          {/* Axis lines */}
          {data.map((_, i) => {
            const p = getPoint(100, i);
            return <line key={i} className="radar-v2-grid" x1={center} y1={center} x2={p.x} y2={p.y} />;
          })}

          {/* Series polygons (s1, s6, auto on top) */}
          {seriesPaths.map(s => (
            <polygon key={s.key} className={`radar-v2-area radar-v2-${s.key}`} points={s.points} />
          ))}

          {/* Series dots */}
          {seriesPaths.flatMap(s =>
            data.map((d, i) => {
              const p = getPoint(d[s.key], i);
              return <circle key={`${s.key}-${i}`} className={`radar-v2-dot radar-v2-${s.key}`} cx={p.x} cy={p.y} r="3.5" />;
            })
          )}

          {/* Axis labels (dimensions) */}
          {data.map((d, i) => {
            const pos = getLabelPosition(i);
            return (
              <text
                key={i}
                className="radar-v2-label"
                x={pos.x}
                y={pos.y}
                fontSize="11"
                fontWeight="700"
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {d.name}
              </text>
            );
          })}
        </svg>
      </div>

      {/* Comparison legend (misma DOM que la web) */}
      <div className="maity-radar-legend flex items-center justify-around w-full gap-2 pt-2">
        {SERIES.map(({ key, label, color }) => (
          <div key={key} className="flex flex-col items-center gap-1.5 min-w-0">
            <span className="w-3 h-3 rounded-full inline-block flex-shrink-0" style={{ backgroundColor: color }} />
            <span className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground truncate text-center">
              {label}
            </span>
            <span className="text-2xl font-extrabold leading-none" style={{ color }}>
              {averages[key]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
