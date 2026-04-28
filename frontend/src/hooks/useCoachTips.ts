'use client';

import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

export interface CoachTipUpdate {
  tip: string;
  tip_type: string;
  category: string;
  priority: string;
  confidence: number;
  trigger?: string;
  timestamp_secs: number;
}

interface UseCoachTipsResult {
  tips: CoachTipUpdate[];
  latestTip: CoachTipUpdate | null;
  clearTips: () => void;
}

/**
 * Gestiona el array de tips del coach en vivo.
 * Una sola responsabilidad: acumular eventos "coach-tip-update" y exponer el historial.
 */
export function useCoachTips(maxTips = 20): UseCoachTipsResult {
  const [tips, setTips] = useState<CoachTipUpdate[]>([]);
  const maxTipsRef = useRef(maxTips);
  maxTipsRef.current = maxTips;

  useEffect(() => {
    // Recuperar historial de sesión activa al montar (silencioso si no hay sesión)
    invoke<CoachTipUpdate[]>('coach_get_session_tips')
      .then((history) => {
        if (history.length > 0) {
          setTips(history.slice(-maxTipsRef.current));
        }
      })
      .catch(() => {
        // No hay sesión activa o el comando no existe — ignorar
      });

    // Escuchar nuevos tips y acumular (no overwrite)
    const unlistenTip = listen<CoachTipUpdate>('coach-tip-update', (event) => {
      setTips((prev) => {
        const next = [...prev, event.payload];
        return next.length > maxTipsRef.current
          ? next.slice(next.length - maxTipsRef.current)
          : next;
      });
    });

    // Limpiar al iniciar nueva grabación
    const unlistenReset = listen('recording-start-complete', () => {
      setTips([]);
    });

    return () => {
      unlistenTip.then((fn) => fn());
      unlistenReset.then((fn) => fn());
    };
  }, []);

  return {
    tips,
    latestTip: tips.length > 0 ? tips[tips.length - 1] : null,
    clearTips: () => setTips([]),
  };
}
