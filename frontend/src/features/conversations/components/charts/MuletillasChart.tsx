'use client';

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

const TOOLTIP_STYLE = {
  contentStyle: { backgroundColor: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#fff' },
  itemStyle: { color: '#fff' },
  labelStyle: { color: 'rgba(255,255,255,0.7)' },
};
const TICK_STYLE = { fill: 'rgba(255,255,255,0.6)' };

interface MuletillasChartProps {
  detalle: Record<string, number>;
  maxItems?: number;
}

export function MuletillasChart({ detalle, maxItems = 8 }: MuletillasChartProps) {
  const sorted = Object.entries(detalle)
    .sort(([, a], [, b]) => b - a)
    .slice(0, maxItems);

  if (sorted.length === 0) return null;

  const chartData = sorted.map(([word, count]) => ({
    name: `"${word}"`,
    count,
  }));

  const maxCount = Math.max(...sorted.map(([, c]) => c));

  return (
    <ResponsiveContainer width="100%" height={Math.max(sorted.length * 40, 120)}>
      <BarChart data={chartData} layout="vertical" margin={{ left: 10, right: 20 }}>
        <XAxis type="number" tick={{ fontSize: 11, ...TICK_STYLE }} />
        <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fontWeight: 600, ...TICK_STYLE }} width={80} />
        <Tooltip {...TOOLTIP_STYLE} />
        <Bar dataKey="count" radius={[0, 6, 6, 0]} barSize={18}>
          {chartData.map((item, i) => (
            <Cell key={i} fill={`rgba(251, 191, 36, ${0.4 + (item.count / maxCount) * 0.6})`} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
