import { useEffect, useState } from 'react';
import { listen, UnlistenFn } from '@tauri-apps/api/event';

export type CoachStage = 'analyzing' | 'generating' | 'done' | 'error';

export interface CoachThinkingPayload {
  stage: CoachStage;
  elapsed_ms: number;
  model: string;
}

export interface SummaryProgressPayload {
  stage: string;
  percent: number;
  current_chunk: number;
  total_chunks: number;
}

export interface TranscriptionStalledPayload {
  provider: string;
  last_chunk_ago_ms: number;
  queue_size: number;
}

export interface ProgressEventsState {
  coachThinking: CoachThinkingPayload | null;
  summaryProgress: SummaryProgressPayload | null;
  transcriptionStalled: TranscriptionStalledPayload | null;
  isCoachWorking: boolean;
  isSummaryWorking: boolean;
  isTranscriptionStalled: boolean;
}

/**
 * Hook que escucha los 3 eventos de progreso emitidos desde Rust:
 * - `coach-thinking`: estado del Coach IA durante generación
 * - `summary-progress`: progreso del resumen LLM
 * - `transcription-stalled`: pipeline transcripción saturado
 *
 * Auto-resetea estados terminales: tras `done`/`error` el coachThinking
 * vuelve a null en 3s. transcriptionStalled limpia tras 10s sin nuevos eventos.
 */
export function useProgressEvents(): ProgressEventsState {
  const [coachThinking, setCoachThinking] = useState<CoachThinkingPayload | null>(null);
  const [summaryProgress, setSummaryProgress] = useState<SummaryProgressPayload | null>(null);
  const [transcriptionStalled, setTranscriptionStalled] = useState<TranscriptionStalledPayload | null>(null);

  useEffect(() => {
    const unlisteners: UnlistenFn[] = [];
    let coachClearTimer: ReturnType<typeof setTimeout> | null = null;
    let stalledClearTimer: ReturnType<typeof setTimeout> | null = null;
    let summaryClearTimer: ReturnType<typeof setTimeout> | null = null;

    const setup = async () => {
      const u1 = await listen<CoachThinkingPayload>('coach-thinking', (event) => {
        setCoachThinking(event.payload);
        if (event.payload.stage === 'done' || event.payload.stage === 'error') {
          if (coachClearTimer) clearTimeout(coachClearTimer);
          coachClearTimer = setTimeout(() => setCoachThinking(null), 3000);
        }
      });
      unlisteners.push(u1);

      const u2 = await listen<SummaryProgressPayload>('summary-progress', (event) => {
        setSummaryProgress(event.payload);
        if (event.payload.stage === 'done' || event.payload.percent >= 1.0) {
          if (summaryClearTimer) clearTimeout(summaryClearTimer);
          summaryClearTimer = setTimeout(() => setSummaryProgress(null), 2000);
        }
      });
      unlisteners.push(u2);

      const u3 = await listen<TranscriptionStalledPayload>('transcription-stalled', (event) => {
        setTranscriptionStalled(event.payload);
        if (stalledClearTimer) clearTimeout(stalledClearTimer);
        stalledClearTimer = setTimeout(() => setTranscriptionStalled(null), 10000);
      });
      unlisteners.push(u3);
    };

    setup();

    return () => {
      unlisteners.forEach((fn) => fn());
      if (coachClearTimer) clearTimeout(coachClearTimer);
      if (summaryClearTimer) clearTimeout(summaryClearTimer);
      if (stalledClearTimer) clearTimeout(stalledClearTimer);
    };
  }, []);

  return {
    coachThinking,
    summaryProgress,
    transcriptionStalled,
    isCoachWorking: coachThinking !== null && coachThinking.stage !== 'done' && coachThinking.stage !== 'error',
    isSummaryWorking: summaryProgress !== null && summaryProgress.stage !== 'done' && summaryProgress.percent < 1.0,
    isTranscriptionStalled: transcriptionStalled !== null,
  };
}
