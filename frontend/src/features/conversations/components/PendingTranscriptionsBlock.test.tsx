/**
 * Bloque "Transcripciones pendientes" (F4 de la migración a lote).
 *
 * Fija el contrato con Rust (`batch_queue_list_active` / `batch_queue_retry`
 * con `{ folderPath }`) y las dos vías de refresco: el bus DOM
 * `batch-transcription-status-changed` y el reintento manual. Sin filas el
 * bloque NO se pinta: la lista no cambia para quien no usa el lote.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { createElement } from 'react';

const invokeMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ maityUser: { id: 'user-1' } }),
}));

import {
  PendingTranscriptionsBlock,
  parseSqliteTs,
  BATCH_POLL_ACTIVE_MS,
  BATCH_POLL_IDLE_MS,
} from './PendingTranscriptionsBlock';
import type { BatchQueueRow } from '../services/batchQueue.service';

function row(overrides: Partial<BatchQueueRow>): BatchQueueRow {
  return {
    id: 1,
    folder_path: 'C:/meetings/a',
    meeting_name: 'Reunión A',
    trigger_kind: 'manual',
    status: 'pending',
    attempts: 0,
    last_error: null,
    segment_started_at: '2026-09-10 15:00:00',
    updated_at: '2026-09-10 15:05:00',
    ...overrides,
  };
}

function listCalls(): number {
  return invokeMock.mock.calls.filter(([cmd]) => cmd === 'batch_queue_list_active').length;
}

function renderBlock() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  Wrapper.displayName = 'TestQueryClientProviderWrapper';
  return render(createElement(PendingTranscriptionsBlock), { wrapper: Wrapper });
}

describe('PendingTranscriptionsBlock', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sin filas no pinta nada', async () => {
    invokeMock.mockImplementation(async (cmd: string) => (cmd === 'batch_queue_list_active' ? [] : undefined));
    const { container } = renderBlock();

    await waitFor(() => expect(listCalls()).toBe(1));
    expect(container.firstChild).toBeNull();
    expect(screen.queryByText(/Transcripciones pendientes/)).not.toBeInTheDocument();
  });

  it('pinta pendiente (con reintento), transcribiendo y fallida con su origen', async () => {
    invokeMock.mockImplementation(async (cmd: string) =>
      cmd === 'batch_queue_list_active'
        ? [
            row({ id: 1, status: 'pending', attempts: 2, trigger_kind: 'manual' }),
            row({ id: 2, folder_path: 'C:/meetings/b', meeting_name: 'Segmento B', status: 'processing', trigger_kind: 'rotation' }),
            row({ id: 3, folder_path: 'C:/meetings/c', meeting_name: null, status: 'failed', attempts: 5, last_error: 'ffmpeg exited 1', trigger_kind: 'auto_close' }),
          ]
        : undefined
    );
    renderBlock();

    expect(await screen.findByText(/Transcripciones pendientes/)).toBeInTheDocument();
    // processing → pending en un reintento: se ve el número de intento.
    expect(screen.getByText(/Pendiente de transcribir · reintento 2/)).toBeInTheDocument();
    expect(screen.getByText(/Transcribiendo/)).toBeInTheDocument();
    expect(screen.getByText(/No se pudo transcribir/)).toBeInTheDocument();
    // Nombre por defecto cuando la fila no lo trae.
    expect(screen.getByText('Grabación')).toBeInTheDocument();
    // Origen legible.
    expect(screen.getByText('Manual')).toBeInTheDocument();
    expect(screen.getAllByText('Jornada')).toHaveLength(2);
    // El error viaja como tooltip del botón, no como texto crudo.
    expect(screen.getByRole('button', { name: /Reintentar/ })).toHaveAttribute('title', 'ffmpeg exited 1');
  });

  it('una fila recuperada al arranque se etiqueta "Recuperada"', async () => {
    invokeMock.mockImplementation(async (cmd: string) =>
      cmd === 'batch_queue_list_active'
        ? [row({ id: 7, trigger_kind: 'rotation', last_error: 'crash_recovery' })]
        : undefined
    );
    renderBlock();
    expect(await screen.findByText('Recuperada')).toBeInTheDocument();
  });

  it('Reintentar invoca batch_queue_retry con { folderPath } y refresca la cola', async () => {
    let retried = false;
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'batch_queue_list_active') {
        return retried
          ? [row({ id: 3, folder_path: 'C:/meetings/c', status: 'pending', attempts: 0 })]
          : [row({ id: 3, folder_path: 'C:/meetings/c', status: 'failed', attempts: 5, last_error: 'boom' })];
      }
      if (cmd === 'batch_queue_retry') {
        retried = true;
        return true;
      }
      return undefined;
    });
    renderBlock();

    const button = await screen.findByRole('button', { name: /Reintentar/ });
    fireEvent.click(button);

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('batch_queue_retry', { folderPath: 'C:/meetings/c' })
    );
    // Tras el reintento la fila vuelve a "pendiente" (failed → pending, attempts=0).
    expect(await screen.findByText(/Pendiente de transcribir/)).toBeInTheDocument();
    expect(screen.queryByText(/reintento/)).not.toBeInTheDocument();
  });

  it('el evento DOM batch-transcription-status-changed refetchea la cola', async () => {
    invokeMock.mockImplementation(async (cmd: string) =>
      cmd === 'batch_queue_list_active' ? [row({ id: 1, status: 'pending' })] : undefined
    );
    renderBlock();
    await screen.findByText(/Pendiente de transcribir/);
    expect(listCalls()).toBe(1);

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('batch-transcription-status-changed', {
          detail: { meetingId: null, folderPath: 'C:/meetings/a', status: 'processing' },
        })
      );
    });

    await waitFor(() => expect(listCalls()).toBe(2));
  });

  it('un IPC caído no rompe la lista: el bloque simplemente no aparece', async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'batch_queue_list_active') throw new Error('command not found');
      return undefined;
    });
    const { container } = renderBlock();
    await waitFor(() => expect(listCalls()).toBe(1));
    expect(container.firstChild).toBeNull();
  });

  // ── Fechas: `segment_started_at` es hora LOCAL naive (Rust,
  // `with_timezone(&Local).naive_local()`); `updated_at` es UTC naive (SQLite
  // `datetime('now')`). Tratar las dos como UTC desplazaba el inicio por el
  // offset de la zona. ──
  describe('parseSqliteTs', () => {
    it('la forma naive LOCAL se lee en la zona local: 09:30 son las 09:30 aquí', () => {
      const date = parseSqliteTs('2026-09-10 09:30:00', { utc: false });
      expect(date).not.toBeNull();
      expect(date!.getFullYear()).toBe(2026);
      expect(date!.getMonth()).toBe(8);
      expect(date!.getDate()).toBe(10);
      expect(date!.getHours()).toBe(9);
      expect(date!.getMinutes()).toBe(30);
    });

    it('la forma naive UTC se lee como UTC', () => {
      const date = parseSqliteTs('2026-09-10 15:05:00', { utc: true });
      expect(date!.getUTCHours()).toBe(15);
      expect(date!.getUTCMinutes()).toBe(5);
    });

    it('RFC 3339 con zona pasa intacto en ambos modos; basura y vacío devuelven null', () => {
      const iso = '2026-09-10T15:05:00Z';
      expect(parseSqliteTs(iso, { utc: false })!.toISOString()).toBe('2026-09-10T15:05:00.000Z');
      expect(parseSqliteTs(iso, { utc: true })!.toISOString()).toBe('2026-09-10T15:05:00.000Z');
      expect(parseSqliteTs('no es fecha', { utc: false })).toBeNull();
      expect(parseSqliteTs(null, { utc: false })).toBeNull();
      expect(parseSqliteTs('', { utc: true })).toBeNull();
    });
  });

  it('pinta la hora de inicio del segmento en hora local (09:30 se ve como 09:30)', async () => {
    invokeMock.mockImplementation(async (cmd: string) =>
      cmd === 'batch_queue_list_active'
        ? [row({ id: 1, segment_started_at: '2026-09-10 09:30:00', updated_at: '2026-09-10 15:31:00' })]
        : undefined
    );
    renderBlock();
    await screen.findByText(/Pendiente de transcribir/);
    expect(screen.getByText(/09:30/)).toBeInTheDocument();
  });

  // ── Polling (T-D): el primer `batch_queue_list_active` puede correr antes de
  // que Rust reciba `set_current_user` y devolver `[]`; con el intervalo en
  // `false` la cola real nunca se volvía a pedir. ──
  describe('refetchInterval', () => {
    it('con la cola vacía sigue pidiéndola cada 60 s mientras haya sesión', async () => {
      vi.useFakeTimers();
      invokeMock.mockImplementation(async (cmd: string) => (cmd === 'batch_queue_list_active' ? [] : undefined));
      renderBlock();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      expect(listCalls()).toBe(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(BATCH_POLL_IDLE_MS - 1000);
      });
      expect(listCalls()).toBe(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(listCalls()).toBe(2);
    });

    it('con filas pending/processing pide la cola cada 15 s', async () => {
      vi.useFakeTimers();
      invokeMock.mockImplementation(async (cmd: string) =>
        cmd === 'batch_queue_list_active' ? [row({ id: 1, status: 'processing' })] : undefined
      );
      renderBlock();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      expect(listCalls()).toBe(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(BATCH_POLL_ACTIVE_MS + 500);
      });
      expect(listCalls()).toBe(2);
    });
  });
});
