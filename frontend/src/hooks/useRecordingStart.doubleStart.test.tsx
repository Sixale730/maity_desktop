import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/**
 * Regresión del doble arranque (piloto Dingler, ago-2026):
 * `Failed to start recording via tauri command: Recording start already in progress`
 * apareció en 5 usuarias distintas.
 *
 * El guard de Rust (StartGate::acquire, recording_phase.rs) siempre funcionó —
 * ese error ES el guard haciendo su trabajo. El bug estaba en el frontend: los
 * listeners de arranque guardaban con `isAutoStarting`, que es estado de React y
 * por tanto sólo se ve en el siguiente render. Dos disparos en el mismo tick
 * pasaban ambos el `if`, llegaban ambos al backend, y el segundo dejaba la UI en
 * ERROR mientras el backend grababa de verdad.
 *
 * Estos tests fallan con el guard basado en estado y pasan con el guard por ref.
 */

const startRecordingWithDevicesMock = vi.fn();
const setStatusMock = vi.fn();
const setIsRecordingMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  // parakeet_init -> undefined, parakeet_has_available_models -> true
  invoke: vi.fn(async (cmd: string) => (cmd === 'parakeet_has_available_models' ? true : undefined)),
}));

vi.mock('@/lib/tauriSubscribe', () => ({
  createSubscriptionGroup: () => ({ on: vi.fn(), dispose: vi.fn() }),
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ getQueryData: () => null }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ maityUser: { id: 'user-1' } }),
}));

vi.mock('@/hooks/usePlanStatus', () => ({
  PRESENTER_MODE_FEATURE: 'presenter_mode',
  QUOTA_STATUS_QUERY_KEY: 'quota-status',
  isFeatureEnabled: () => true,
}));

vi.mock('@/contexts/TranscriptContext', () => ({
  useTranscripts: () => ({ clearTranscripts: vi.fn(), setMeetingTitle: vi.fn() }),
}));

vi.mock('@/components/Sidebar/SidebarProvider', () => ({
  useSidebar: () => ({ setIsMeetingActive: vi.fn() }),
}));

vi.mock('@/contexts/ConfigContext', () => ({
  useConfig: () => ({
    selectedDevices: { micDevice: null, systemDevice: null },
    transcriptModelConfig: { provider: 'parakeet', model: 'parakeet-tdt-0.6b-v3-int8' },
    recordingMode: 'conversation',
  }),
}));

vi.mock('@/contexts/RecordingStateContext', () => ({
  useRecordingState: () => ({ setStatus: setStatusMock }),
  RecordingStatus: {
    IDLE: 'idle',
    STARTING: 'starting',
    RECORDING: 'recording',
    STOPPING: 'stopping',
    ERROR: 'error',
  },
}));

vi.mock('@/services/recordingService', () => ({
  recordingService: {
    startRecordingWithDevices: (...args: unknown[]) => startRecordingWithDevicesMock(...args),
  },
}));

vi.mock('@/services/recordingLogService', () => ({
  recordingLogService: {
    startSession: vi.fn(),
    setMeetingId: vi.fn(),
    log: vi.fn(),
  },
}));

vi.mock('@/lib/analytics', () => ({
  default: { trackButtonClick: vi.fn() },
}));

vi.mock('@/components/recording/recordingNotification', () => ({
  showRecordingNotification: vi.fn(async () => undefined),
}));

vi.mock('@/lib/nativeNotification', () => ({
  sendNativeNotification: vi.fn(async () => undefined),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('@/lib/deepgram', () => ({
  getDeepgramProxyConfig: vi.fn(),
  hasValidCachedProxyConfig: vi.fn(async () => false),
  DeepgramError: class DeepgramError extends Error {},
}));

import { useRecordingStart } from './useRecordingStart';

describe('useRecordingStart — guard síncrono contra doble arranque', () => {
  beforeEach(() => {
    startRecordingWithDevicesMock.mockReset();
    startRecordingWithDevicesMock.mockResolvedValue(undefined);
    setStatusMock.mockReset();
    setIsRecordingMock.mockReset();
    sessionStorage.clear();
  });

  it('dos eventos del sidebar en el mismo tick arrancan la grabación UNA sola vez', async () => {
    renderHook(() => useRecordingStart(false, setIsRecordingMock));

    await act(async () => {
      // El doble clic real: ambos eventos se despachan antes de que React
      // pueda re-renderizar con el estado transitorio actualizado.
      window.dispatchEvent(new CustomEvent('start-recording-from-sidebar'));
      window.dispatchEvent(new CustomEvent('start-recording-from-sidebar'));
      // Dejar que las cadenas async (checkTranscriptionReady -> invoke) drenen.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(startRecordingWithDevicesMock).toHaveBeenCalledTimes(1);
  });

  it('el guard se libera tras un arranque fallido (no bloquea reintentos)', async () => {
    startRecordingWithDevicesMock.mockRejectedValueOnce(new Error('dispositivo ocupado'));
    renderHook(() => useRecordingStart(false, setIsRecordingMock));

    await act(async () => {
      window.dispatchEvent(new CustomEvent('start-recording-from-sidebar'));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // Un fallo deja isStartingRef en false vía finally; si no, el usuario
    // quedaría sin poder reintentar hasta reiniciar la app.
    await act(async () => {
      window.dispatchEvent(new CustomEvent('start-recording-from-sidebar'));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(startRecordingWithDevicesMock).toHaveBeenCalledTimes(2);
    // Y el fallo no deja la UI creyendo que graba.
    expect(setIsRecordingMock).toHaveBeenCalledWith(false);
  });
});
