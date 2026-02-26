'use client';

import { useEffect, useState } from 'react';
import type { MeetingSyncStatus } from '@/hooks/useCloudSyncStatuses';

interface CloudSyncBadgeProps {
  syncStatus?: MeetingSyncStatus;
}

/**
 * Small cloud icon badge showing sync state for a meeting.
 * - pending/in_progress: animated cloud, muted color
 * - completed (all jobs): green check cloud, fades out after 10s
 * - failed: orange/red cloud with X, persists
 * - no status: hidden
 */
export function CloudSyncBadge({ syncStatus }: CloudSyncBadgeProps) {
  const [visible, setVisible] = useState(true);

  // Auto-hide completed badges after 10s
  useEffect(() => {
    if (!syncStatus) return;
    const allCompleted = syncStatus.pending === 0 && syncStatus.in_progress === 0 && syncStatus.failed === 0 && syncStatus.completed > 0;
    if (allCompleted) {
      const timer = setTimeout(() => setVisible(false), 10000);
      return () => clearTimeout(timer);
    }
    setVisible(true);
  }, [syncStatus]);

  if (!syncStatus || !visible) return null;

  const { pending, in_progress, failed, completed, total_jobs } = syncStatus;
  const allCompleted = pending === 0 && in_progress === 0 && failed === 0 && completed > 0;
  const hasFailed = failed > 0;
  const isProcessing = pending > 0 || in_progress > 0;

  if (allCompleted) {
    return (
      <span className="flex-shrink-0 text-emerald-500 transition-opacity duration-1000" title="Sincronizado con la nube">
        <CloudCheckIcon />
      </span>
    );
  }

  if (hasFailed) {
    return (
      <span className="flex-shrink-0 text-orange-500" title={`Error al sincronizar (${failed} de ${total_jobs} fallaron)`}>
        <CloudXIcon />
      </span>
    );
  }

  if (isProcessing) {
    return (
      <span className="flex-shrink-0 text-muted-foreground animate-pulse" title="Sincronizando con la nube...">
        <CloudSyncIcon />
      </span>
    );
  }

  return null;
}

function CloudCheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
      <path d="m9 15 2 2 4-4" />
    </svg>
  );
}

function CloudXIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
      <path d="m14 14-4 4" />
      <path d="m10 14 4 4" />
    </svg>
  );
}

function CloudSyncIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
      <path d="M12 12v4" />
      <path d="m10 14 2-2 2 2" />
    </svg>
  );
}
