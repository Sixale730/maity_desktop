'use client';

import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';

interface GaugeChartProps {
  score: number;
  maxScore?: number;
  size?: number;
}

export function GaugeChart({ score, maxScore = 100, size = 240 }: GaugeChartProps) {
  const pct = Math.min(Math.max((score / maxScore) * 100, 0), 100);
  const color = pct >= 85 ? '#00d4aa' : pct >= 70 ? '#fbbf24' : pct >= 50 ? '#f97316' : '#ef4444';
  const data = [
    { name: 'score', value: pct },
    { name: 'rest', value: 100 - pct },
  ];

  return (
    <div className="relative" style={{ width: size, height: size * 0.58 }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="100%"
            startAngle={180}
            endAngle={0}
            innerRadius="65%"
            outerRadius="90%"
            dataKey="value"
            stroke="none"
          >
            <Cell fill={color} />
            <Cell fill="rgba(255,255,255,0.1)" />
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
