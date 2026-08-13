'use client';

import { useEffect, useRef, useState } from 'react';
import { createSubscriptionGroup } from '@/lib/tauriSubscribe';
import { invoke } from '@tauri-apps/api/core';
import { TauriEvent } from '@/lib/tauri-events';

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
    const subs = createSubscriptionGroup();

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
    subs.on<CoachTipUpdate>(TauriEvent.COACH_TIP_UPDATE, (event) => {
      setTips((prev) => {
        const next = [...prev, event.payload];
        return next.length > maxTipsRef.current
          ? next.slice(next.length - maxTipsRef.current)
          : next;
      });
    });

    // Limpiar al iniciar nueva grabación
    subs.on(TauriEvent.RECORDING_START_COMPLETE, () => {
      setTips([]);
    });

    // Limpiar también al detener para que el drawer no muestre tips stale
    // cuando el usuario lo reabre en idle. Antes solo limpiábamos en start,
    // así que el tip card quedaba con el último tip de la sesión anterior.
    subs.on(TauriEvent.RECORDING_STOP_COMPLETE, () => {
      setTips([]);
    });
    subs.on(TauriEvent.RECORDING_STOPPED, () => {
      setTips([]);
    });

    return () => subs.dispose();
  }, []);

  return {
    tips,
    latestTip: tips.length > 0 ? tips[tips.length - 1] : null,
    clearTips: () => setTips([]),
  };
}
