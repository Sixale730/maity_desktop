/**
 * `lib/transcriptionMode` (F5): espejo en TS de la decisión de
 * `recording_helpers.rs` — el lote sólo aplica con `transcription_mode='batch'`
 * Y `auto_save` activo. Single-flight, cachea sólo el éxito y falla cerrado a
 * `'streaming'` (el camino que descarga Gemma: equivocarse hacia ahí cuesta
 * una descarga de más; hacia el lote, un coach sin modelo).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const invokeMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  getTranscriptionMode,
  isBatchTranscriptionMode,
  resetTranscriptionModeCache,
} from './transcriptionMode';

describe('transcriptionMode', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    resetTranscriptionModeCache();
  });

  it('devuelve batch con transcription_mode=batch y auto_save activo', async () => {
    invokeMock.mockResolvedValue({ transcription_mode: 'batch', auto_save: true });
    expect(await getTranscriptionMode()).toBe('batch');
    expect(await isBatchTranscriptionMode()).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith('get_recording_preferences');
  });

  it('devuelve streaming con transcription_mode=streaming', async () => {
    invokeMock.mockResolvedValue({ transcription_mode: 'streaming', auto_save: true });
    expect(await getTranscriptionMode()).toBe('streaming');
    expect(await isBatchTranscriptionMode()).toBe(false);
  });

  it('batch sin auto_save cae a streaming (sin checkpoints no hay qué transcribir)', async () => {
    invokeMock.mockResolvedValue({ transcription_mode: 'batch', auto_save: false });
    expect(await getTranscriptionMode()).toBe('streaming');
  });

  it('sin el campo (Rust viejo) o sin preferencias es streaming', async () => {
    invokeMock.mockResolvedValueOnce({ auto_save: true });
    expect(await getTranscriptionMode()).toBe('streaming');
    resetTranscriptionModeCache();
    invokeMock.mockResolvedValueOnce(null);
    expect(await getTranscriptionMode()).toBe('streaming');
  });

  it('un IPC rechazado da streaming y NO se cachea (la siguiente llamada vuelve a preguntar)', async () => {
    invokeMock.mockRejectedValueOnce(new Error('IPC caído'));
    expect(await getTranscriptionMode()).toBe('streaming');

    invokeMock.mockResolvedValueOnce({ transcription_mode: 'batch', auto_save: true });
    expect(await getTranscriptionMode()).toBe('batch');
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it('cachea el éxito: dos lecturas = un solo invoke, y las concurrentes se colapsan', async () => {
    invokeMock.mockResolvedValue({ transcription_mode: 'batch', auto_save: true });
    const [a, b] = await Promise.all([getTranscriptionMode(), getTranscriptionMode()]);
    expect(a).toBe('batch');
    expect(b).toBe('batch');
    expect(invokeMock).toHaveBeenCalledTimes(1);

    await getTranscriptionMode();
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it('resetTranscriptionModeCache obliga a releer (cambio desde Ajustes)', async () => {
    invokeMock.mockResolvedValueOnce({ transcription_mode: 'streaming', auto_save: true });
    expect(await getTranscriptionMode()).toBe('streaming');

    resetTranscriptionModeCache();
    invokeMock.mockResolvedValueOnce({ transcription_mode: 'batch', auto_save: true });
    expect(await getTranscriptionMode()).toBe('batch');
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it('un reset a mitad de una lectura en vuelo impide que el resultado viejo pise el cache', async () => {
    let resolveOld: ((v: unknown) => void) | null = null;
    invokeMock.mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }));
    const oldRead = getTranscriptionMode();

    resetTranscriptionModeCache();
    invokeMock.mockResolvedValueOnce({ transcription_mode: 'batch', auto_save: true });
    expect(await getTranscriptionMode()).toBe('batch');

    resolveOld!({ transcription_mode: 'streaming', auto_save: true });
    expect(await oldRead).toBe('streaming'); // el llamador viejo recibe lo suyo…
    expect(await getTranscriptionMode()).toBe('batch'); // …pero el cache conserva la lectura nueva
  });
});
