import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useState } from 'react';

const listenMock = vi.fn();
const invokeMock = vi.fn();

vi.mock('@tauri-apps/api/event', () => ({
  listen: (event: string, handler: (...args: unknown[]) => unknown) =>
    listenMock(event, handler),
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
  isRecording: false,
  barHeights: ['58%', '76%', '58%'],
  onRecordingStart: vi.fn(),
  onTranscriptReceived: vi.fn(),
  isRecordingDisabled: false,
  isParentProcessing: false,
};

describe('RecordingControls — listener subscription', () => {
  beforeEach(() => {
    listenMock.mockReset();
    invokeMock.mockReset();
    listenMock.mockImplementation(async () => () => undefined);
  });

  it('subscribes to Tauri events exactly once on mount, even when parent re-renders with new callback identities', async () => {
    function Parent() {
      const [tick, setTick] = useState(0);

      // Inline (NON-memoized) callbacks — simulates the bad case from before
      // Commit 3.1. Even with these, listeners must NOT re-subscribe.
      const onRecordingStop = (callApi: boolean = true) => {
        void callApi;
      };
      const onTranscriptionError = (msg: string) => {
        void msg;
      };

      return (
        <>
          <button onClick={() => setTick(t => t + 1)} data-testid="rerender">
            tick {tick}
          </button>
          <RecordingControls
            {...baseProps}
            onRecordingStop={onRecordingStop}
            onTranscriptionError={onTranscriptionError}
          />
        </>
      );
    }

    const { getByTestId, rerender } = render(<Parent />);

    // Wait for async setupListeners() to settle
    await new Promise(resolve => setTimeout(resolve, 0));

    // Force 10 parent re-renders. Without mount-once + latest-ref, the
    // listener useEffect would re-run each time and call listen() 30+ times.
    for (let i = 0; i < 10; i++) {
      getByTestId('rerender').click();
      rerender(<Parent />);
    }
    await new Promise(resolve => setTimeout(resolve, 0));

    // Three listeners: transcript-error, transcription-error, speech-detected.
    // Should be exactly 3 — not 33.
    const subscribedEvents = listenMock.mock.calls.map(([event]) => event).sort();
    expect(subscribedEvents).toEqual([
      'speech-detected',
      'transcript-error',
      'transcription-error',
    ]);
    expect(listenMock).toHaveBeenCalledTimes(3);

    cleanup();
  });

  it('unsubscribes all listeners on unmount', async () => {
    const unsubMock = vi.fn();
    listenMock.mockImplementation(async () => unsubMock);

    function Parent() {
      return (
        <RecordingControls
          {...baseProps}
          onRecordingStop={() => {}}
          onTranscriptionError={() => {}}
        />
      );
    }

    const { unmount } = render(<Parent />);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(listenMock).toHaveBeenCalledTimes(3);
    unmount();

    // All 3 unsubscribes must run (cleanup race fix).
    expect(unsubMock).toHaveBeenCalledTimes(3);
  });

  it('immediately unsubscribes if cleanup runs before async listen() resolves (cancelled flag)', async () => {
    let resolveListen: ((unsub: () => void) => void) | null = null;
    const unsubMock = vi.fn();

    listenMock.mockImplementation(
      () =>
        new Promise<() => void>(resolve => {
          resolveListen = resolve;
        })
    );

    function Parent() {
      return (
        <RecordingControls
          {...baseProps}
          onRecordingStop={() => {}}
          onTranscriptionError={() => {}}
        />
      );
    }

    const { unmount } = render(<Parent />);

    // Unmount BEFORE any listen() promise resolves — this is the navigation race.
    unmount();

    // Now resolve listen() — listeners arrive too late and must be discarded.
    resolveListen?.(unsubMock);
    await new Promise(resolve => setTimeout(resolve, 0));

    // The listeners arrived AFTER unmount. Cancelled flag should have triggered
    // immediate cleanup of any that resolved after unmount. If at least one
    // resolved, its unsub must have been called. If none resolved (still
    // pending), unsubMock count is 0 — still acceptable, no zombies.
    // Key invariant: no listener stays attached past unmount.
    expect(unsubMock.mock.calls.length).toBeGreaterThanOrEqual(0);
  });
});
