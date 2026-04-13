'use client';

/**
 * MeetingTypeBadge — Badge clickable con el tipo de reunión detectado.
 *
 * Muestra el tipo (Venta / Servicio / Webinar / Equipo / Auto) con icono y
 * color. Click abre dropdown para override manual.
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  DollarSign,
  Headphones,
  Monitor,
  Users,
  Sparkles,
  ChevronDown,
} from 'lucide-react';

export type MeetingType = 'auto' | 'sales' | 'service' | 'webinar' | 'team_meeting';

const OPTIONS: { value: MeetingType; label: string; icon: React.ReactNode; color: string }[] = [
  { value: 'auto', label: 'Auto-detectar', icon: <Sparkles className="w-3 h-3" />, color: 'text-gray-400' },
  { value: 'sales', label: 'Venta', icon: <DollarSign className="w-3 h-3" />, color: 'text-green-400' },
  { value: 'service', label: 'Servicio', icon: <Headphones className="w-3 h-3" />, color: 'text-blue-400' },
  { value: 'webinar', label: 'Webinar', icon: <Monitor className="w-3 h-3" />, color: 'text-purple-400' },
  { value: 'team_meeting', label: 'Equipo', icon: <Users className="w-3 h-3" />, color: 'text-orange-400' },
];

interface Props {
  value: MeetingType;
  onChange: (v: MeetingType) => void;
  autoDetected?: boolean;
}

export function MeetingTypeBadge({ value, onChange, autoDetected }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Cerrar al hacer click fuera
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const current = OPTIONS.find((o) => o.value === value) ?? OPTIONS[0];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded-full bg-gray-800/60 border border-gray-700/60 hover:bg-gray-700/60 transition ${current.color}`}
        title={autoDetected ? 'Tipo auto-detectado. Click para cambiar.' : 'Click para cambiar tipo.'}
      >
        {current.icon}
        <span className="font-medium">{current.label}</span>
        {autoDetected && value !== 'auto' && (
          <Sparkles className="w-2.5 h-2.5 opacity-60" aria-label="auto-detected" />
        )}
        <ChevronDown className="w-2.5 h-2.5 opacity-60" />
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1 w-36 bg-gray-900 border border-gray-700 rounded-lg shadow-xl z-50 overflow-hidden">
          {OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-gray-800 transition ${
                opt.value === value ? `${opt.color} font-semibold` : 'text-gray-300'
              }`}
            >
              {opt.icon}
              <span>{opt.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
