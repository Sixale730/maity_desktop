'use client';

import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Clock, FileAudio, Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { logger } from '@/lib/logger';
import type { BatchTranscriptionStatusPayload } from '@/lib/tauri-events';
import {
  BATCH_NON_TERMINAL_STATES,
  BATCH_STATUS_DOM_EVENT,
  getBatchQueueActive,
  retryBatchJob,
  type BatchQueueRow,
} from '../services/batchQueue.service';

/** queryKey del bloque. `PendingTranscriptionsBlock` es su único consumidor. */
export const BATCH_QUEUE_QUERY_KEY = 'batch-queue-active';

/** Poll con filas `pending|processing` (el planner sigue trabajando). */
export const BATCH_POLL_ACTIVE_MS = 15_000;
/** Poll con la cola vacía o sólo `failed`, mientras haya sesión (ver `refetchInterval`). */
export const BATCH_POLL_IDLE_MS = 60_000;

/**
 * Etiqueta de origen. `last_error === 'crash_recovery'` es una MARCA del
 * arranque (la fila se recuperó tras un cierre anómalo); el `trigger_kind`
 * conserva el origen real, pero para el usuario "Recuperada" explica mejor por
 * qué aparece una grabación que no recuerda haber parado.
 */
function originLabel(row: BatchQueueRow): string {
  if (row.last_error === 'crash_recovery' || row.trigger_kind === 'crash_recovery') return 'Recuperada';
  switch (row.trigger_kind) {
    case 'manual':
      return 'Manual';
    case 'rotation':
    case 'auto_close':
      return 'Jornada';
    default:
      return row.trigger_kind;
  }
}

const SQLITE_NAIVE_TS = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/**
 * Parsea un timestamp "YYYY-MM-DD HH:MM:SS" de SQLite. La forma naive NO trae
 * zona y las dos columnas de la cola la escriben en zonas DISTINTAS:
 *   - `segment_started_at` la escribe Rust en hora LOCAL
 *     (`recording_helpers.rs`: `with_timezone(&Local).naive_local()`);
 *   - `updated_at` la escribe SQLite en UTC (`datetime('now')`).
 * Tratar las dos como UTC (el bug) desplazaba la hora de inicio por el offset
 * de la zona (09:30 en CDMX se pintaba como 03:30). RFC 3339 con zona pasa
 * intacto. Exportada para el test; `null` si la fecha es ilegible.
 */
export function parseSqliteTs(raw: string | null | undefined, opts: { utc: boolean }): Date | null {
  if (!raw) return null;
  const normalized = SQLITE_NAIVE_TS.test(raw)
    ? `${raw.replace(' ', 'T')}${opts.utc ? 'Z' : ''}`
    : raw;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Una fecha ilegible devuelve '' en vez de "Invalid Date". */
function formatDate(date: Date | null): string {
  if (!date) return '';
  return date.toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Fecha de la fila: inicio del segmento (local) o, si falta, último cambio (UTC). */
function rowDate(row: BatchQueueRow): Date | null {
  return (
    parseSqliteTs(row.segment_started_at, { utc: false }) ??
    parseSqliteTs(row.updated_at, { utc: true })
  );
}

/**
 * Bloque "Transcripciones pendientes" (F4 de la migración a lote).
 *
 * En modo lote la reunión NO existe en `meetings` hasta que el planner termina;
 * sin este bloque una grabación recién parada "desaparecería" de la lista
 * durante minutos. Se alimenta de `batch_queue_list_active` (pending |
 * processing | failed) y se refresca por dos vías: el bus DOM
 * `batch-transcription-status-changed` (camino rápido, reenviado por
 * `RecordingPostProcessingProvider`) y un poll de 15 s mientras haya filas no
 * terminales (cubre el hueco en que el webview estuvo suspendido).
 *
 * `processing → pending` es un reintento del planner, no un retroceso: por eso
 * "Pendiente de transcribir" muestra el número de reintento cuando `attempts > 0`.
 * Devuelve `null` sin filas: la lista no cambia para quien no usa el lote.
 */
export function PendingTranscriptionsBlock() {
  const { maityUser } = useAuth();
  const queryClient = useQueryClient();
  const [retryingPaths, setRetryingPaths] = useState<Set<string>>(new Set());

  const { data: rows } = useQuery({
    queryKey: [BATCH_QUEUE_QUERY_KEY, maityUser?.id],
    queryFn: getBatchQueueActive,
    enabled: !!maityUser?.id,
    staleTime: 5_000,
    // 15 s mientras el planner trabaja; 60 s con la cola vacía o sólo con
    // `failed`. El poll lento NO se apaga con `[]`: el primer
    // `batch_queue_list_active` puede correr antes de que Rust reciba
    // `set_current_user` (devuelve `[]` sin `current_user_id`) y con el
    // intervalo en `false` la cola real nunca se habría vuelto a pedir. Es
    // barato: sin filas el bloque devuelve `null`. Sin sesión, nada.
    refetchInterval: (q) => {
      if (!maityUser?.id) return false;
      const data = q.state.data as BatchQueueRow[] | undefined;
      const working = !!data && data.some((r) => BATCH_NON_TERMINAL_STATES.has(r.status));
      return working ? BATCH_POLL_ACTIVE_MS : BATCH_POLL_IDLE_MS;
    },
  });

  // Camino rápido: cada transición del planner llega por el bus DOM. En
  // `ready`/`discarded` la fila desaparece de la cola Y (en `ready`) nace la
  // reunión en `meetings`, así que también se invalida la lista local.
  useEffect(() => {
    const onStatus = (e: Event) => {
      const detail = (e as CustomEvent<BatchTranscriptionStatusPayload>).detail;
      void queryClient.invalidateQueries({ queryKey: [BATCH_QUEUE_QUERY_KEY] });
      if (detail?.status === 'ready' || detail?.status === 'discarded') {
        void queryClient.invalidateQueries({ queryKey: ['local-conversations'] });
      }
    };
    window.addEventListener(BATCH_STATUS_DOM_EVENT, onStatus);
    return () => window.removeEventListener(BATCH_STATUS_DOM_EVENT, onStatus);
  }, [queryClient]);

  const handleRetry = useCallback(
    async (folderPath: string) => {
      setRetryingPaths((prev) => new Set(prev).add(folderPath));
      try {
        const revived = await retryBatchJob(folderPath);
        logger.info('[PendingTranscriptions] reintento de transcripción', { folderPath, revived });
      } catch (err) {
        logger.error('[PendingTranscriptions] fallo al reintentar', err);
      } finally {
        setRetryingPaths((prev) => {
          const next = new Set(prev);
          next.delete(folderPath);
          return next;
        });
        void queryClient.invalidateQueries({ queryKey: [BATCH_QUEUE_QUERY_KEY] });
      }
    },
    [queryClient]
  );

  if (!rows || rows.length === 0) return null;

  const renderStatus = (row: BatchQueueRow) => {
    if (row.status === 'processing') {
      return (
        <Badge variant="outline" className="text-xs gap-1 text-primary border-primary/40">
          <Loader2 className="h-3 w-3 animate-spin" />
          Transcribiendo…
        </Badge>
      );
    }
    if (row.status === 'failed') {
      const isRetrying = retryingPaths.has(row.folder_path);
      return (
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className="text-xs gap-1 text-destructive border-destructive/40"
            title={row.last_error ?? undefined}
          >
            <AlertTriangle className="h-3 w-3" />
            No se pudo transcribir
          </Badge>
          <button
            type="button"
            onClick={() => void handleRetry(row.folder_path)}
            disabled={isRetrying}
            className="text-xs px-2 py-0.5 rounded-md border border-border hover:bg-muted transition-colors disabled:opacity-50"
            title={row.last_error ?? 'Reintentar transcripción'}
          >
            {isRetrying ? 'Reintentando...' : 'Reintentar'}
          </button>
        </div>
      );
    }
    // pending (incluye el `processing → pending` de un reintento)
    return (
      <Badge variant="outline" className="text-xs gap-1 text-amber-600 border-amber-300">
        <Clock className="h-3 w-3" />
        Pendiente de transcribir
        {row.attempts > 0 ? ` · reintento ${row.attempts}` : ''}
      </Badge>
    );
  };

  return (
    <div className="mb-6" data-testid="pending-transcriptions-block">
      <div className="flex items-center gap-2 mb-2">
        <FileAudio className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-foreground">Transcripciones pendientes</h2>
        <span className="text-xs text-muted-foreground">({rows.length})</span>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        El audio ya está guardado. Se transcribe en cuanto la computadora está libre y la
        reunión aparece abajo al terminar.
      </p>
      <div className="space-y-2">
        {rows.map((row) => (
          <Card key={row.id} className="border-dashed">
            <CardContent className="p-3">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-medium truncate text-foreground">
                      {row.meeting_name || 'Grabación'}
                    </h3>
                    <Badge variant="secondary" className="text-[10px]">
                      {originLabel(row)}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatDate(rowDate(row))}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">{renderStatus(row)}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
