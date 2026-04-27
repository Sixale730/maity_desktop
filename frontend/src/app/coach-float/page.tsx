'use client';

import React, { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { Sparkles, Minus, Maximize2 } from 'lucide-react';

interface CoachTipUpdate {
  tip: string;
  tip_type: string;
  category: string;
  priority: string;
  confidence: number;
  trigger?: string;
  timestamp_secs: number;
}

export default function CoachFloatPage() {
  const [tip, setTip] = useState<CoachTipUpdate | null>(null);
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const unlisten = listen<CoachTipUpdate>('coach-tip-update', (event) => {
      setTip(event.payload);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  const toggleCompact = async () => {
    try {
      await invoke('floating_toggle_compact');
      setCompact((c) => !c);
    } catch (e) {
      console.error(e);
    }
  };

  const close = () => invoke('close_floating_coach').catch(console.error);

  const priorityBorder = (p: string) => {
    switch (p) {
      case 'critical': return 'border-red-500/50';
      case 'important': return 'border-amber-500/50';
      default: return 'border-emerald-500/30';
    }
  };

  const priorityIcon = (p: string) => {
    switch (p) {
      case 'critical': return 'text-red-400';
      case 'important': return 'text-amber-400';
      default: return 'text-emerald-400';
    }
  };

  if (compact) {
    return (
      <div
        className="h-screen flex items-center justify-between px-3 bg-zinc-900/95 backdrop-blur border border-white/10 rounded-xl cursor-pointer select-none"
        onClick={toggleCompact}
      >
        <div className="flex items-center gap-2">
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
          </span>
          <span className="text-xs text-muted-foreground">Coach</span>
        </div>
        {tip && (
          <span className="text-xs text-foreground truncate max-w-[220px] ml-2">
            {tip.tip}
          </span>
        )}
        <Maximize2 className="w-3.5 h-3.5 text-muted-foreground ml-2 shrink-0" />
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-zinc-900/95 backdrop-blur border border-white/10 rounded-xl overflow-hidden select-none">
      {/* Drag handle / title bar */}
      <div
        data-tauri-drag-region
        className="flex items-center justify-between px-3 py-2 border-b border-white/10 cursor-move"
      >
        <div className="flex items-center gap-2">
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
          </span>
          <span className="text-xs font-medium text-muted-foreground">Maity Coach</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={toggleCompact}
            className="p-1 rounded hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
          >
            <Minus className="w-3 h-3" />
          </button>
          <button
            onClick={close}
            className="p-1 rounded hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-colors text-xs"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3">
        {tip ? (
          <div className={`rounded-lg border p-3 space-y-2 ${priorityBorder(tip.priority)}`}>
            <div className="flex items-start gap-2">
              <Sparkles className={`w-4 h-4 mt-0.5 shrink-0 ${priorityIcon(tip.priority)}`} />
              <p className="text-sm text-foreground leading-snug">{tip.tip}</p>
            </div>
            <div className="flex items-center gap-2 ml-6">
              <span className="text-xs text-muted-foreground/60 capitalize">{tip.category}</span>
              {tip.trigger && (
                <>
                  <span className="text-muted-foreground/30">·</span>
                  <span className="text-xs text-muted-foreground/50">{tip.trigger}</span>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-8">
            <Sparkles className="w-8 h-8 text-muted-foreground/30" />
            <p className="text-xs text-muted-foreground/60">
              Inicia una grabación para recibir coaching en tiempo real.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
