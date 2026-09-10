/**
 * Stop en modo LOTE (F4 de la migración a lote) — y la garantía de que el modo
 * con el que se ramifica es el de ESTA sesión.
 *
 * En lote la sesión grabó SÓLO audio: Rust encoló el segmento en
 * `batch_transcription_queue` y la reunión llega después por
 * `batch-transcription-status {ready}`. Antes de F4 el stop caía en la rama
 * "0 transcripts": fusionaba checkpoints por duplicado con el planner y
 * mostraba "Reunión sin transcripción". Estas pruebas fijan la política:
 *   - lote ⇒ ni `saveMeeting`, ni checkpoints, ni `enqueueCloudSync`; se marca
 *     el registro IndexedDB, se limpian las keys de sesión, se ancla la carpeta
 *     para navegar al `ready` y se hace soft-navigate a /conversations;
 *   - lote CON transcripts (imposible hoy; barato de cubrir) ⇒ igual — el
 *     dueño del guardado es el planner, guardar aquí duplicaría la reunión;
 *   - streaming ⇒ la rama A sigue intacta (guardado + hard navigate).
 *
 * Y la parte que la refutación tumbó: la decisión lote/streaming se toma por
 * el `recording-stopped` de ESTA sesión (un deferred por `recording-started`),
 * NUNCA por sessionStorage. Con la Promise vieja, que nadie reseteaba al
 * arrancar, desde el segundo stop el await resolvía contra el evento de la
 * sesión ANTERIOR y una key rancia decidía: lote + key ausente → rama B
 * mezclaba checkpoints sobre la carpeta del planner; key `batch` rancia + stop
 * streaming → se saltaba el guardado y marcaba IndexedDB como guardado.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// --- Mocks ---
const routerPushMock = vi.fn();
const saveMeetingMock = vi.fn();
const markMeetingAsSavedMock = vi.fn();
const setIsMeetingActiveMock = vi.fn();

// Handlers de `listen()` capturados por nombre de evento para poder disparar
// `recording-started` / `recording-stopped` a mano, como los emite Rust.
const listenHandlers: Record<string, (e: { payload: unknown }) => void> = {};

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPushMock }),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (event: string, handler: (e: { payload: unknown }) => void) => {
    listenHandlers[event] = handler;
    return () => undefined;
  }),
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

const transcriptsRef = { current: [] as Array<{ text: string; sequence_id: number; source_type: 'user' }> };
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
    setIsMeetingActive: (...args: unknown[]) => setIsMeetingActiveMock(...args),
  }),
}));

const setStatusMock = vi.fn();

vi.mock('@/contexts/RecordingStateContext', () => ({
  useRecordingState: () => ({
    status: 'idle',
    isRecording: false,
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

import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { logger } from '@/lib/logger';
import { useRecordingStop, RECORDING_STOPPED_WAIT_MS } from './useRecordingStop';

const FOLDER = 'C:/meetings/reunion-lote';
const FOLDER_2 = 'C:/meetings/reunion-lote-2';
const SESSION_KEYS = [
  'last_recording_folder_path',
  'last_recording_meeting_name',
  'last_recording_duration_seconds',
  'last_recording_started_at',
  'early_meeting_id',
  'active_recording_mode',
  'indexeddb_current_meeting_id',
  'last_recording_transcription_mode',
];

function invokedCommands(): string[] {
  return vi.mocked(invoke).mock.calls.map(([cmd]) => cmd as string);
}

/** Rust emite `recording-started` al arrancar CADA sesión (manual, scheduler, rotación). */
function emitStarted() {
  const onStarted = listenHandlers['recording-started'];
  expect(onStarted, 'listener de recording-started').toBeTypeOf('function');
  onStarted({ payload: { message: 'started' } });
}

/** Rust emite `recording-stopped` al cerrar la sesión; `transcription_mode` es aditivo. */
function emitStopped(payload: {
  folder_path?: string;
  meeting_name?: string;
  duration_seconds?: number;
  started_at?: string;
  transcription_mode?: 'batch' | 'streaming';
}) {
  const onStopped = listenHandlers['recording-stopped'];
  expect(onStopped, 'listener de recording-stopped').toBeTypeOf('function');
  onStopped({ payload: { message: 'stopped', ...payload } });
}

/** Keys que escriben OTROS hooks al arrancar (useRecordingStart / TranscriptContext). */
function seedStartKeys() {
  sessionStorage.setItem('early_meeting_id', 'early-1');
  sessionStorage.setItem('active_recording_mode', 'conversation');
  sessionStorage.setItem('indexeddb_current_meeting_id', 'meeting-123');
}

/** Sesión completa como la ve el hook: arranque + cierre con su modo. */
function runSession(mode: 'batch' | 'streaming' | undefined, folder = FOLDER) {
  emitStarted();
  seedStartKeys();
  emitStopped({
    folder_path: folder,
    meeting_name: 'Reunión',
    duration_seconds: 180,
    started_at: '2026-09-10T10:00:00Z',
    transcription_mode: mode,
  });
}

function expectBatchBranch(folder: string) {
  expect(saveMeetingMock).not.toHaveBeenCalled();
  expect(invokedCommands()).not.toContain('has_audio_checkpoints');
  expect(invokedCommands()).not.toContain('recover_audio_from_checkpoints');
  expect(invokedCommands()).not.toContain('sync_queue_enqueue');
  expect(markMeetingAsSavedMock).toHaveBeenCalledTimes(1);
  expect(routerPushMock).toHaveBeenCalledWith('/conversations');
  expect(sessionStorage.getItem('batch_pending_navigation')).toBe(folder);
}

function expectStreamingBranchSaved() {
  expect(saveMeetingMock).toHaveBeenCalledTimes(1);
  expect(routerPushMock).not.toHaveBeenCalledWith('/conversations');
  expect(sessionStorage.getItem('batch_pending_navigation')).toBeNull();
  // En streaming IndexedDB se marca DESPUÉS de guardar en SQLite — nunca "como
  // fantasma de lote" (que marca sin guardar).
  expect(markMeetingAsSavedMock).toHaveBeenCalledTimes(1);
  expect(markMeetingAsSavedMock.mock.invocationCallOrder[0]).toBeGreaterThan(
    saveMeetingMock.mock.invocationCallOrder[0]
  );
}

describe('useRecordingStop — stop en modo lote', () => {
  let originalLocation: Location;
  let locationHrefHistory: string[] = [];

  beforeEach(() => {
    routerPushMock.mockReset();
    saveMeetingMock.mockReset();
    markMeetingAsSavedMock.mockReset();
    markMeetingAsSavedMock.mockResolvedValue(undefined);
    setIsMeetingActiveMock.mockReset();
    flushBufferMock.mockReset();
    clearTranscriptsMock.mockReset();
    setStatusMock.mockReset();
    vi.mocked(invoke).mockClear();
    vi.mocked(invoke).mockImplementation(async () => 1);
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.info).mockReset();
    vi.mocked(logger.warn).mockReset();
    sessionStorage.clear();
    transcriptsRef.current = [];
    saveMeetingMock.mockResolvedValue({ meeting_id: 'meeting-test-id' });
    for (const key of Object.keys(listenHandlers)) delete listenHandlers[key];

    // Capturador de hard navigate (rama A): JSDOM no deja asignar location.href.
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
    vi.useRealTimers();
    sessionStorage.clear();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
  });

  it('lote sin transcripts: no guarda, no toca checkpoints, no encola sync; navega a /conversations con las keys limpias', async () => {
    const setIsRecordingDisabled = vi.fn();
    const { result } = renderHook(() => useRecordingStop(setIsRecordingDisabled));
    runSession('batch');

    await act(async () => {
      await result.current.handleRecordingStop(true);
    });

    // Nada del camino de streaming.
    expectBatchBranch(FOLDER);
    expect(flushBufferMock).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled(); // no "Reunión sin transcripción"

    // Keys de sesión limpias + ancla de navegación para el `ready`.
    for (const key of SESSION_KEYS) {
      expect(sessionStorage.getItem(key), key).toBeNull();
    }

    // Estado de UI reseteado y el botón de grabar vuelve a estar vivo.
    expect(clearTranscriptsMock).toHaveBeenCalled();
    expect(setIsMeetingActiveMock).toHaveBeenCalledWith(false);
    expect(setStatusMock).toHaveBeenCalledWith('idle');
    expect(setIsRecordingDisabled).toHaveBeenLastCalledWith(false);

    // Soft navigate a la lista (no hard navigate), sin esperar ningún tope.
    expect(locationHrefHistory).toHaveLength(0);
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('lote CON transcripts: tampoco guarda (el dueño es el planner; guardar aquí duplicaría la reunión)', async () => {
    const { result } = renderHook(() => useRecordingStop(vi.fn()));
    runSession('batch');
    transcriptsRef.current = [{ text: 'hola', sequence_id: 1, source_type: 'user' }];

    await act(async () => {
      await result.current.handleRecordingStop(true);
    });

    expectBatchBranch(FOLDER);
    expect(locationHrefHistory).toHaveLength(0);
    expect(sessionStorage.getItem('last_recording_transcription_mode')).toBeNull();
  });

  it('streaming con transcripts: la rama A sigue intacta (guarda y hace hard navigate) y limpia la key del modo', async () => {
    const { result } = renderHook(() => useRecordingStop(vi.fn()));
    runSession('streaming');
    transcriptsRef.current = [{ text: 'hola', sequence_id: 1, source_type: 'user' }];

    await act(async () => {
      await result.current.handleRecordingStop(true);
    });

    expectStreamingBranchSaved();
    expect(locationHrefHistory.some((h) => h.includes('/conversations?localId=meeting-test-id'))).toBe(true);
    expect(sessionStorage.getItem('last_recording_transcription_mode')).toBeNull();
  });

  it('segundo stop en LOTE tras un stop streaming previo (misma instancia): ramifica por el evento de la sesión nueva', async () => {
    const { result } = renderHook(() => useRecordingStop(vi.fn()));

    // Sesión 1: streaming, con transcripts → guarda.
    runSession('streaming', FOLDER);
    transcriptsRef.current = [{ text: 'hola', sequence_id: 1, source_type: 'user' }];
    await act(async () => {
      await result.current.handleRecordingStop(true);
    });
    expect(saveMeetingMock).toHaveBeenCalledTimes(1);
    expect(locationHrefHistory).toHaveLength(1);

    // Misma instancia del hook (el provider vive en el root layout): sesión 2 en lote.
    saveMeetingMock.mockClear();
    markMeetingAsSavedMock.mockClear();
    routerPushMock.mockClear();
    vi.mocked(invoke).mockClear();
    vi.mocked(toast.info).mockClear(); // la sesión 1 mostró "Sincronizando con la nube..."
    transcriptsRef.current = [];
    runSession('batch', FOLDER_2);

    await act(async () => {
      await result.current.handleRecordingStop(true);
    });

    // Con la Promise vieja el await resolvía contra la sesión 1 y, con la key
    // del modo ya limpiada por la rama A, el stop de lote caía en la rama B:
    // `has_audio_checkpoints`/`recover_audio_from_checkpoints` sobre la carpeta
    // del planner + "Reunión sin transcripción". Ahora decide el evento de la
    // sesión 2.
    expectBatchBranch(FOLDER_2);
    expect(toast.info).not.toHaveBeenCalledWith('Reunión sin transcripción', expect.anything());
    expect(locationHrefHistory).toHaveLength(1); // no hubo segundo hard navigate
  });

  it('dirección inversa: stop streaming tras un stop en lote previo — el `batch` de la sesión anterior no se hereda', async () => {
    const { result } = renderHook(() => useRecordingStop(vi.fn()));

    // Sesión 1: lote.
    runSession('batch', FOLDER);
    await act(async () => {
      await result.current.handleRecordingStop(true);
    });
    expectBatchBranch(FOLDER);

    // Sesión 2: Rust viejo (sin campo) o streaming; hay transcripts que guardar.
    saveMeetingMock.mockClear();
    markMeetingAsSavedMock.mockClear();
    routerPushMock.mockClear();
    sessionStorage.removeItem('batch_pending_navigation');
    transcriptsRef.current = [{ text: 'hola', sequence_id: 1, source_type: 'user' }];
    runSession(undefined, FOLDER_2);

    await act(async () => {
      await result.current.handleRecordingStop(true);
    });

    // Con una key `batch` rancia esto se saltaba `saveMeeting` (pérdida de la
    // reunión) y marcaba IndexedDB como guardado. Ahora guarda.
    expectStreamingBranchSaved();
    expect(locationHrefHistory.some((h) => h.includes('/conversations?localId=meeting-test-id'))).toBe(true);
  });

  it('carrera: el stop empieza ANTES de que llegue recording-stopped → espera el evento de esta sesión y ramifica por él', async () => {
    const { result } = renderHook(() => useRecordingStop(vi.fn()));
    emitStarted();
    seedStartKeys();

    // `invoke('stop_recording')` resolvió y RecordingControls llamó al stop,
    // pero el evento viaja por otro canal IPC y aún no se entregó.
    let stopPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      stopPromise = result.current.handleRecordingStop(true);
      emitStopped({ folder_path: FOLDER, transcription_mode: 'batch' });
      await stopPromise;
    });

    expectBatchBranch(FOLDER);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('stop sin evento fresco (vence el tope): streaming aunque la key diga `batch` — guarda, no marca IndexedDB como fantasma de lote', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useRecordingStop(vi.fn()));
    emitStarted();
    // Restos rancios de otra sesión: la decisión NO puede leerlos.
    sessionStorage.setItem('last_recording_transcription_mode', 'batch');
    sessionStorage.setItem('last_recording_folder_path', FOLDER);
    transcriptsRef.current = [{ text: 'hola', sequence_id: 1, source_type: 'user' }];

    // Sin `act`: el hook no tiene estado React propio (los setters son mocks).
    const stopPromise = result.current.handleRecordingStop(true);
    // Tope de espera + el flush de 500 ms de la rama de streaming.
    await vi.advanceTimersByTimeAsync(RECORDING_STOPPED_WAIT_MS + 1000);
    await stopPromise;

    expectStreamingBranchSaved();
    expect(locationHrefHistory.some((h) => h.includes('/conversations?localId=meeting-test-id'))).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Sin `recording-stopped` fresco'),
      expect.objectContaining({ waited_ms: RECORDING_STOPPED_WAIT_MS })
    );
  });

  it('instancia que nunca vio la sesión (ni started ni stopped): streaming de inmediato, sin esperar el tope', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useRecordingStop(vi.fn()));
    transcriptsRef.current = [{ text: 'hola', sequence_id: 1, source_type: 'user' }];

    const stopPromise = result.current.handleRecordingStop(true);
    // Sólo el flush de 500 ms: si el hook esperara los 3 s, esta promesa no
    // resolvería y el test vencería por timeout.
    await vi.advanceTimersByTimeAsync(600);
    await stopPromise;

    expectStreamingBranchSaved();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Sin `recording-stopped` fresco'),
      expect.objectContaining({ waited_ms: 0 })
    );
  });

  it('el listener de recording-stopped escribe el espejo del modo (`batch`) y las keys de la sesión', async () => {
    renderHook(() => useRecordingStop(vi.fn()));
    emitStopped({ folder_path: FOLDER, transcription_mode: 'batch' });
    expect(sessionStorage.getItem('last_recording_transcription_mode')).toBe('batch');
    expect(sessionStorage.getItem('last_recording_folder_path')).toBe(FOLDER);
  });

  it('el espejo del modo se sobrescribe en cada recording-stopped y recording-started lo borra', async () => {
    renderHook(() => useRecordingStop(vi.fn()));
    sessionStorage.setItem('last_recording_transcription_mode', 'batch');

    // Rust viejo (sin el campo) o sesión streaming: el listener escribe 'streaming'.
    emitStopped({ folder_path: FOLDER });
    expect(sessionStorage.getItem('last_recording_transcription_mode')).toBe('streaming');

    // Arranque de la siguiente sesión: el espejo de la anterior desaparece.
    emitStarted();
    expect(sessionStorage.getItem('last_recording_transcription_mode')).toBeNull();
  });
});
