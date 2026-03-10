import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
  OmiConversation,
  getOmiConversation,
  isFullAnalysis,
  isAnalysisSkipped,
} from '../services/conversations.service';

export type AnalysisPhase = 'idle' | 'polling' | 'retrying' | 'completed' | 'failed';

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

const POLL_INTERVAL_MS = 5000;
const AUTO_RETRY_TIMEOUT_MS = 75000;
const MAX_AUTO_RETRIES = 2;

function checkV4(conv: OmiConversation): boolean {
  return isFullAnalysis(conv.communication_feedback_v4) || isAnalysisSkipped(conv.communication_feedback_v4);
}

function checkMinuta(conv: OmiConversation): boolean {
  return !!conv.meeting_minutes_data;
}

export function useAnalysisPolling({
  conversation,
  enabled,
  onUpdate,
  onComplete,
}: UseAnalysisPollingOptions): UseAnalysisPollingResult {
  const [phase, setPhase] = useState<AnalysisPhase>(enabled ? 'polling' : 'idle');
  const [retryCount, setRetryCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const queryClient = useQueryClient();

  // Track what we've seen so far to detect partial arrivals
  const seenRef = useRef({ v4: checkV4(conversation), minuta: checkMinuta(conversation) });
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  // Track conversation identity to reset on conversation change
  const convIdRef = useRef(conversation.id);
  const conversationRef = useRef(conversation);
  conversationRef.current = conversation;

  // Timer refs
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollingStartedAtRef = useRef<number>(0);

  // Update seen state from current conversation
  useEffect(() => {
    seenRef.current = { v4: checkV4(conversation), minuta: checkMinuta(conversation) };
  }, [conversation.communication_feedback_v4, conversation.meeting_minutes_data]);

  // Reset when conversation changes
  useEffect(() => {
    if (convIdRef.current !== conversation.id) {
      convIdRef.current = conversation.id;
      cleanup();
      setPhase('idle');
      setRetryCount(0);
      setError(null);
    }
  }, [conversation.id]);

  // Start polling when enabled transitions to true
  useEffect(() => {
    if (enabled && phase === 'idle') {
      setPhase('polling');
    }
  }, [enabled, phase]);

  const cleanup = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
  }, []);

  const handleConversationUpdate = useCallback((updated: OmiConversation) => {
    const hasV4 = checkV4(updated);
    const hasMinuta = checkMinuta(updated);
    const prev = seenRef.current;

    if ((hasV4 && !prev.v4) || (hasMinuta && !prev.minuta)) {
      seenRef.current = { v4: hasV4, minuta: hasMinuta };
      onUpdate(updated);
      queryClient.invalidateQueries({ queryKey: ['omi-conversations'] });
    }

    if (hasV4 && hasMinuta) {
      cleanup();
      setPhase('completed');
      onComplete?.();
      return true;
    }
    return false;
  }, [onUpdate, onComplete, queryClient, cleanup]);

  // Poll Supabase for cloud conversations
  const pollCloud = useCallback(async () => {
    if (phaseRef.current !== 'polling') return;
    const conv = conversationRef.current;
    if (conv.source === 'local') return; // local uses events only

    try {
      const updated = await getOmiConversation(conv.id);
      if (updated) handleConversationUpdate(updated);
    } catch (err) {
      console.warn('[useAnalysisPolling] Poll error:', err);
    }
  }, [handleConversationUpdate]);

  // Trigger auto-retry via finalize_conversation_cloud
  const doRetry = useCallback(async () => {
    const conv = conversationRef.current;
    if (conv.source === 'local') {
      // Can't retry a local-only conversation — no Supabase ID yet
      setPhase('failed');
      setError('La conversación aún no se ha sincronizado a la nube.');
      cleanup();
      return;
    }

    setPhase('retrying');
    setRetryCount((c) => c + 1);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('Sin sesión activa');
      }

      const result = await invoke<{ ok: boolean; error?: string }>('finalize_conversation_cloud', {
        conversationId: conv.id,
        durationSeconds: conv.duration_seconds || 0,
        accessToken: session.access_token,
      });

      if (!result.ok) {
        throw new Error(result.error || 'Finalize returned ok=false');
      }

      // Resume polling after retry
      setPhase('polling');
      pollingStartedAtRef.current = Date.now();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[useAnalysisPolling] Retry failed:', msg);
      setError(msg);
      // If we still have retries left, go back to polling; otherwise fail
      setRetryCount((current) => {
        if (current >= MAX_AUTO_RETRIES) {
          cleanup();
          setPhase('failed');
        } else {
          setPhase('polling');
          pollingStartedAtRef.current = Date.now();
        }
        return current;
      });
    }
  }, [cleanup]);

  // Main polling effect
  useEffect(() => {
    if (phase !== 'polling') return;

    pollingStartedAtRef.current = Date.now();

    // Start polling interval for cloud conversations
    if (conversation.source !== 'local') {
      pollIntervalRef.current = setInterval(pollCloud, POLL_INTERVAL_MS);
    }

    // Auto-retry timeout
    retryTimeoutRef.current = setTimeout(() => {
      if (phaseRef.current === 'polling' && retryCount < MAX_AUTO_RETRIES) {
        doRetry();
      } else if (phaseRef.current === 'polling') {
        cleanup();
        setPhase('failed');
        setError('El análisis no se completó después de varios intentos.');
      }
    }, AUTO_RETRY_TIMEOUT_MS);

    return cleanup;
  }, [phase, conversation.source, pollCloud, doRetry, cleanup, retryCount]);

  // Listen for finalize-completed / sync-status-changed events (critical for local conversations)
  useEffect(() => {
    if (phase !== 'polling' && phase !== 'retrying') return;

    const handleFinalizeCompleted = async (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const conv = conversationRef.current;

      // Match by Supabase ID or local meeting ID
      const matches =
        (detail?.conversationId && detail.conversationId === conv.id) ||
        (detail?.meetingId && (detail.meetingId === conv._localId || detail.meetingId === conv.id));

      if (!matches) return;

      try {
        // For local conversations, the conversationId in the event is the Supabase UUID
        const supabaseId = detail.conversationId;
        if (supabaseId) {
          const updated = await getOmiConversation(supabaseId);
          if (updated) {
            // Preserve _localId from current conversation
            if (conv._localId) updated._localId = conv._localId;
            handleConversationUpdate(updated);
          }
        }
      } catch (err) {
        console.warn('[useAnalysisPolling] Error handling finalize-completed:', err);
      }
    };

    const handleSyncStatusChanged = async (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const conv = conversationRef.current;

      const meetingIdMatches =
        detail?.meetingId === conv._localId || detail?.meetingId === conv.id;

      if (!meetingIdMatches) return;

      // If a save_conversation or finalize completed, try fetching updated data
      if (detail.status === 'completed') {
        try {
          // The conv might now have a cloud ID via the sync worker
          if (conv.source !== 'local') {
            const updated = await getOmiConversation(conv.id);
            if (updated) handleConversationUpdate(updated);
          }
        } catch (err) {
          console.warn('[useAnalysisPolling] Error handling sync-status-changed:', err);
        }
      }
    };

    window.addEventListener('finalize-completed', handleFinalizeCompleted);
    window.addEventListener('sync-status-changed', handleSyncStatusChanged);
    return () => {
      window.removeEventListener('finalize-completed', handleFinalizeCompleted);
      window.removeEventListener('sync-status-changed', handleSyncStatusChanged);
    };
  }, [phase, handleConversationUpdate]);

  const startPolling = useCallback(() => {
    cleanup();
    seenRef.current = { v4: false, minuta: false };
    setRetryCount(0);
    setError(null);
    setPhase('polling');
  }, [cleanup]);

  const retryManually = useCallback(() => {
    setRetryCount(0);
    setError(null);
    doRetry();
  }, [doRetry]);

  return {
    phase,
    hasV4: seenRef.current.v4,
    hasMinuta: seenRef.current.minuta,
    retryCount,
    error,
    isActive: phase === 'polling' || phase === 'retrying',
    startPolling,
    retryManually,
  };
}
