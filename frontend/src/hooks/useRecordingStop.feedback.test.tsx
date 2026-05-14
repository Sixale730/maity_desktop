import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// --- Mocks ---
const routerPushMock = vi.fn();
const saveMeetingMock = vi.fn();
const markMeetingAsSavedMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPushMock }),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => () => undefined),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async () => 1),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: vi.fn(async () => ({ data: { session: null } })) },
    from: () => ({ select: () => ({ eq: () => ({ single: vi.fn(async () => ({ data: null })) }) }) }),
  },
}));

vi.mock('@/lib/analytics', () => ({
  default: {
    trackPageView: vi.fn(),
    trackMeetingCompleted: vi.fn(async () => undefined),
    getMeetingsCountToday: vi.fn(async () => 1),
    updateMeetingCount: vi.fn(async () => undefined),
    identify: vi.fn(async () => undefined),
    track: vi.fn(async () => undefined),
    calculateDaysSince: vi.fn(async () => 0),
    getCurrentUserId: vi.fn(() => 'u1'),
  },
}));

vi.mock('@/services/storageService', () => ({
  storageService: {
    saveMeeting: (...args: unknown[]) => saveMeetingMock(...args),
    getMeeting: vi.fn(async () => ({ id: 'meeting-test-id', title: 'Test' })),
  },
}));

vi.mock('@/services/recordingLogService', () => ({
  recordingLogService: {
    log: vi.fn(),
    setMeetingId: vi.fn(),
    syncToCloud: vi.fn(),
  },
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ maityUser: { id: 'user-1' } }),
}));

vi.mock('@/contexts/ConfigContext', () => ({
  useConfig: () => ({ transcriptModelConfig: { language: 'es' } }),
}));

const transcriptsRef = { current: [{ text: 'hola', sequence_id: 1, source_type: 'user' as const }] };
const flushBufferMock = vi.fn();
const clearTranscriptsMock = vi.fn();

vi.mock('@/contexts/TranscriptContext', () => ({
  useTranscripts: () => ({
    transcriptsRef,
    flushBuffer: flushBufferMock,
    clearTranscripts: clearTranscriptsMock,
    meetingTitle: 'Test Meeting',
    markMeetingAsSaved: markMeetingAsSavedMock,
  }),
}));

vi.mock('@/components/Sidebar/SidebarProvider', () => ({
  useSidebar: () => ({
    refetchMeetings: vi.fn(async () => undefined),
    setCurrentMeeting: vi.fn(),
    setIsMeetingActive: vi.fn(),
  }),
}));

const setStatusMock = vi.fn();

vi.mock('@/contexts/RecordingStateContext', () => ({
  useRecordingState: () => ({
    status: 'idle',
    setStatus: setStatusMock,
    isStopping: false,
    isProcessing: false,
    isSaving: false,
  }),
  RecordingStatus: {
    IDLE: 'idle',
    STOPPING: 'stopping',
    PROCESSING_TRANSCRIPTS: 'processing',
    SAVING: 'saving',
    ERROR: 'error',
    RECORDING: 'recording',
  },
}));

vi.mock('@tauri-apps/plugin-store', () => ({
  Store: { load: vi.fn(async () => ({ get: vi.fn(async () => 1) })) },
}));

import { useRecordingStop } from './useRecordingStop';

describe('useRecordingStop — feedback no bloqueante', () => {
  // Capturador de window.location.href: el hook usa hard navigate
  // (`window.location.href = ...`) en lugar de router.push() para curar
  // dashboard hung post-stop (commits c188ec1 / f3c555a). JSDOM no permite
  // setear location.href directamente, así que reemplazamos el objeto
  // location entero con un setter capturable.
  let locationHrefHistory: string[] = [];
  let originalLocation: Location;

  beforeEach(() => {
    routerPushMock.mockReset();
    saveMeetingMock.mockReset();
    markMeetingAsSavedMock.mockReset();
    flushBufferMock.mockReset();
    setStatusMock.mockReset();
    sessionStorage.clear();
    saveMeetingMock.mockResolvedValue({ meeting_id: 'meeting-test-id' });
    markMeetingAsSavedMock.mockResolvedValue(undefined);

    // Reemplazar window.location con proxy capturable
    originalLocation = window.location;
    locationHrefHistory = [];
    let currentHref = 'http://localhost/';
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...originalLocation,
        get href() { return currentHref; },
        set href(value: string) {
          currentHref = value;
          locationHrefHistory.push(value);
        },
        assign: (url: string) => { locationHrefHistory.push(url); },
        replace: (url: string) => { locationHrefHistory.push(url); },
      },
    });
  });

  afterEach(() => {
    sessionStorage.clear();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
  });

  it('escribe feedback_pending_meeting_id en sessionStorage antes de navegar', async () => {
    const setIsRecordingDisabled = vi.fn();
    const { result } = renderHook(() => useRecordingStop(setIsRecordingDisabled));

    await act(async () => {
      await result.current.handleRecordingStop(true);
    });

    expect(sessionStorage.getItem('feedback_pending_meeting_id')).toBe('meeting-test-id');
    // El hook hace hard navigate via window.location.href (no router.push)
    // para forzar reload del JS context post-grabacion larga. Ver commits
    // c188ec1 / f3c555a — patron "supervised restart" tipo Slack/VS Code.
    expect(locationHrefHistory.some(
      (href) => href.includes('/conversations?localId=meeting-test-id')
    )).toBe(true);
  });

  it('NO bloquea la navegacion (no hay onBeforeNavigate ni await modal)', async () => {
    // El hook ya no acepta un callback bloqueante. La firma es solo:
    // useRecordingStop(setIsRecordingDisabled).
    const setIsRecordingDisabled = vi.fn();
    const { result } = renderHook(() => useRecordingStop(setIsRecordingDisabled));

    const start = Date.now();
    await act(async () => {
      await result.current.handleRecordingStop(true);
    });
    const elapsed = Date.now() - start;

    // Sin bloqueo en modal, el flujo termina rapido (< 2s tipico para
    // saveMeeting + 500ms de flush). Generosamente: < 3000ms.
    expect(elapsed).toBeLessThan(3000);
    // Hard navigate: exactamente 1 asignacion a window.location.href.
    expect(locationHrefHistory).toHaveLength(1);
  });
});
