import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: vi.fn(),
  Update: class {},
}));

vi.mock('@tauri-apps/api/app', () => ({
  getVersion: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: vi.fn(async () => undefined),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/lib/fileLogger', () => ({
  fileLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Se mockea el módulo de canal Store (no el cliente Supabase) para no arrastrar
// el mock schema-aware y porque el contrato que importa aquí es el del lookup.
vi.mock('@/lib/storeChannel', () => ({
  fetchStoreLatestVersion: vi.fn(),
}));

import { check } from '@tauri-apps/plugin-updater';
import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { logger } from '@/lib/logger';
import { fileLogger } from '@/lib/fileLogger';
import { fetchStoreLatestVersion } from '@/lib/storeChannel';
import { UpdateService } from './updateService';

const checkMock = vi.mocked(check);
const getVersionMock = vi.mocked(getVersion);
const invokeMock = vi.mocked(invoke);
const loggerMock = vi.mocked(logger);
const fileLoggerMock = vi.mocked(fileLogger);
const fetchStoreMock = vi.mocked(fetchStoreLatestVersion);

describe('UpdateService — logging visible y resultados', () => {
  let service: UpdateService;

  beforeEach(() => {
    service = new UpdateService();
    checkMock.mockReset();
    getVersionMock.mockReset();
    fetchStoreMock.mockReset();
    loggerMock.info.mockClear();
    loggerMock.warn.mockClear();
    loggerMock.error.mockClear();
    fileLoggerMock.info.mockClear();
    fileLoggerMock.warn.mockClear();
    fileLoggerMock.error.mockClear();
    getVersionMock.mockResolvedValue('0.2.35');
    // Default: instalación clásica (NSIS) — sin identidad de paquete MSIX
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(false);
  });

  it('loguea info al iniciar y al encontrar update disponible', async () => {
    checkMock.mockResolvedValue({
      available: true,
      version: '0.2.36',
      date: '2026-05-01',
      body: 'Bug fixes',
    });

    const result = await service.checkForUpdates(true);

    expect(result).toEqual({
      available: true,
      currentVersion: '0.2.35',
      channel: 'github',
      version: '0.2.36',
      date: '2026-05-01',
      body: 'Bug fixes',
    });

    const infoLogs = loggerMock.info.mock.calls.map(call => call[0] as string);
    expect(infoLogs.some(msg => msg.includes('Checking for updates'))).toBe(true);
    expect(infoLogs.some(msg => msg.includes('Update available: 0.2.36'))).toBe(true);
  });

  it('loguea info cuando NO hay update disponible', async () => {
    checkMock.mockResolvedValue({ available: false });

    const result = await service.checkForUpdates(true);

    expect(result.available).toBe(false);
    expect(result.channel).toBe('github');
    const infoLogs = loggerMock.info.mock.calls.map(call => call[0] as string);
    expect(infoLogs.some(msg => msg.includes('No update available'))).toBe(true);
  });

  it('loguea error visible cuando check() falla (no fallo silencioso)', async () => {
    const networkError = new Error('Network unreachable');
    checkMock.mockRejectedValue(networkError);

    await expect(service.checkForUpdates(true)).rejects.toThrow('Network unreachable');
    expect(loggerMock.error).toHaveBeenCalled();
    const errorCall = loggerMock.error.mock.calls[0];
    expect(errorCall[0]).toContain('Update check failed');
    expect(errorCall[1]).toBe(networkError);
  });

  it('escribe a fileLogger.error cuando check() falla (visible en logs exportados de prod)', async () => {
    // En builds de release `logger.info/debug` son no-ops y `logger.error` solo
    // llega a console.error. Sin fileLogger, una falla del auto-updater es
    // invisible en logs exportados — exactamente el bug que ocultó por meses
    // que el toast no aparecia. Este test fija el contrato: catch DEBE escribir
    // al fileLogger para que la proxima falla sea diagnosticable.
    const ipcError = new Error('IPC bridge not ready');
    checkMock.mockRejectedValue(ipcError);

    await expect(service.checkForUpdates(true)).rejects.toThrow('IPC bridge not ready');
    expect(fileLoggerMock.error).toHaveBeenCalledWith(
      'updater_service',
      'check-failed',
      expect.objectContaining({ message: 'IPC bridge not ready' }),
    );
  });

  it('NSIS nunca consulta system_config (el canal Store es exclusivo del MSIX)', async () => {
    checkMock.mockResolvedValue({ available: false });

    await service.checkForUpdates(true);

    expect(fetchStoreMock).not.toHaveBeenCalled();
  });

  describe('canal Store (MSIX)', () => {
    // Contrato del gate de Store: si el updater de GitHub corriera dentro del
    // MSIX, descargaría el setup.exe NSIS y lo instalaría como segunda copia
    // Win32 en paralelo (runFullTrust lo permite) — además de violar la
    // política de la Store de actualizar solo por su canal. Por eso bajo MSIX
    // NUNCA se llama a check(): solo se compara contra system_config y se avisa.
    beforeEach(() => {
      invokeMock.mockResolvedValue(true);
    });

    it('avisa (available + channel store) cuando la Store publicó una versión mayor, sin tocar el plugin', async () => {
      fetchStoreMock.mockResolvedValue({ status: 'ok', version: '0.2.36' });

      const result = await service.checkForUpdates(true);

      expect(invokeMock).toHaveBeenCalledWith('is_running_under_package_identity');
      expect(checkMock).not.toHaveBeenCalled();
      expect(result).toEqual({
        available: true,
        currentVersion: '0.2.35',
        channel: 'store',
        version: '0.2.36',
      });
      expect(fileLoggerMock.info).toHaveBeenCalledWith(
        'updater_service',
        'store-update-available',
        expect.objectContaining({ currentVersion: '0.2.35', remote: '0.2.36' }),
      );
    });

    it('no avisa cuando la versión instalada es igual o mayor que la publicada', async () => {
      fetchStoreMock.mockResolvedValue({ status: 'ok', version: '0.2.35' });
      expect(await service.checkForUpdates(true)).toEqual({
        available: false,
        currentVersion: '0.2.35',
        channel: 'store',
      });

      fetchStoreMock.mockResolvedValue({ status: 'ok', version: '0.2.34' });
      expect((await service.checkForUpdates(true)).available).toBe(false);
      expect(checkMock).not.toHaveBeenCalled();
    });

    it('acepta el formato MSIX de 4 partes en system_config', async () => {
      fetchStoreMock.mockResolvedValue({ status: 'ok', version: '0.2.36.0' });
      expect((await service.checkForUpdates(true)).available).toBe(true);

      fetchStoreMock.mockResolvedValue({ status: 'ok', version: '0.2.35.0' });
      expect((await service.checkForUpdates(true)).available).toBe(false);
    });

    it('sin sesión: no avisa, no lanza y NO arma el cooldown (el re-check post-login debe correr)', async () => {
      fetchStoreMock.mockResolvedValue({ status: 'no-session' });

      const first = await service.checkForUpdates(false);
      expect(first).toEqual({ available: false, currentVersion: '0.2.35', channel: 'store' });
      expect(service.wasCheckedRecently()).toBe(false);

      // Simula el re-check de visibilitychange (force=false) ya con sesión.
      fetchStoreMock.mockResolvedValue({ status: 'ok', version: '0.2.36' });
      const second = await service.checkForUpdates(false);
      expect(second.available).toBe(true);
      expect(fetchStoreMock).toHaveBeenCalledTimes(2);
    });

    it('fila ausente o valor inválido: no avisa, loguea warn y SÍ arma el cooldown', async () => {
      fetchStoreMock.mockResolvedValue({ status: 'missing' });
      expect((await service.checkForUpdates(true)).available).toBe(false);
      expect(service.wasCheckedRecently()).toBe(true);
      expect(fileLoggerMock.warn).toHaveBeenCalledWith(
        'updater_service',
        'store-check-skipped',
        expect.objectContaining({ reason: 'missing-key' }),
      );

      fetchStoreMock.mockResolvedValue({ status: 'ok', version: 'latest' });
      expect((await service.checkForUpdates(true)).available).toBe(false);
      expect(fileLoggerMock.warn).toHaveBeenCalledWith(
        'updater_service',
        'store-check-skipped',
        expect.objectContaining({ reason: 'invalid-remote', remote: 'latest' }),
      );
    });

    it('error de red/RLS: lanza y escribe fileLogger.error (mismo contrato que la rama GitHub)', async () => {
      fetchStoreMock.mockRejectedValue(new Error('system_config read failed: 403'));

      await expect(service.checkForUpdates(true)).rejects.toThrow('system_config read failed');
      expect(fileLoggerMock.error).toHaveBeenCalledWith(
        'updater_service',
        'check-failed',
        expect.objectContaining({ channel: 'store', message: 'system_config read failed: 403' }),
      );
      // Un fallo no envenena el cooldown: el siguiente intento puede reintentar.
      expect(service.wasCheckedRecently()).toBe(false);
    });
  });

  it('fail-open: si la detección de package identity falla, el check procede (instalación clásica)', async () => {
    invokeMock.mockRejectedValue(new Error('IPC not ready'));
    checkMock.mockResolvedValue({ available: false });

    const result = await service.checkForUpdates(true);

    expect(checkMock).toHaveBeenCalled();
    expect(result.available).toBe(false);
    expect(loggerMock.warn).toHaveBeenCalled();
  });

  it('loguea info cuando se salta por wasCheckedRecently', async () => {
    checkMock.mockResolvedValue({ available: false });
    // Primer check: registra lastCheckTime
    await service.checkForUpdates(true);
    loggerMock.info.mockClear();
    checkMock.mockClear();

    // Segundo check sin force: debe saltar por wasCheckedRecently
    const result = await service.checkForUpdates(false);

    expect(checkMock).not.toHaveBeenCalled();
    expect(result.available).toBe(false);
    const infoLogs = loggerMock.info.mock.calls.map(call => call[0] as string);
    expect(infoLogs.some(msg => msg.includes('Skipping check'))).toBe(true);
  });
});
