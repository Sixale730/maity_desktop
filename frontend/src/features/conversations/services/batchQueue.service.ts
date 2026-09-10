/**
 * Cola de transcripción por lote (F4 de la migración a lote).
 *
 * Wrapper fino sobre los dos comandos Tauri que exponen
 * `batch_transcription_queue` a la UI. Las filas vienen en snake_case tal cual
 * las serializa Rust (`database/batch_queue_commands.rs`); aquí NO se
 * renombran para que el contrato Rust↔TS sea legible a simple vista.
 */

import { invoke } from '@tauri-apps/api/core';
import { logger } from '@/lib/logger';

/**
 * Evento DOM (CustomEvent, NO Tauri) al que `RecordingPostProcessingProvider`
 * reenvía cada `batch-transcription-status`. `detail` es el
 * `BatchTranscriptionStatusPayload` del evento nativo.
 */
export const BATCH_STATUS_DOM_EVENT = 'batch-transcription-status-changed';

/** Estados de una fila de la cola. La UI sólo recibe `pending|processing|failed`. */
export type BatchQueueStatus =
  | 'recording'
  | 'pending'
  | 'processing'
  | 'done'
  | 'discarded'
  | 'failed';

export type BatchQueueTrigger = 'manual' | 'rotation' | 'auto_close' | 'crash_recovery';

/** Espejo de `BatchQueueRowView` (Rust). */
export interface BatchQueueRow {
  id: number;
  folder_path: string;
  meeting_name: string | null;
  trigger_kind: BatchQueueTrigger | string;
  status: BatchQueueStatus | string;
  attempts: number;
  /**
   * Último error del planner. `'crash_recovery'` es una MARCA, no un error: la
   * fila se recuperó al arrancar (el `trigger_kind` conserva el origen real).
   */
  last_error: string | null;
  segment_started_at: string | null;
  updated_at: string;
}

/** Estados que todavía pueden cambiar solos (el planner sigue trabajando). */
export const BATCH_NON_TERMINAL_STATES: ReadonlySet<string> = new Set(['pending', 'processing']);

/**
 * Filas vivas de la cola del usuario actual (`pending|processing|failed`, sin
 * terminales ni `recording`). Fail-soft: un IPC caído o un Rust viejo sin el
 * comando devuelve `[]` — el bloque simplemente no se pinta.
 */
export async function getBatchQueueActive(): Promise<BatchQueueRow[]> {
  try {
    const rows = await invoke<BatchQueueRow[] | null>('batch_queue_list_active');
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    logger.warn('[batchQueue] no se pudo leer la cola de lote', error);
    return [];
  }
}

/**
 * Revive una fila `failed` (→ `pending`, `attempts = 0`) y despierta al planner.
 * `false` si la fila no estaba en `failed` (p. ej. ya la tomó un reintento).
 */
export async function retryBatchJob(folderPath: string): Promise<boolean> {
  return invoke<boolean>('batch_queue_retry', { folderPath });
}
