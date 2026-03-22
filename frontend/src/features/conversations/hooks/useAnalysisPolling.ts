import { useState, useEffect, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  analysisPollingService,
  ANALYSIS_STATE_CHANGED,
  ANALYSIS_COMPLETED,
} from '@/services/analysisPollingService';
import type { AnalysisPhase } from '@/services/analysisPollingService';
import type { OmiConversation } from '../services/conversations.service';
import { isFullAnalysis, isAnalysisSkipped } from '../services/conversations.service';

// Re-export so existing imports don't break
export type { AnalysisPhase } from '@/services/analysisPollingService';

interface UseAnalysisPollingOptions {
  /** The conversation being viewed */
  conversation: OmiConversation;
  /** Whether to start polling immediately */
  enabled: boolean;
  /** Called when conversation data is updated (partial or complete) */
  onUpdate: (updated: OmiConversation) => void;
  /** Called when both V4 + minuta are complete */
  onComplete?: () => void;
}

interface UseAnalysisPollingResult {
  phase: AnalysisPhase;
  hasV4: boolean;
  hasMinuta: boolean;
  retryCount: number;
  error: string | null;
  isActive: boolean;
  startPolling: () => void;
  retryManually: () => void;
}

function checkV4(conv: OmiConversation): boolean {
  return isFullAnalysis(conv.communication_feedback_v4) || isAnalysisSkipped(conv.communication_feedback_v4);
}

function checkMinuta(conv: OmiConversation): boolean {
  return !!conv.meeting_minutes_data;
}

/**
 * Thin subscriber hook that delegates to the global AnalysisPollingService.
 *
 * The service holds the real state and survives navigation.
 * This hook just reads from the service and updates local React state
 * so components re-render when analysis progresses.
 */
export function useAnalysisPolling({
  conversation,
  enabled,
  onUpdate,
  onComplete,
}: UseAnalysisPollingOptions): UseAnalysisPollingResult {
  const queryClient = useQueryClient();
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const conversationRef = useRef(conversation);
  conversationRef.current = conversation;

  // Read initial state from service (may already be tracking from before navigation)
  const existingState = analysisPollingService.getState(conversation.id, conversation._localId);

  const [phase, setPhase] = useState<AnalysisPhase>(
    existingState?.phase ?? (enabled ? 'polling' : 'idle')
  );
  const [hasV4, setHasV4] = useState(existingState?.hasV4 ?? checkV4(conversation));
  const [hasMinuta, setHasMinuta] = useState(existingState?.hasMinuta ?? checkMinuta(conversation));
  const [retryCount, setRetryCount] = useState(existingState?.retryCount ?? 0);
  const [error, setError] = useState<string | null>(existingState?.error ?? null);

  // Track conversation identity to reset on conversation change
  const convIdRef = useRef(conversation.id);

  // When enabled transitions to true, tell the service to start tracking
  useEffect(() => {
    if (!enabled) return;

    const state = analysisPollingService.getState(conversation.id, conversation._localId);
    if (state && (state.phase === 'polling' || state.phase === 'retrying')) {
      // Already being tracked by the service — just sync local state
      setPhase(state.phase);
      setHasV4(state.hasV4);
      setHasMinuta(state.hasMinuta);
      setRetryCount(state.retryCount);
      setError(state.error);
    } else if (!state || state.phase === 'idle') {
      // Not tracked yet, start
      analysisPollingService.track({
        conversationId: conversation.id,
        localId: conversation._localId,
        source: conversation.source ?? null,
        durationSeconds: conversation.duration_seconds ?? 0,
        initialHasV4: checkV4(conversation),
        initialHasMinuta: checkMinuta(conversation),
      });
    }
  }, [enabled, conversation.id, conversation._localId, conversation.source, conversation.duration_seconds]);

  // Reset when viewing a different conversation
  useEffect(() => {
    if (convIdRef.current !== conversation.id) {
      convIdRef.current = conversation.id;
      const state = analysisPollingService.getState(conversation.id, conversation._localId);
      if (state) {
        setPhase(state.phase);
        setHasV4(state.hasV4);
        setHasMinuta(state.hasMinuta);
        setRetryCount(state.retryCount);
        setError(state.error);
      } else {
        setPhase('idle');
        setHasV4(checkV4(conversation));
        setHasMinuta(checkMinuta(conversation));
        setRetryCount(0);
        setError(null);
      }
    }
  }, [conversation.id, conversation._localId]);

  // Subscribe to service events
  useEffect(() => {
    const handleStateChanged = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail?.state) return;

      const conv = conversationRef.current;
      const s = detail.state;

      // Check if this event is for our conversation
      const matches =
        s.conversationId === conv.id ||
        s.localId === conv._localId ||
        s.localId === conv.id ||
        s.conversationId === conv._localId;

      if (!matches) return;

      setPhase(s.phase);
      setHasV4(s.hasV4);
      setHasMinuta(s.hasMinuta);
      setRetryCount(s.retryCount);
      setError(s.error);

      // If we received updated conversation data, pass to parent
      if (detail.conversation) {
        const updated = detail.conversation as OmiConversation;
        // Preserve _localId
        if (conv._localId && !updated._localId) {
          updated._localId = conv._localId;
        }
        onUpdateRef.current(updated);
        queryClient.invalidateQueries({ queryKey: ['omi-conversations'] });
      }
    };

    const handleCompleted = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const conv = conversationRef.current;

      const matches =
        detail?.conversationId === conv.id ||
        detail?.localId === conv._localId ||
        detail?.localId === conv.id;

      if (matches) {
        onCompleteRef.current?.();
      }
    };

    window.addEventListener(ANALYSIS_STATE_CHANGED, handleStateChanged);
    window.addEventListener(ANALYSIS_COMPLETED, handleCompleted);
    return () => {
      window.removeEventListener(ANALYSIS_STATE_CHANGED, handleStateChanged);
      window.removeEventListener(ANALYSIS_COMPLETED, handleCompleted);
    };
  }, [queryClient]);

  const startPolling = useCallback(() => {
    analysisPollingService.restartPolling(
      conversation.id,
      conversation._localId,
      conversation.source,
    );
  }, [conversation.id, conversation._localId, conversation.source]);

  const retryManually = useCallback(() => {
    analysisPollingService.retryManually(conversation.id, conversation._localId);
  }, [conversation.id, conversation._localId]);

  return {
    phase,
    hasV4,
    hasMinuta,
    retryCount,
    error,
    isActive: phase === 'polling' || phase === 'retrying',
    startPolling,
    retryManually,
  };
}
