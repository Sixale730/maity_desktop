import { useState, useEffect, useCallback, useRef } from 'react';
import { subscribeTauriEvent } from '@/lib/tauriSubscribe';
import { toast } from 'sonner';
import type { TranscriptModelProps } from '@/types/transcript';
import { logger } from '@/lib/logger';
import { TauriEvent } from '@/lib/tauri-events';

export type ModalType =
  | 'modelSettings'
  | 'deviceSettings'
  | 'languageSettings'
  | 'modelSelector'
  | 'errorAlert'
  | 'chunkDropWarning';

interface ModalState {
  modelSettings: boolean;
  deviceSettings: boolean;
  languageSettings: boolean;
  modelSelector: boolean;
  errorAlert: boolean;
  chunkDropWarning: boolean;
}

interface ModalMessages {
  errorAlert: string;
  chunkDropWarning: string;
  modelSelector: string;
}

interface UseModalStateReturn {
  modals: ModalState;
  messages: ModalMessages;
  showModal: (name: ModalType, message?: string) => void;
  hideModal: (name: ModalType) => void;
  hideAllModals: () => void;
}

/**
 * Custom hook for managing all modal state and event listeners.
 * Consolidates 9 useState calls and 3 event listeners from page.tsx.
 *
 * Features:
 * - Unified modal state management
 * - Event listeners for chunk drops, transcription errors, model downloads
 * - Auto-close on model download completion
 */
export function useModalState(transcriptModelConfig?: TranscriptModelProps): UseModalStateReturn {
  // Modal visibility state
  const [modals, setModals] = useState<ModalState>({
    modelSettings: false,
    deviceSettings: false,
    languageSettings: false,
    modelSelector: false,
    errorAlert: false,
    chunkDropWarning: false,
  });

  // Modal messages
  const [messages, setMessages] = useState<ModalMessages>({
    errorAlert: '',
    chunkDropWarning: '',
    modelSelector: '',
  });

  // Show modal with optional message
  const showModal = useCallback((name: ModalType, message?: string) => {
    setModals(prev => ({ ...prev, [name]: true }));

    // Set message if provided
    if (message && (name === 'errorAlert' || name === 'chunkDropWarning' || name === 'modelSelector')) {
      setMessages(prev => ({ ...prev, [name]: message }));
    }
  }, []);

  // Hide modal and clear its message
  const hideModal = useCallback((name: ModalType) => {
    setModals(prev => ({ ...prev, [name]: false }));

    // Clear message when closing
    if (name === 'errorAlert' || name === 'chunkDropWarning' || name === 'modelSelector') {
      setMessages(prev => ({ ...prev, [name]: '' }));
    }
  }, []);

  // Hide all modals
  const hideAllModals = useCallback(() => {
    setModals({
      modelSettings: false,
      deviceSettings: false,
      languageSettings: false,
      modelSelector: false,
      errorAlert: false,
      chunkDropWarning: false,
    });
    setMessages({
      errorAlert: '',
      chunkDropWarning: '',
      modelSelector: '',
    });
  }, []);

  // Latest-ref: `transcriptModelConfig` es un objeto que cambia de identidad,
  // asi que llevarlo en el dep array resuscribia el listener una y otra vez
  // (issue #65). El efecto monta UNA vez y lee el valor fresco del ref.
  const latest = useRef({ transcriptModelConfig, showModal, hideModal });
  latest.current = { transcriptModelConfig, showModal, hideModal };

  // Set up transcription error listener for model loading failures
  useEffect(() => {
    logger.debug('Setting up transcription-error listener...');
    return subscribeTauriEvent<{ error: string, userMessage: string, actionable: boolean }>(
      TauriEvent.TRANSCRIPTION_ERROR,
      (event) => {
        logger.debug('Transcription error received:', event.payload);
        const { userMessage, actionable } = event.payload;

        if (actionable) {
          // This is a model-related error that requires user action
          latest.current.showModal('modelSelector', userMessage);
        } else {
          // Show toast instead of modal for non-actionable errors (consistent with sidebar)
          toast.error('', {
            description: userMessage,
            duration: 5000,
          });
        }
      },
    );
  }, []);

  // Listen for model download completion to auto-close modal.
  // Issue #65: este efecto CONSTRUIA su cleanup y lo tiraba (el return vivia
  // dentro del async, no del useEffect), asi que el listener nunca se liberaba
  // y se acumulaba uno nuevo por cada cambio de transcriptModelConfig.
  useEffect(() => {
    return subscribeTauriEvent<{ modelName: string }>(TauriEvent.MODEL_DOWNLOAD_COMPLETE, (event) => {
      const { modelName } = event.payload;
      logger.debug('[useModalState] Whisper model download complete:', modelName);

      // Auto-close modal if the downloaded model matches the selected one
      const { transcriptModelConfig: cfg, hideModal: hide } = latest.current;
      if (cfg?.provider === 'localWhisper' && cfg?.model === modelName) {
        toast.success('¡Modelo listo! Cerrando ventana...', { duration: 1500 });
        setTimeout(() => hide('modelSelector'), 1500);
      }
    });
  }, []);

  return {
    modals,
    messages,
    showModal,
    hideModal,
    hideAllModals,
  };
}
