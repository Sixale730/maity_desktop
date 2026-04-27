'use client';

import React, { useEffect, useState, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { Sparkles, ExternalLink } from 'lucide-react';

interface CoachTipUpdate {
  tip: string;
  tip_type: string;
  category: string;
  priority: string;
  confidence: number;
  trigger?: string;
  timestamp_secs: number;
}

export function LiveFeedbackPanel() {
  const [tip, setTip] = useState<CoachTipUpdate | null>(null);
  const [age, setAge] = useState(0);
  const tipReceivedAt = useRef<number>(0);

  useEffect(() => {
    const unlisten = listen<CoachTipUpdate>('coach-tip-update', (event) => {
      setTip(event.payload);
      tipReceivedAt.current = Date.now();
      setAge(0);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Update displayed age every 5 seconds
  useEffect(() => {
    if (!tip) return;
    const interval = setInterval(() => {
      const elapsed = Math.round((Date.now() - tipReceivedAt.current) / 1000);
      setAge(elapsed);
    }, 5000);
    return () => clearInterval(interval);
  }, [tip]);

  const openFloat = () => {
    invoke('open_floating_coach').catch(console.error);
  };

  const priorityColor = (priority: string) => {
    switch (priority) {
      case 'critical': return 'text-red-400';
      case 'important': return 'text-amber-400';
      default: return 'text-emerald-400';
    }
  };

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

      {/* Tip content */}
      {tip ? (
        <div className="space-y-1">
          <div className="flex items-start gap-2">
            <Sparkles className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${priorityColor(tip.priority)}`} />
            <p className="text-sm text-foreground leading-snug">{tip.tip}</p>
          </div>
          <div className="flex items-center gap-2 pl-5">
            <span className="text-xs text-muted-foreground/60 capitalize">{tip.category}</span>
            {age > 0 && (
              <>
                <span className="text-muted-foreground/30">·</span>
                <span className="text-xs text-muted-foreground/60">
                  hace {age < 60 ? `${age}s` : `${Math.round(age / 60)}min`}
                </span>
              </>
            )}
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground/60 pl-4">
          Esperando señal conversacional…
        </p>
      )}
    </div>
  );
}
