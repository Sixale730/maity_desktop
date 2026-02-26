import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

export interface MeetingSyncStatus {
  meeting_id: string;
  total_jobs: number;
  pending: number;
  in_progress: number;
  completed: number;
  failed: number;
}

/**
 * Hook that polls sync_queue statuses and listens for sync-status-changed events.
 * Returns a Map<meeting_id, MeetingSyncStatus> for easy lookup.
 */
export function useCloudSyncStatuses() {
  const [statuses, setStatuses] = useState<Map<string, MeetingSyncStatus>>(new Map());

  const fetchStatuses = useCallback(async () => {
    try {
      const all = await invoke<MeetingSyncStatus[]>('sync_queue_get_all_statuses');
      const map = new Map<string, MeetingSyncStatus>();
      for (const s of all) {
        // Only include meetings that have non-completed jobs or recently completed
        if (s.pending > 0 || s.in_progress > 0 || s.failed > 0 || s.completed > 0) {
          map.set(s.meeting_id, s);
        }
      }
      setStatuses(map);
    } catch {
      // Silently ignore — db may not be ready yet
    }
  }, []);

  useEffect(() => {
    fetchStatuses();
    const interval = setInterval(fetchStatuses, 10000);
    return () => clearInterval(interval);
  }, [fetchStatuses]);

  // Listen for sync-status-changed events to refresh immediately
  useEffect(() => {
    const handler = () => fetchStatuses();
    window.addEventListener('sync-status-changed', handler);
    return () => window.removeEventListener('sync-status-changed', handler);
  }, [fetchStatuses]);

  return statuses;
}
