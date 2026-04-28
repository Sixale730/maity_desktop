'use client';

import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Sparkles, ExternalLink } from 'lucide-react';
import { useCoachTips } from '@/hooks/useCoachTips';

const priorityColor = (priority: string) => {
  switch (priority) {
    case 'critical': return 'text-red-400';
    case 'important': return 'text-amber-400';
    default: return 'text-emerald-400';
  }
};

export function LiveFeedbackPanel() {
  const { tips } = useCoachTips(3);

  const openFloat = () => {
    invoke('open_floating_coach').catch(console.error);
  };

  // Más reciente primero para el stack visual
  const visibleTips = [...tips].reverse();

  return (
    <div className="rounded-xl border border-border bg-card/50 p-3 space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          <span className="text-xs font-medium text-muted-foreground">Coach activo</span>
        </div>
        <button
          onClick={openFloat}
          title="Abrir ventana flotante"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          <span>Flotar</span>
        </button>
      </div>

      {/* Stack de tips — más reciente arriba con más opacidad */}
      {visibleTips.length > 0 ? (
        <div className="space-y-2">
          {visibleTips.map((tip, idx) => {
            const isLatest = idx === 0;
            return (
              <div
                key={`${tip.timestamp_secs}-${idx}`}
                className={`transition-opacity ${isLatest ? 'opacity-100' : 'opacity-40'}`}
              >
                <div className="flex items-start gap-2">
                  <Sparkles
                    className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${isLatest ? priorityColor(tip.priority) : 'text-muted-foreground'}`}
                  />
                  <p className={`text-sm leading-snug ${isLatest ? 'text-foreground' : 'text-muted-foreground'}`}>
                    {tip.tip}
                  </p>
                </div>
                {isLatest && (
                  <div className="pl-5 mt-0.5">
                    <span className="text-xs text-muted-foreground/60 capitalize">{tip.category}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground/60 pl-4">
          Esperando señal conversacional…
        </p>
      )}
    </div>
  );
}
