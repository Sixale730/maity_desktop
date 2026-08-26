'use client';
import { useEffect, useRef } from 'react';
import {
  Chart as ChartJS,
  RadarController,
  RadialLinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
  type ChartConfiguration,
} from 'chart.js';
import type { CalidadGlobalV4 } from './types';

ChartJS.register(
  RadarController,
  RadialLinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
);

const RADAR_COLORS = ['#10b981', '#a78bfa', '#60a5fa', '#fbbf24', '#f97316', '#f472b6'];

/** Ejes del radar, en orden. Compartido con la nota de `TuRadarCard`. */
export const RADAR_DIMENSIONES: { key: keyof CalidadGlobalV4['componentes']; label: string }[] = [
  { key: 'claridad', label: 'Claridad' },
  { key: 'estructura', label: 'Estructura' },
  { key: 'persuasion', label: 'Persuasión' },
  { key: 'proposito', label: 'Propósito' },
  { key: 'empatia', label: 'Empatía' },
  { key: 'adaptacion', label: 'Adaptación' },
];

export function RadarCalidad({ calidad }: { calidad: CalidadGlobalV4 }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<ChartJS | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const c = calidad.componentes;
    // Un eje en 0 se lee como "fallaste ahí". Las dimensiones que no aplican
    // (modo ponente, monólogo) se omiten del radar en vez de dibujarse como un
    // cero real (#74).
    const noAplica = new Set(calidad.no_aplica ?? []);
    const ejes = RADAR_DIMENSIONES.filter((d) => !noAplica.has(d.key));
    const labels = ejes.map((d) => d.label);
    const values = ejes.map((d) => c[d.key] ?? 0);

    const config: ChartConfiguration<'radar'> = {
      type: 'radar',
      data: {
        labels,
        datasets: [
          {
            data: values,
            backgroundColor: 'rgba(6,182,212,0.22)',
            borderColor: 'rgba(6,182,212,0.7)',
            borderWidth: 2,
            pointBackgroundColor: RADAR_COLORS.slice(0, labels.length),
            pointBorderColor: RADAR_COLORS.slice(0, labels.length),
            pointRadius: 7,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        layout: { padding: { top: 24, bottom: 24, left: 16, right: 16 } },
        scales: {
          r: {
            beginAtZero: true,
            max: 100,
            min: 0,
            ticks: { display: false, stepSize: 25 },
            pointLabels: {
              display: true,
              color: (ctx) => RADAR_COLORS[ctx.index % RADAR_COLORS.length],
              font: { size: 14, weight: 700 },
              callback: function (label: string, index: number) {
                const v = values[index];
                return [label, v != null ? v.toString() : ''] as unknown as string;
              },
            },
            grid: { color: 'rgba(255,255,255,0.08)' },
            angleLines: { color: 'rgba(255,255,255,0.08)' },
          },
        },
        plugins: { legend: { display: false } },
      },
    };

    chartRef.current = new ChartJS(ctx, config);
    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [calidad]);

  return (
    <div className="relative w-full max-w-[420px] mx-auto" style={{ aspectRatio: '1 / 1' }}>
      <canvas ref={canvasRef} />
    </div>
  );
}
