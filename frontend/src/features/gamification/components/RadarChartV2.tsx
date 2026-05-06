import { useMemo } from 'react';

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
  { key: 's1' as const,   label: 'Primera sesión', color: '#ef4444', fillOpacity: 0.18 },
  { key: 's6' as const,   label: 'Última sesión',  color: '#1bea9a', fillOpacity: 0.20 },
  { key: 'auto' as const, label: 'Autoevaluación', color: '#3b82f6', fillOpacity: 0.15 },
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
  }, [data]);

  const averages = useMemo(() => {
    if (data.length === 0) return { s1: 0, s6: 0, auto: 0 };
    const sum = (key: 's1' | 's6' | 'auto') => data.reduce((acc, d) => acc + d[key], 0);
    return {
      s1:   Math.round(sum('s1')   / data.length),
      s6:   Math.round(sum('s6')   / data.length),
      auto: Math.round(sum('auto') / data.length),
    };
  }, [data]);

  const gridLevels = [0.25, 0.5, 0.75, 1];

  return (
    <div className="relative flex flex-col items-center justify-center gap-3 w-full">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          {SERIES.map(s => (
            <filter key={s.key} id={`radarGlow-${s.key}`} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          ))}
        </defs>

        {/* Grid */}
        {gridLevels.map((level, i) => {
          const gridPoints = data.map((_, idx) => {
            const p = getPoint(100, idx, level);
            return `${p.x},${p.y}`;
          }).join(' ');
          return (
            <polygon
              key={i}
              points={gridPoints}
              fill="none"
              stroke="#2a2a3e"
              strokeWidth="1"
              opacity={0.6}
            />
          );
        })}

        {/* Axis lines */}
        {data.map((_, i) => {
          const p = getPoint(100, i);
          return (
            <line
              key={i}
              x1={center}
              y1={center}
              x2={p.x}
              y2={p.y}
              stroke="#2a2a3e"
              strokeWidth="1"
              opacity={0.6}
            />
          );
        })}

        {/* Series polygons (drawn in order: s1, s6, auto on top) */}
        {seriesPaths.map(s => (
          <polygon
            key={s.key}
            points={s.points}
            fill={s.color}
            fillOpacity={s.fillOpacity}
            stroke={s.color}
            strokeWidth="2"
            filter={`url(#radarGlow-${s.key})`}
          />
        ))}

        {/* Series dots */}
        {seriesPaths.flatMap(s =>
          data.map((d, i) => {
            const p = getPoint(d[s.key], i);
            return (
              <circle
                key={`${s.key}-${i}`}
                cx={p.x}
                cy={p.y}
                r="3.5"
                fill={s.color}
                stroke="#0a0a0f"
                strokeWidth="1.5"
              />
            );
          })
        )}

        {/* Axis labels (dimensions) */}
        {data.map((d, i) => {
          const pos = getLabelPosition(i);
          return (
            <text
              key={i}
              x={pos.x}
              y={pos.y}
              fill="#a0a0b0"
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

      {/* Legend with neon dots and averages */}
      <div className="flex items-center justify-around w-full gap-2 pt-1">
        {SERIES.map(s => (
          <div key={s.key} className="flex flex-col items-center gap-1 min-w-0">
            <span
              className="w-2.5 h-2.5 rounded-full inline-block flex-shrink-0"
              style={{
                backgroundColor: s.color,
                boxShadow: `0 0 6px ${s.color}, 0 0 12px ${s.color}80`,
              }}
            />
            <span className="text-[9px] uppercase tracking-wider font-bold text-gray-400 truncate text-center">
              {s.label}
            </span>
            <span
              className="text-xl font-extrabold leading-none"
              style={{ color: s.color, textShadow: `0 0 8px ${s.color}80` }}
            >
              {averages[s.key]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
