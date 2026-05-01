import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

type EventHandler = (event: { payload: unknown }) => void | Promise<void>;
const handlers = new Map<string, EventHandler>();

const listenMock = vi.fn(async (event: string, handler: EventHandler) => {
  handlers.set(event, handler);
  return () => handlers.delete(event);
});
const invokeMock = vi.fn(async () => undefined);

vi.mock('@tauri-apps/api/event', () => ({
  listen: (event: string, handler: EventHandler) => listenMock(event, handler),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args: unknown) => invokeMock(cmd, args),
}));

vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: vi.fn(async () => '/tmp/appdata'),
}));

vi.mock('@/lib/analytics', () => ({
  default: {
    trackTranscriptionError: vi.fn(),
    trackTranscriptionSuccess: vi.fn(),
    trackButtonClick: vi.fn(),
  },
}));

vi.mock('@/contexts/RecordingStateContext', () => ({
  useRecordingState: () => ({ isPaused: false }),
}));

vi.mock('./InlineDeviceSelector', () => ({
  InlineDeviceSelector: () => null,
}));

import { RecordingControls } from './RecordingControls';

const baseProps = {
  isRecording: true,
  barHeights: ['58%', '76%', '58%'],
  onRecordingStart: vi.fn(),
  onTranscriptReceived: vi.fn(),
  isRecordingDisabled: false,
  isParentProcessing: false,
};

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const fireTranscriptionError = async (payload: unknown = { error: 'oops', userMessage: 'fallo', actionable: false }) => {
  const handler = handlers.get('transcription-error');
  if (!handler) throw new Error('transcription-error handler not registered yet');
  await handler({ payload });
  await flush();
};

describe('RecordingControls — circuit breaker on transcription errors', () => {
  beforeEach(() => {
    handlers.clear();
    listenMock.mockClear();
    invokeMock.mockClear();
  });

  it('does NOT call stop_recording on the first 4 transient errors', async () => {
    const onRecordingStop = vi.fn();
    render(
      <RecordingControls
        {...baseProps}
        onRecordingStop={onRecordingStop}
        onTranscriptionError={vi.fn()}
      />
    );
    await flush();

    for (let i = 0; i < 4; i++) {
      await fireTranscriptionError();
    }

    const stopCalls = invokeMock.mock.calls.filter(([cmd]) => cmd === 'stop_recording');
    expect(stopCalls).toHaveLength(0);
    expect(onRecordingStop).not.toHaveBeenCalled();

    cleanup();
  });

  it('calls stop_recording exactly once on the 5th transient error and stays at 1 for further errors', async () => {
    const onRecordingStop = vi.fn();
    render(
      <RecordingControls
        {...baseProps}
        onRecordingStop={onRecordingStop}
        onTranscriptionError={vi.fn()}
      />
    );
    await flush();

    for (let i = 0; i < 10; i++) {
      await fireTranscriptionError();
    }

    const stopCalls = invokeMock.mock.calls.filter(([cmd]) => cmd === 'stop_recording');
    expect(stopCalls).toHaveLength(1);
    expect(onRecordingStop).toHaveBeenCalledTimes(1);
    expect(onRecordingStop).toHaveBeenCalledWith(false);

    cleanup();
  });

  it('calls stop_recording immediately on the first actionable error', async () => {
    const onRecordingStop = vi.fn();
    const onTranscriptionError = vi.fn();
    render(
      <RecordingControls
        {...baseProps}
        onRecordingStop={onRecordingStop}
        onTranscriptionError={onTranscriptionError}
      />
    );
    await flush();

    await fireTranscriptionError({ error: 'model_missing', userMessage: 'Modelo no cargado', actionable: true });

    const stopCalls = invokeMock.mock.calls.filter(([cmd]) => cmd === 'stop_recording');
    expect(stopCalls).toHaveLength(1);
    expect(onRecordingStop).toHaveBeenCalledTimes(1);
    expect(onTranscriptionError).toHaveBeenCalledTimes(1);
    expect(onTranscriptionError).toHaveBeenCalledWith('Modelo no cargado');

    cleanup();
  });

  it('resets the error counter and breaker when a new recording starts', async () => {
    const onRecordingStop = vi.fn();
    const { rerender } = render(
      <RecordingControls
        {...baseProps}
        isRecording={true}
        onRecordingStop={onRecordingStop}
        onTranscriptionError={vi.fn()}
      />
    );
    await flush();

    // Trigger 5 errors -> stop fires once
    for (let i = 0; i < 5; i++) {
      await fireTranscriptionError();
    }
    expect(invokeMock.mock.calls.filter(([cmd]) => cmd === 'stop_recording')).toHaveLength(1);

    // Simulate stop -> start of a new recording
    rerender(
      <RecordingControls
        {...baseProps}
        isRecording={false}
        onRecordingStop={onRecordingStop}
        onTranscriptionError={vi.fn()}
      />
    );
    rerender(
      <RecordingControls
        {...baseProps}
        isRecording={true}
        onRecordingStop={onRecordingStop}
        onTranscriptionError={vi.fn()}
      />
    );
    await flush();

    // 4 errors in the NEW recording must NOT trigger stop (counter reset)
    for (let i = 0; i < 4; i++) {
      await fireTranscriptionError();
    }
    expect(invokeMock.mock.calls.filter(([cmd]) => cmd === 'stop_recording')).toHaveLength(1);

    // 5th error in new recording fires stop again
    await fireTranscriptionError();
    expect(invokeMock.mock.calls.filter(([cmd]) => cmd === 'stop_recording')).toHaveLength(2);

    cleanup();
  });
});
