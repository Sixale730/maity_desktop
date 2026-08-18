/**
 * Auto-recuperación y filtro de fantasmas (ago-2026).
 *
 * El registro IndexedDB de una reunión se crea al ARRANCAR la grabación con
 * transcriptCount=0, así que abortos tempranos, segmentos de jornada en silencio
 * y grabaciones cuyo STT nunca cargó dejaban entradas "recuperables" que
 * `recoverMeeting` rechazaba. Estas pruebas fijan la política nueva:
 *   - sin transcripts → se borra el registro (no la carpeta) y no se ofrece;
 *   - con transcripts → se recupera SOLO al arrancar (autoRecoverAll);
 *   - un fallo real queda en la lista para el diálogo; el error transitorio
 *     "no user logged in" NO cuenta como fallo (reintento en el próximo arranque).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import 'fake-indexeddb/auto';

const invokeMock = vi.fn();
const saveMeetingMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock('@/services/storageService', () => ({
  storageService: {
    saveMeeting: (...args: unknown[]) => saveMeetingMock(...args),
  },
}));

import { indexedDBService } from '@/services/indexedDBService';
import { useTranscriptRecovery, isTransientNoUserError } from './useTranscriptRecovery';

const OLD_ENOUGH = Date.now() - 5 * 60_000; // 5 min: pasa el umbral de 15 s y la retención de 7 días

function meta(id: string, transcriptCount: number, folderPath?: string) {
  return {
    meetingId: id,
    title: `Reunión ${id}`,
    startTime: OLD_ENOUGH - 60_000,
    lastUpdated: OLD_ENOUGH,
    transcriptCount,
    savedToSQLite: false,
    folderPath,
  };
}

/** Inserta un registro con N transcripts reales y lo deja "viejo" (saveTranscript toca lastUpdated). */
async function seedWithTranscripts(id: string, count: number, folderPath?: string) {
  await indexedDBService.saveMeetingMetadata(meta(id, 0, folderPath));
  for (let i = 0; i < count; i++) {
    await indexedDBService.saveTranscript(id, {
      text: `segmento ${i}`,
      timestamp: new Date().toISOString(),
      confidence: 1,
      sequenceId: i,
    } as never);
  }
  await indexedDBService.saveMeetingMetadata(meta(id, count, folderPath));
}

function defaultInvoke(cmd: string): unknown {
  switch (cmd) {
    case 'is_recording': return false;
    case 'get_meeting_folder_path': return null;
    case 'has_audio_checkpoints': return false;
    case 'recover_audio_from_checkpoints':
      return { status: 'none', chunk_count: 0, estimated_duration_seconds: 0, message: 'no' };
    case 'cleanup_checkpoints': return undefined;
    default: return undefined;
  }
}

describe('useTranscriptRecovery — filtro de fantasmas', () => {
  // fake-indexeddb se comparte entre tests: ids únicos por test.
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (cmd: string) => defaultInvoke(cmd));
    saveMeetingMock.mockReset();
    saveMeetingMock.mockResolvedValue({ meeting_id: 'sqlite-1' });
  });

  it('borra de IndexedDB los registros sin transcripts y no los ofrece', async () => {
    await indexedDBService.saveMeetingMetadata(meta('g1-ghost', 0, 'C:/m/g1'));
    await seedWithTranscripts('g1-real', 2, 'C:/m/real');

    const { result } = renderHook(() => useTranscriptRecovery());
    let candidates: Array<{ meetingId: string }> = [];
    await act(async () => {
      candidates = await result.current.checkForRecoverableTranscripts();
    });

    const ids = candidates.map(c => c.meetingId);
    expect(ids).toContain('g1-real');
    expect(ids).not.toContain('g1-ghost');
    // El registro fantasma desapareció de IndexedDB…
    expect(await indexedDBService.getMeetingMetadata('g1-ghost')).toBeNull();
    // …y el válido sigue ahí (sin marcar) hasta que se recupere.
    expect((await indexedDBService.getMeetingMetadata('g1-real'))?.savedToSQLite).toBe(false);
    // Nunca se tocan archivos en disco desde el filtro.
    expect(invokeMock.mock.calls.map(([c]) => c)).not.toContain('cleanup_checkpoints');
  });

  it('un fantasma CON checkpoints de audio también se descarta (decisión de producto)', async () => {
    invokeMock.mockImplementation(async (cmd: string) =>
      cmd === 'has_audio_checkpoints' ? true : defaultInvoke(cmd)
    );
    await indexedDBService.saveMeetingMetadata(meta('g2-audio-only', 0, 'C:/m/g2'));

    const { result } = renderHook(() => useTranscriptRecovery());
    let candidates: unknown[] = [];
    await act(async () => {
      candidates = await result.current.checkForRecoverableTranscripts();
    });

    // (fake-indexeddb se comparte entre tests → se comprueba por id, no por longitud)
    expect((candidates as Array<{ meetingId: string }>).map(c => c.meetingId)).not.toContain('g2-audio-only');
    expect(await indexedDBService.getMeetingMetadata('g2-audio-only')).toBeNull();
  });
});

describe('useTranscriptRecovery — autoRecoverAll', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (cmd: string) => defaultInvoke(cmd));
    saveMeetingMock.mockReset();
  });

  it('recupera las candidatas válidas y deja en la lista las que fallan de verdad', async () => {
    await seedWithTranscripts('a1-ok', 2, 'C:/m/ok');
    await seedWithTranscripts('a1-bad', 2, 'C:/m/bad');
    saveMeetingMock.mockImplementation(async (title: string) => {
      if (title.includes('a1-bad')) throw new Error('disk full');
      return { meeting_id: `sqlite-${title}` };
    });

    const { result } = renderHook(() => useTranscriptRecovery());
    let outcome: { recovered: Array<{ meetingId: string; savedMeetingId: string }>; failed: Array<{ meetingId: string }> } | null = null;
    await act(async () => {
      // Solo las candidatas de ESTE test (fake-indexeddb se comparte entre tests).
      const candidates = (await result.current.checkForRecoverableTranscripts())
        .filter(c => c.meetingId.startsWith('a1-'));
      outcome = await result.current.autoRecoverAll(candidates);
    });

    expect(outcome!.recovered.map(r => r.meetingId)).toEqual(['a1-ok']);
    expect(outcome!.recovered[0].savedMeetingId).toContain('a1-ok');
    expect(outcome!.failed.map(f => f.meetingId)).toEqual(['a1-bad']);
    // La recuperada quedó marcada; la fallida sigue disponible para el diálogo.
    expect((await indexedDBService.getMeetingMetadata('a1-ok'))?.savedToSQLite).toBe(true);
    expect((await indexedDBService.getMeetingMetadata('a1-bad'))?.savedToSQLite).toBe(false);
    const remaining = result.current.recoverableMeetings.map(m => m.meetingId);
    expect(remaining).toContain('a1-bad');
    expect(remaining).not.toContain('a1-ok');
  });

  it('el error transitorio "no user logged in" no cuenta como fallo ni abre el diálogo', async () => {
    await seedWithTranscripts('a2-nouser', 1, 'C:/m/nouser');
    saveMeetingMock.mockRejectedValue(new Error('Cannot save meeting: no user logged in'));

    const { result } = renderHook(() => useTranscriptRecovery());
    let outcome: { recovered: unknown[]; failed: unknown[] } | null = null;
    await act(async () => {
      const candidates = (await result.current.checkForRecoverableTranscripts())
        .filter(c => c.meetingId === 'a2-nouser');
      outcome = await result.current.autoRecoverAll(candidates);
    });

    expect(outcome!.recovered).toHaveLength(0);
    expect(outcome!.failed).toHaveLength(0);
    // Sigue sin marcar → se reintenta en el próximo arranque.
    expect((await indexedDBService.getMeetingMetadata('a2-nouser'))?.savedToSQLite).toBe(false);
    // Y no queda en la lista que dispara el diálogo.
    expect(result.current.recoverableMeetings.map(m => m.meetingId)).not.toContain('a2-nouser');
  });

  it('isTransientNoUserError reconoce el mensaje de api_save_transcript', () => {
    expect(isTransientNoUserError(new Error('Cannot save meeting: no user logged in'))).toBe(true);
    expect(isTransientNoUserError('no user logged in')).toBe(true);
    expect(isTransientNoUserError(new Error('disk full'))).toBe(false);
    expect(isTransientNoUserError(undefined)).toBe(false);
  });
});
