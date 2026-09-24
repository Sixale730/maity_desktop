/**
 * Variantes del aviso de actualización del canal Store (captura de Julio, 2026-09-23):
 * - el pie con 3 botones `whitespace-nowrap` ensanchaba la columna del grid y los
 *   números de versión + la caja gris se salían del card;
 * - StoreContext no expone el número nuevo (e4f31b1 leía el paquete INSTALADO y habría
 *   dicho "Actual X / Nueva X");
 * - una copia de prueba (firma `developer`) no la actualiza la Store: el aviso debe
 *   pedir reinstalar, no mandar a "Obtener actualizaciones".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const openExternalUrlMock = vi.fn(async (_url: string) => undefined);

vi.mock('@tauri-apps/plugin-updater', () => ({ check: vi.fn(async () => null), Update: class {} }));
vi.mock('@tauri-apps/plugin-process', () => ({ exit: vi.fn(), relaunch: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), Channel: class { onmessage: unknown = null } }));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/fileLogger', () => ({ fileLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/planLinks', () => ({ openExternalUrl: (url: string) => openExternalUrlMock(url) }));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import { UpdateDialog } from './UpdateDialog';
import type { UpdateInfo } from '@/services/updateService';
import { STORE_PDP_DEEP_LINK } from '@/lib/storeChannel';
import { invoke } from '@tauri-apps/api/core';
import { check } from '@tauri-apps/plugin-updater';
import { exit, relaunch } from '@tauri-apps/plugin-process';
import { toast } from 'sonner';
import { beginPostStop, endPostStop } from '@/lib/postStopState';

function renderDialog(updateInfo: UpdateInfo) {
  return render(<UpdateDialog open onOpenChange={() => {}} updateInfo={updateInfo} />);
}

describe('UpdateDialog — canal Store', () => {
  beforeEach(() => {
    openExternalUrlMock.mockClear();
    vi.mocked(invoke).mockReset();
    vi.mocked(exit).mockClear();
    vi.mocked(toast.warning).mockClear();
    vi.mocked(toast.error).mockClear();
  });

  const configInfo: UpdateInfo = {
    available: true,
    currentVersion: '0.2.60',
    channel: 'store',
    storeSource: 'config',
    version: '0.2.61',
  };

  function mockStoreExit(exitForUpdate: () => Promise<unknown>) {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'get_recording_state') return { is_recording: false, phase: 'idle' };
      if (cmd === 'exit_for_update') return exitForUpdate();
      return undefined;
    });
  }

  it('Cerrar Maity para actualizar invoca exit_for_update y no plugin-process exit', async () => {
    mockStoreExit(async () => undefined);
    renderDialog(configInfo);
    fireEvent.click(screen.getByRole('button', { name: /Cerrar Maity para actualizar/ }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('exit_for_update'));
    expect(exit).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('rechazo recording_active muestra el aviso de grabación', async () => {
    mockStoreExit(() => Promise.reject('recording_active'));
    renderDialog(configInfo);
    fireEvent.click(screen.getByRole('button', { name: /Cerrar Maity para actualizar/ }));

    await waitFor(() =>
      expect(toast.warning).toHaveBeenCalledWith(
        'Hay una grabación en curso. Detenla antes de cerrar Maity para actualizar.',
      ),
    );
    expect(toast.error).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });

  it('StoreContext sin número: no pinta "Nueva Versión" y ofrece "Actualizar ahora"', () => {
    renderDialog({ available: true, currentVersion: '0.2.62', channel: 'store', storeSource: 'api' });

    expect(screen.getByText('Hay una versión nueva de Maity en la Microsoft Store')).toBeInTheDocument();
    expect(screen.queryByText('Nueva Versión:')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Actualizar ahora/ })).toBeInTheDocument();
  });

  it('nunca pinta una "Nueva Versión" igual a la actual', () => {
    renderDialog({ available: true, currentVersion: '0.2.62', channel: 'store', storeSource: 'api', version: '0.2.62.0' });

    expect(screen.queryByText('Nueva Versión:')).not.toBeInTheDocument();
    expect(screen.queryByText(/Maity 0\.2\.62/)).not.toBeInTheDocument();
  });

  it('respaldo por system_config: muestra la versión nueva y "Cerrar Maity para actualizar"', () => {
    renderDialog({ available: true, currentVersion: '0.2.60', channel: 'store', storeSource: 'config', version: '0.2.61' });

    expect(screen.getByText('Maity 0.2.61 ya está publicada en la Microsoft Store')).toBeInTheDocument();
    expect(screen.getByText('Nueva Versión:')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cerrar Maity para actualizar/ })).toBeInTheDocument();
  });

  it('copia de prueba: pide reinstalar desde la Store y no ofrece actualizar ni cerrar', () => {
    renderDialog({ available: true, currentVersion: '0.2.60', channel: 'store', storeSource: 'sideload', version: '0.2.61' });

    expect(screen.getByText('Esta copia de Maity no se actualiza sola')).toBeInTheDocument();
    expect(screen.getByText(/se instaló con un paquete de prueba/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Actualizar ahora/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Cerrar Maity para actualizar/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Obtener actualizaciones/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Abrir Maity en la Store/ }));
    expect(openExternalUrlMock).toHaveBeenCalledWith(STORE_PDP_DEEP_LINK);
  });

  it('layout: la columna del grid no crece con el contenido y el pie envuelve los botones', () => {
    renderDialog({ available: true, currentVersion: '0.2.60', channel: 'store', storeSource: 'config', version: '0.2.61' });

    expect(screen.getByRole('dialog').className).toContain('grid-cols-[minmax(0,1fr)]');
    const footer = screen.getByRole('button', { name: /Cerrar Maity para actualizar/ }).parentElement;
    expect(footer?.className).toContain('sm:flex-wrap');
  });
});

/**
 * Canal directo (NSIS), B2 (#83): el plugin termina en `process::exit(0)` y se salta
 * `RunEvent::Exit`, así que el diálogo NUNCA instala desde JS — invoca el comando Rust
 * `direct_update_install` — y se niega antes con grabación viva o post-proceso en vuelo.
 */
describe('UpdateDialog — canal directo (NSIS)', () => {
  const githubInfo: UpdateInfo = { available: true, currentVersion: '0.2.61', version: '0.2.62', channel: 'github' };
  const downloadAndInstallSpy = vi.fn();
  const installSpy = vi.fn();

  function mockInvoke({ phase, outcome }: { phase: string; outcome?: unknown }) {
    vi.mocked(invoke).mockImplementation(async (cmd: string) =>
      cmd === 'get_recording_state'
        ? { is_recording: phase === 'recording', phase }
        : cmd === 'direct_update_install'
          ? outcome
          : undefined,
    );
  }

  function directInstallCalls() {
    return vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === 'direct_update_install');
  }

  async function clickInstall() {
    fireEvent.click(await screen.findByRole('button', { name: /Descargar e Instalar/ }));
  }

  beforeEach(() => {
    vi.mocked(check).mockResolvedValue({
      available: true,
      version: '0.2.62',
      downloadAndInstall: downloadAndInstallSpy,
      install: installSpy,
    } as never);
    vi.mocked(invoke).mockReset();
    vi.mocked(toast.warning).mockClear();
    vi.mocked(toast.error).mockClear();
    vi.mocked(toast.info).mockClear();
    vi.mocked(toast.success).mockClear();
    vi.mocked(relaunch).mockClear();
    downloadAndInstallSpy.mockClear();
    installSpy.mockClear();
  });

  afterEach(() => {
    endPostStop();
    endPostStop();
    endPostStop();
    vi.mocked(check).mockResolvedValue(null as never);
  });

  it('(1) fase recording: toast de grabación en curso y no invoca el comando', async () => {
    mockInvoke({ phase: 'recording' });
    renderDialog(githubInfo);
    await clickInstall();

    await waitFor(() =>
      expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('Hay una grabación en curso')),
    );
    expect(directInstallCalls()).toHaveLength(0);
  });

  it('(2) fase stopping también se niega', async () => {
    mockInvoke({ phase: 'stopping' });
    renderDialog(githubInfo);
    await clickInstall();

    await waitFor(() =>
      expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('Hay una grabación en curso')),
    );
    expect(directInstallCalls()).toHaveLength(0);
  });

  it('(3) idle con post-proceso en vuelo: toast y no invoca el comando', async () => {
    mockInvoke({ phase: 'idle', outcome: { kind: 'restarting' } });
    beginPostStop();
    renderDialog(githubInfo);
    await clickInstall();

    await waitFor(() =>
      expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('guardando o transcribiendo')),
    );
    expect(directInstallCalls()).toHaveLength(0);
  });

  it('(4) outcome error: pinta el detalle y toast.error', async () => {
    mockInvoke({ phase: 'idle', outcome: { kind: 'error', detail: 'boom' } });
    renderDialog(githubInfo);
    await clickInstall();

    expect(await screen.findByText('boom')).toBeInTheDocument();
    expect(toast.error).toHaveBeenCalled();
  });

  it('(5) outcome recordingActive: toast y sale de "Descargando"', async () => {
    mockInvoke({ phase: 'idle', outcome: { kind: 'recordingActive' } });
    renderDialog(githubInfo);
    await clickInstall();

    await waitFor(() => expect(toast.warning).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText('Descargando Actualización')).not.toBeInTheDocument());
  });

  it('(6) outcome postProcessing: toast.warning', async () => {
    mockInvoke({ phase: 'idle', outcome: { kind: 'postProcessing' } });
    renderDialog(githubInfo);
    await clickInstall();

    await waitFor(() =>
      expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('guardando o transcribiendo')),
    );
  });

  it('(7) instala solo por direct_update_install: nunca downloadAndInstall, install ni relaunch', async () => {
    mockInvoke({ phase: 'idle', outcome: { kind: 'noUpdate' } });
    renderDialog(githubInfo);
    await clickInstall();

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('direct_update_install', { onEvent: expect.any(Object) }),
    );
    expect(downloadAndInstallSpy).not.toHaveBeenCalled();
    expect(installSpy).not.toHaveBeenCalled();
    expect(relaunch).not.toHaveBeenCalled();
  });

  it('(8) un re-check del tray a media descarga no resetea el diálogo', async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'get_recording_state') return { is_recording: false, phase: 'idle' };
      if (cmd === 'direct_update_install') return new Promise(() => {});
      return undefined;
    });
    const { rerender } = renderDialog(githubInfo);
    await clickInstall();

    expect(await screen.findByText('Descargando Actualización')).toBeInTheDocument();
    rerender(<UpdateDialog open onOpenChange={() => {}} updateInfo={{ ...githubInfo }} />);
    // Deja correr los efectos del re-render antes de afirmar.
    await waitFor(() => expect(directInstallCalls()).toHaveLength(1));
    expect(screen.getByText('Descargando Actualización')).toBeInTheDocument();
  });
});
