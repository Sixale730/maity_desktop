/**
 * Variantes del aviso de actualización del canal Store (captura de Julio, 2026-09-23):
 * - el pie con 3 botones `whitespace-nowrap` ensanchaba la columna del grid y los
 *   números de versión + la caja gris se salían del card;
 * - StoreContext no expone el número nuevo (e4f31b1 leía el paquete INSTALADO y habría
 *   dicho "Actual X / Nueva X");
 * - una copia de prueba (firma `developer`) no la actualiza la Store: el aviso debe
 *   pedir reinstalar, no mandar a "Obtener actualizaciones".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const openExternalUrlMock = vi.fn(async (_url: string) => undefined);

vi.mock('@tauri-apps/plugin-updater', () => ({ check: vi.fn(async () => null), Update: class {} }));
vi.mock('@tauri-apps/plugin-process', () => ({ exit: vi.fn(), relaunch: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
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

function renderDialog(updateInfo: UpdateInfo) {
  return render(<UpdateDialog open onOpenChange={() => {}} updateInfo={updateInfo} />);
}

describe('UpdateDialog — canal Store', () => {
  beforeEach(() => {
    openExternalUrlMock.mockClear();
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
