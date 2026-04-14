import { useCallback } from 'react';
import { invoke as invokeTauri } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import type { MeetingRecord } from './types';

interface UseMeetingOperationsProps {
  meeting: MeetingRecord;
}

export function useMeetingOperations({
  meeting,
}: UseMeetingOperationsProps) {

  // Open meeting folder in file explorer
  const handleOpenMeetingFolder = useCallback(async () => {
    try {
      await invokeTauri('open_meeting_folder', { meetingId: meeting.id });
    } catch (error) {
      console.error('Failed to open meeting folder:', error);
      toast.error(error instanceof Error ? error.message : String(error) || 'Error al abrir carpeta de grabación');
    }
  }, [meeting.id]);

  return {
    handleOpenMeetingFolder,
  };
}
