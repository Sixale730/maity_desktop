'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';

interface RecordingLog {
  id: number;
  session_id: string;
  event_type: string;
  event_data: string | null;
  status: string | null;
  error: string | null;
  meeting_id: string | null;
  app_version: string | null;
  synced_to_cloud: boolean;
  created_at: string;
}

const STATUS_COLORS: Record<string, string> = {
  success: 'text-green-600 dark:text-green-400',
  error: 'text-red-600 dark:text-red-400',
  timeout: 'text-yellow-600 dark:text-yellow-400',
  skipped: 'text-orange-600 dark:text-orange-400',
};

export function RecordingLogsViewer() {
  const [logs, setLogs] = useState<RecordingLog[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const result = await invoke<RecordingLog[]>('get_recording_logs', {
        sessionId: null,
        limit: 100,
      });
      setLogs(result);
    } catch (err) {
      console.error('Failed to fetch recording logs:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">
          Logs de Grabación
        </h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={fetchLogs}
          disabled={loading}
          className="h-7 px-2"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {logs.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No hay logs de grabación aún.
        </p>
      ) : (
        <div className="max-h-64 overflow-y-auto border rounded text-xs">
          <table className="w-full">
            <thead className="sticky top-0 bg-secondary">
              <tr>
                <th className="text-left px-2 py-1 font-medium">Hora</th>
                <th className="text-left px-2 py-1 font-medium">Evento</th>
                <th className="text-left px-2 py-1 font-medium">Estado</th>
                <th className="text-left px-2 py-1 font-medium">Detalle</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr
                  key={log.id}
                  className="border-t border-border hover:bg-muted/50"
                >
                  <td className="px-2 py-1 whitespace-nowrap text-muted-foreground">
                    {new Date(log.created_at + 'Z').toLocaleTimeString('es-MX', {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </td>
                  <td className="px-2 py-1 font-mono">
                    {log.event_type}
                  </td>
                  <td
                    className={`px-2 py-1 font-medium ${
                      STATUS_COLORS[log.status || ''] || 'text-muted-foreground'
                    }`}
                  >
                    {log.status || '-'}
                  </td>
                  <td className="px-2 py-1 text-muted-foreground max-w-[200px] truncate">
                    {log.error || (log.event_data ? log.event_data.substring(0, 80) : '-')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
