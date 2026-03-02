import { useMemo } from 'react';
import { Competency } from '../hooks/useGamifiedDashboardDataV2';

interface RadarChartProps {
  data: Competency[];
  size?: number;
}

export function RadarChartV2({ data, size = 220 }: RadarChartProps) {
  const center = size / 2;
  const radius = (size / 2) - 50;
  const angleSlice = (Math.PI * 2) / data.length;

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
    const labelRadius = radius + 35;
    return {
      x: center + labelRadius * Math.cos(angle),
      y: center + labelRadius * Math.sin(angle),
    };
  };

  const points = useMemo(() => {
    return data.map((d, i) => getPoint(d.value, i)).map(p => `${p.x},${p.y}`).join(' ');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const gridLevels = [0.25, 0.5, 0.75, 1];

  const average = useMemo(() => {
    const sum = data.reduce((acc, d) => acc + d.value, 0);
    return Math.round(sum / data.length);
  }, [data]);

  return (
    <div className="relative flex flex-col items-center justify-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <linearGradient id="radarFillV2" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#1bea9a" stopOpacity={0.4} />
            <stop offset="100%" stopColor="#485df4" stopOpacity={0.4} />
          </linearGradient>
          <filter id="radarGlowV2">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
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

        {/* Data polygon */}
        <polygon
          points={points}
          fill="url(#radarFillV2)"
          stroke="#1bea9a"
          strokeWidth="2.5"
          filter="url(#radarGlowV2)"
        />

        {/* Data points */}
        {data.map((d, i) => {
          const p = getPoint(d.value, i);
          return (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r="5"
              fill={d.color}
              stroke="#0a0a0f"
              strokeWidth="2"
            />
          );
        })}

        {/* Labels */}
        {data.map((d, i) => {
          const pos = getLabelPosition(i);
          return (
            <g key={i}>
              <text
                x={pos.x}
                y={pos.y - 6}
                fill={d.color}
                fontSize="10"
                fontWeight="700"
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {d.name}
              </text>
              <text
                x={pos.x}
                y={pos.y + 8}
                fill="#ffffff"
                fontSize="11"
                fontWeight="800"
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {d.value}
              </text>
            </g>
          );
        })}

        {/* Center average */}
        <circle cx={center} cy={center} r="28" fill="#0a0a12" stroke="#2a2a3e" strokeWidth="1" />
        <text x={center} y={center - 5} fill="#ffffff" fontSize="20" fontWeight="bold" textAnchor="middle" dominantBaseline="middle">
          {average}
        </text>
        <text x={center} y={center + 10} fill="#6b7280" fontSize="7" textAnchor="middle" dominantBaseline="middle" className="uppercase">
          PROMEDIO
        </text>
      </svg>
    </div>
  );
}
