import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: vi.fn(),
  Update: class {},
}));

vi.mock('@tauri-apps/api/app', () => ({
  getVersion: vi.fn(),
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

import { check } from '@tauri-apps/plugin-updater';
import { getVersion } from '@tauri-apps/api/app';
import { logger } from '@/lib/logger';
import { UpdateService } from './updateService';

const checkMock = vi.mocked(check);
const getVersionMock = vi.mocked(getVersion);
const loggerMock = vi.mocked(logger);

describe('UpdateService — logging visible y resultados', () => {
  let service: UpdateService;

  beforeEach(() => {
    service = new UpdateService();
    checkMock.mockReset();
    getVersionMock.mockReset();
    loggerMock.info.mockClear();
    loggerMock.warn.mockClear();
    loggerMock.error.mockClear();
    getVersionMock.mockResolvedValue('0.2.35');
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
