'use client';

/**
 * ConnectionThermometer — Termómetro visual gamificado del estado de la conversación.
 *
 * Muestra un score 0-100 calculado client-side desde las métricas de transcript:
 * - Talk ratio ideal (35-65%)
 * - Uso del nombre del cliente
 * - Preguntas abiertas del usuario
 * - Monólogos cortos (<60s)
 * - Empatía detectada
 *
 * Diseño peripheral-vision: el usuario capta color + emoji sin leer.
 */

import React from 'react';
import { motion } from 'framer-motion';

export interface ConnectionZone {
  min: number;
  max: number;
  label: string;
  color: string; // tailwind bg class
  textColor: string;
  emoji: string;
}

const ZONES: ConnectionZone[] = [
  { min: 0, max: 29, label: 'Frío', color: 'bg-red-500', textColor: 'text-red-300', emoji: '❄️' },
  { min: 30, max: 49, label: 'Tibio', color: 'bg-orange-500', textColor: 'text-orange-300', emoji: '🌡️' },
  { min: 50, max: 69, label: 'Cálido', color: 'bg-yellow-400', textColor: 'text-yellow-300', emoji: '👍' },
  { min: 70, max: 89, label: 'Caliente', color: 'bg-green-500', textColor: 'text-green-300', emoji: '🔥' },
  { min: 90, max: 100, label: 'En llamas', color: 'bg-blue-400', textColor: 'text-blue-300', emoji: '⚡' },
];

export function getZone(score: number): ConnectionZone {
  return ZONES.find((z) => score >= z.min && score <= z.max) ?? ZONES[0];
}

interface Props {
  score: number; // 0-100
  trend: 'rising' | 'falling' | 'stable';
}

export function ConnectionThermometer({ score, trend }: Props) {
  const zone = getZone(score);
  const pct = Math.max(0, Math.min(100, score));

  const trendIcon = trend === 'rising' ? '↗' : trend === 'falling' ? '↘' : '→';
  const trendColor =
    trend === 'rising' ? 'text-green-400' : trend === 'falling' ? 'text-red-400' : 'text-gray-400';

  return (
    <div className="px-4 py-3 border-b border-gray-800 bg-gray-900/60">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-2xl leading-none" aria-hidden="true">
            {zone.emoji}
          </span>
          <div className="flex flex-col">
            <span className={`text-xs font-semibold uppercase tracking-wide ${zone.textColor}`}>
              {zone.label}
            </span>
            <span className="text-[9px] text-gray-500">Conexión</span>
          </div>
        </div>
        <div className="flex items-baseline gap-1">
          <span className={`text-2xl font-bold font-mono ${zone.textColor}`}>{Math.round(pct)}</span>
          <span className="text-[10px] text-gray-500">/100</span>
          <span className={`text-xs ml-1 ${trendColor}`} title={`tendencia: ${trend}`}>
            {trendIcon}
          </span>
        </div>
      </div>

      {/* Barra con gradiente + marker */}
      <div className="relative h-2 rounded-full bg-gray-800 overflow-hidden">
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: 'linear-gradient(90deg, #ef4444 0%, #f97316 25%, #facc15 50%, #22c55e 75%, #60a5fa 100%)',
            opacity: 0.25,
          }}
        />
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ type: 'spring', stiffness: 80, damping: 18 }}
          className={`absolute inset-y-0 left-0 rounded-full ${zone.color}`}
        />
      </div>
    </div>
  );
}
