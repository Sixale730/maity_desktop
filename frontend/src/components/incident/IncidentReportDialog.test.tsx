/**
 * Bundle de incidente con consentimiento (#61) — invariantes del diálogo:
 * (1) nada se sube sin el click en "Enviar"; (2) el pull al montar abre el
 * diálogo aunque el push se haya perdido; (3) "No volver a preguntar" se
 * persiste y silencia los automáticos, pero NO el manual.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';

const invokeMock = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();
let tauriHandler: ((e: { payload: unknown }) => void) | null = null;

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));
vi.mock('@/lib/tauriSubscribe', () => ({
  subscribeTauriEvent: (_event: string, handler: (e: { payload: unknown }) => void) => {
    tauriHandler = handler;
    return () => {
      tauriHandler = null;
    };
  },
}));

import {
  IncidentReportDialog,
  requestManualIncidentDialog,
} from './IncidentReportDialog';

const PRESSURE = {
  kind: 'system-memory-pressure',
  ts_ms: 1,
  message: '700 MB disponibles de 8000 MB durante ≥60 s',
  detail: {},
};

function setup(opts: { pending?: unknown; prefs?: { never_ask: boolean } } = {}) {
  invokeMock.mockImplementation(async (cmd: string) => {
    switch (cmd) {
      case 'get_incident_preferences':
        return { never_ask: false, last_prompt_ms: {}, ...(opts.prefs ?? {}) };
      case 'take_pending_incident':
        return opts.pending ?? null;
      case 'upload_incident_bundle':
        return 'uid/20260826-1-system-memory-pressure-proc.txt';
      case 'set_incident_preferences':
        return undefined;
      default:
        throw new Error(`invoke no esperado: ${cmd}`);
    }
  });
  return render(<IncidentReportDialog />);
}

describe('IncidentReportDialog', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
    tauriHandler = null;
  });

  it('sin incidente pendiente no renderiza nada ni sube nada', async () => {
    setup();
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('take_pending_incident'));
    expect(screen.queryByTestId('incident-report-dialog')).not.toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalledWith('upload_incident_bundle', expect.anything());
    cleanup();
  });

  it('pull al montar: abre con el kind pendiente y "Enviar" sube ese kind', async () => {
    setup({ pending: PRESSURE });
    const dialog = await screen.findByTestId('incident-report-dialog');
    expect(dialog).toHaveAttribute('data-kind', 'system-memory-pressure');
    expect(screen.getByTestId('incident-message')).toHaveTextContent('700 MB');
    expect(screen.getByText(/No incluye audio ni transcripciones/)).toBeInTheDocument();
    // Nada se sube antes del click
    expect(invokeMock).not.toHaveBeenCalledWith('upload_incident_bundle', expect.anything());

    fireEvent.click(screen.getByTestId('incident-send'));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('upload_incident_bundle', {
        kind: 'system-memory-pressure',
        note: null,
      }),
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId('incident-report-dialog')).not.toBeInTheDocument());
    cleanup();
  });

  it('si la subida falla avisa con toast de error y cierra (sin reintentos)', async () => {
    setup({ pending: PRESSURE });
    await screen.findByTestId('incident-report-dialog');
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'upload_incident_bundle') throw 'El destino de diagnósticos no está disponible todavía';
      return undefined;
    });
    fireEvent.click(screen.getByTestId('incident-send'));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(String(toastError.mock.calls[0][1]?.description)).toMatch(/no está disponible/);
    await waitFor(() => expect(screen.queryByTestId('incident-report-dialog')).not.toBeInTheDocument());
    expect(invokeMock.mock.calls.filter((c) => c[0] === 'upload_incident_bundle')).toHaveLength(1);
    cleanup();
  });

  it('"Ahora no" + "No volver a preguntar" persiste never_ask=true sin subir nada', async () => {
    setup({ pending: PRESSURE });
    await screen.findByTestId('incident-report-dialog');
    fireEvent.click(screen.getByTestId('incident-never-ask'));
    fireEvent.click(screen.getByText('Ahora no'));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('set_incident_preferences', {
        preferences: expect.objectContaining({ never_ask: true }),
      }),
    );
    expect(invokeMock).not.toHaveBeenCalledWith('upload_incident_bundle', expect.anything());
    await waitFor(() => expect(screen.queryByTestId('incident-report-dialog')).not.toBeInTheDocument());
    cleanup();
  });

  it('con never_ask un incidente automático NO abre, pero el manual sí', async () => {
    setup({ pending: PRESSURE, prefs: { never_ask: true } });
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('take_pending_incident'));
    expect(screen.queryByTestId('incident-report-dialog')).not.toBeInTheDocument();

    requestManualIncidentDialog();
    const dialog = await screen.findByTestId('incident-report-dialog');
    expect(dialog).toHaveAttribute('data-kind', 'manual');
    // El manual no ofrece "no volver a preguntar" (no tiene sentido)
    expect(screen.queryByTestId('incident-never-ask')).not.toBeInTheDocument();
    cleanup();
  });

  it('push incident-detected abre el diálogo con ese kind', async () => {
    setup();
    await waitFor(() => expect(tauriHandler).not.toBeNull());
    tauriHandler!({ payload: { kind: 'rust-panic', ts_ms: 2, message: 'Maity se cerró inesperadamente: boom' } });
    const dialog = await screen.findByTestId('incident-report-dialog');
    expect(dialog).toHaveAttribute('data-kind', 'rust-panic');
    expect(screen.getByTestId('incident-message')).toHaveTextContent('boom');
    cleanup();
  });

  it('ignora payloads con kind desconocido', async () => {
    setup({ pending: { kind: 'algo-nuevo', ts_ms: 1, message: 'x' } });
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('take_pending_incident'));
    expect(screen.queryByTestId('incident-report-dialog')).not.toBeInTheDocument();
    cleanup();
  });
});
