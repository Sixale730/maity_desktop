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
  beforeEach(() => {
    routerPushMock.mockReset();
    saveMeetingMock.mockReset();
    markMeetingAsSavedMock.mockReset();
    flushBufferMock.mockReset();
    setStatusMock.mockReset();
    sessionStorage.clear();
    saveMeetingMock.mockResolvedValue({ meeting_id: 'meeting-test-id' });
    markMeetingAsSavedMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it('escribe feedback_pending_meeting_id en sessionStorage antes de navegar', async () => {
    const setIsRecordingDisabled = vi.fn();
    const { result } = renderHook(() => useRecordingStop(setIsRecordingDisabled));

    await act(async () => {
      await result.current.handleRecordingStop(true);
    });

    expect(sessionStorage.getItem('feedback_pending_meeting_id')).toBe('meeting-test-id');
    expect(routerPushMock).toHaveBeenCalledWith(
      expect.stringContaining('/conversations?localId=meeting-test-id')
    );
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
    expect(routerPushMock).toHaveBeenCalledTimes(1);
  });
});
