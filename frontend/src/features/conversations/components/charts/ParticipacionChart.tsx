'use client';

import { PieChart, Pie, Cell, Legend, Tooltip, ResponsiveContainer } from 'recharts';

const SPEAKER_COLORS = ['#3b82f6', '#8b5cf6', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4'];
const TOOLTIP_STYLE = {
  contentStyle: { backgroundColor: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#fff' },
  itemStyle: { color: '#fff' },
  labelStyle: { color: 'rgba(255,255,255,0.7)' },
};

interface ParticipacionChartProps {
  palabrasPorHablante: Record<string, number>;
  hablantes: string[];
}

export function ParticipacionChart({ palabrasPorHablante, hablantes }: ParticipacionChartProps) {
  const total = Object.values(palabrasPorHablante).reduce((s, v) => s + v, 0);
  if (total === 0) return null;

  const chartData = Object.entries(palabrasPorHablante).map(([name, count]) => ({
    name: `${name} (${count.toLocaleString()})`,
    value: Math.round((count / total) * 100),
    rawName: name,
  }));

  return (
    <ResponsiveContainer width="100%" height={280}>
      <PieChart>
        <Pie
          data={chartData}
          cx="50%"
          cy="50%"
          innerRadius={60}
          outerRadius={95}
          dataKey="value"
          stroke="rgba(255,255,255,0.15)"
          strokeWidth={2}
        >
          {chartData.map((entry, i) => {
            const idx = hablantes.indexOf(entry.rawName);
            const color = SPEAKER_COLORS[(idx >= 0 ? idx : i) % SPEAKER_COLORS.length];
            return <Cell key={i} fill={`${color}cc`} />;
          })}
        </Pie>
        <Legend iconSize={12} wrapperStyle={{ fontSize: 12, paddingTop: 8, color: 'rgba(255,255,255,0.7)' }} />
        <Tooltip {...TOOLTIP_STYLE} />
      </PieChart>
    </ResponsiveContainer>
  );
}
