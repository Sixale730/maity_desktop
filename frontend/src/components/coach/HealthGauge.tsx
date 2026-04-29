'use client';

import React from 'react';

// §2.1 Gauge SVG circular 96x96 con stroke-dashoffset animado.
// Numero grande tabular-nums al centro + label "Salud" debajo.
// Color por threshold:
//   >= 70 -> verde  #1bea9a
//   >= 40 -> ambar  #f59e0b
//   <  40 -> rojo   #ff0050

const SIZE = 96;
const STROKE = 8;

function colorFor(value: number): string {
  if (value >= 70) return '#1bea9a';
  if (value >= 40) return '#f59e0b';
  return '#ff0050';
}

export interface HealthGaugeProps {
  /** Valor 0-100. Valores fuera del rango se clampean. */
  value: number;
  /** Label debajo del numero. Default "Salud". */
  label?: string;
  /** Tamaño en px. Default 96 (validado por Poncho, cabe en 320px de ancho). */
  size?: number;
  className?: string;
}

export function HealthGauge({ value, label = 'Salud', size = SIZE, className }: HealthGaugeProps) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const color = colorFor(v);
  const radius = (size - STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (v / 100) * circumference;

  return (
    <div
      className={`relative inline-flex items-center justify-center ${className ?? ''}`}
      style={{ width: size, height: size }}
      role="meter"
      aria-valuenow={v}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.1)"
          strokeWidth={STROKE}
        />
        {/* Progress (rotado -90deg para que arranque arriba) */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset 0.5s ease, stroke 0.3s ease' }}
        />
      </svg>
      {/* Numero + label centrados (absolute over svg) */}
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span
          className="font-semibold tabular-nums leading-none"
          style={{ color, fontSize: size * 0.32 }}
        >
          {v}
        </span>
        <span
          className="text-zinc-400 leading-none mt-0.5 uppercase tracking-wide"
          style={{ fontSize: size * 0.11 }}
        >
          {label}
        </span>
      </div>
    </div>
  );
}

export default HealthGauge;
