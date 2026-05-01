'use client';
import { useEffect, useRef } from 'react';
import {
  Chart as ChartJS,
  ArcElement,
  DoughnutController,
  Tooltip,
  Legend,
  type ChartConfiguration,
} from 'chart.js';

ChartJS.register(DoughnutController, ArcElement, Tooltip, Legend);

interface GaugeChartProps {
  score: number;
  maxScore?: number;
  size?: number;
}

export function GaugeChart({ score, maxScore = 100, size = 200 }: GaugeChartProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<ChartJS | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const pct = Math.min(Math.max((score / maxScore) * 100, 0), 100);
    const color = pct >= 70 ? '#22c55e' : pct >= 40 ? '#eab308' : '#ef4444';

    const config: ChartConfiguration<'doughnut'> = {
      type: 'doughnut',
      data: {
        datasets: [
          {
            data: [pct, 100 - pct],
            backgroundColor: [color, 'rgba(255,255,255,0.1)'],
            borderWidth: 0,
            circumference: 180,
            rotation: 270,
          },
        ],
      },
      options: {
        responsive: false,
        maintainAspectRatio: false,
        cutout: '75%',
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false },
        },
      },
    };

    chartRef.current = new ChartJS(ctx, config);
    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [score, maxScore]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size * 0.6}
      style={{ width: size, height: size * 0.6 }}
    />
  );
}
