'use client';

import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';

// §2.3 / §1.2 Payload del evento "meeting-metrics" emitido cada 3s por el backend
// (live_feedback.rs §1.3). Camel-case porque el backend usa #[serde(rename_all = "camelCase")].
export interface MeetingMetrics {
  health: number;
  userTalkPct: number;
  interlocutorTalkPct: number;
  sessionSecs: number;
  userTurns: number;
  interlocutorTurns: number;
}

interface UseMeetingMetricsResult {
  /** Ultimo metric recibido. null hasta que llegue el primer evento. */
  metrics: MeetingMetrics | null;
  /** True cuando el backend aun no ha emitido un payload con turns reales (ambos en 0). */
  isWaitingForAudio: boolean;
}

/**
 * Escucha el evento "meeting-metrics" del backend y mantiene el ultimo valor en state.
 * Sin debouncing (3s ya es lento). Resetea a null al recibir "recording-start-complete".
 */
export function useMeetingMetrics(): UseMeetingMetricsResult {
  const [metrics, setMetrics] = useState<MeetingMetrics | null>(null);

  useEffect(() => {
    const unlistenMetrics = listen<MeetingMetrics>('meeting-metrics', (event) => {
      setMetrics(event.payload);
    });
    const unlistenReset = listen('recording-start-complete', () => {
      setMetrics(null);
    });
    return () => {
      unlistenMetrics.then((fn) => fn());
      unlistenReset.then((fn) => fn());
    };
  }, []);

  const isWaitingForAudio =
    metrics === null || (metrics.userTurns === 0 && metrics.interlocutorTurns === 0);

  return { metrics, isWaitingForAudio };
}
