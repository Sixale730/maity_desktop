'use client';

import React, { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useRecordingStop } from '@/hooks/useRecordingStop';
import { logger } from '@/lib/logger';

/**
 * RecordingPostProcessingProvider
 *
 * This provider handles post-processing when recording stops from any source:
 * - Tray menu stop
 * - Global keyboard shortcut
 * - Overlay stop button
 * - Main UI stop button
 *
 * It listens for the 'recording-stop-complete' event from Rust backend
 * and triggers the full post-processing flow (save to database, navigate, analytics)
 * regardless of which page the user is currently on.
 */
export function RecordingPostProcessingProvider({ children }: { children: React.ReactNode }) {
  // No-op function since the global RecordingStateContext already handles state updates
  const setIsRecordingDisabled = () => { };

  const {
    handleRecordingStop,
  } = useRecordingStop(setIsRecordingDisabled);

  // Mantener ref estable al callback para evitar re-subscripciones innecesarias
  const handleRecordingStopRef = useRef(handleRecordingStop);
  useEffect(() => {
    handleRecordingStopRef.current = handleRecordingStop;
  });

  useEffect(() => {
    let unlistenFn: (() => void) | undefined;

    const setupListener = async () => {
      try {
        // Listen for recording-stop-complete event from Rust
        unlistenFn = await listen<boolean>('recording-stop-complete', (event) => {
          logger.debug('[RecordingPostProcessing] Received recording-stop-complete event:', event.payload);

          // Call the post-processing handler via ref (estable)
          // event.payload is the callApi boolean (true for normal stops)
          handleRecordingStopRef.current(event.payload);
        });

        logger.debug('[RecordingPostProcessing] Event listener set up successfully');
      } catch (error) {
        console.error('[RecordingPostProcessing] Failed to set up event listener:', error);
      }
    };

    setupListener();

    return () => {
      if (unlistenFn) {
        logger.debug('[RecordingPostProcessing] Cleaning up event listener');
        unlistenFn();
      }
    };
  }, []); // Sin dependencias - solo se ejecuta una vez al montar

  return <>{children}</>;
}
