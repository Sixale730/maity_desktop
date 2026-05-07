import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { createElement } from 'react';

import type { OmiConversation } from '../services/conversations.service';

const getOmiConversationMock = vi.fn();

vi.mock('../services/conversations.service', async () => {
  const actual = await vi.importActual<typeof import('../services/conversations.service')>(
    '../services/conversations.service',
  );
  return {
    ...actual,
    getOmiConversation: (...args: unknown[]) => getOmiConversationMock(...args),
  };
});

import { useConversationLive } from './useConversationLive';

function makeConversation(overrides: Partial<OmiConversation> = {}): OmiConversation {
  const recent = new Date(Date.now() - 30_000).toISOString();
  return {
    id: 'conv-1',
    user_id: 'user-1',
    firebase_uid: null,
    created_at: recent,
    started_at: recent,
    finished_at: recent,
    title: 'Test',
    overview: '',
    emoji: null,
    category: null,
    action_items: null,
    events: null,
    transcript_text: null,
    source: 'maity_desktop',
    language: null,
    status: null,
    words_count: null,
    duration_seconds: null,
    communication_feedback: null,
    communication_feedback_v4: null,
    meeting_minutes_data: null,
    analysis_status: 'processing',
    ...overrides,
  };
}

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  Wrapper.displayName = 'TestQueryClientProviderWrapper';
  return Wrapper;
}

describe('useConversationLive', () => {
  beforeEach(() => {
    getOmiConversationMock.mockReset();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reconciles by refetching on mount even when initial data is provided', async () => {
    const initial = makeConversation({ analysis_status: 'pending' });
    const fresh = makeConversation({
      analysis_status: 'completed',
      communication_feedback_v4: { calidad_global: { puntaje: 80 } } as never,
      meeting_minutes_data: { meta: {} } as never,
    });
    getOmiConversationMock.mockResolvedValue(fresh);

    const { result } = renderHook(
      () => useConversationLive('conv-1', initial, true),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => {
      expect(result.current.phase).toBe('completed');
    });
    expect(getOmiConversationMock).toHaveBeenCalledWith('conv-1');
  });

  it('does not query when enabled=false', async () => {
    const initial = makeConversation();
    getOmiConversationMock.mockResolvedValue(initial);

    renderHook(
      () => useConversationLive('conv-1', initial, false),
      { wrapper: makeWrapper() },
    );

    expect(getOmiConversationMock).not.toHaveBeenCalled();
  });

  it('refetches on visibilitychange when document becomes visible', async () => {
    const initial = makeConversation();
    getOmiConversationMock.mockResolvedValue(initial);

    renderHook(
      () => useConversationLive('conv-1', initial, true),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => {
      expect(getOmiConversationMock).toHaveBeenCalledTimes(1);
    });

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => {
      expect(getOmiConversationMock).toHaveBeenCalledTimes(2);
    });
  });

  it('derives phase=stalled when finished_at is older than STALL_TIMEOUT_MS and not terminal', async () => {
    const old = new Date(Date.now() - 11 * 60_000).toISOString();
    const stuck = makeConversation({ analysis_status: 'processing', finished_at: old });
    getOmiConversationMock.mockResolvedValue(stuck);

    const { result } = renderHook(
      () => useConversationLive('conv-1', stuck, true),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => {
      expect(result.current.phase).toBe('stalled');
    });
  });
});
