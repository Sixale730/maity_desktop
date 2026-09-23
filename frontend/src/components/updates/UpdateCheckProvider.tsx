'use client'

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { useUpdateCheck } from '@/hooks/useUpdateCheck';
import { UpdateInfo } from '@/services/updateService';
import { UpdateDialog } from './UpdateDialog';
import { setUpdateDialogCallback } from './UpdateNotification';
import { fileLogger } from '@/lib/fileLogger';

interface UpdateCheckContextType {
  updateInfo: UpdateInfo | null;
  isChecking: boolean;
  checkForUpdates: (force?: boolean) => Promise<void>;
  showUpdateDialog: () => void;
}

const UpdateCheckContext = createContext<UpdateCheckContextType | undefined>(undefined);

/** Variantes del `UpdateDialog` para QA visual en desarrollo (`window.__updateDebug.preview`). */
type UpdateDialogPreviewKind = 'api' | 'apiNoVersion' | 'config' | 'sideload' | 'github';

const PREVIEW_INFO: Record<UpdateDialogPreviewKind, UpdateInfo> = {
  api: { available: true, currentVersion: '0.2.61', channel: 'store', storeSource: 'api', version: '0.2.62' },
  apiNoVersion: { available: true, currentVersion: '0.2.62', channel: 'store', storeSource: 'api' },
  config: { available: true, currentVersion: '0.2.60', channel: 'store', storeSource: 'config', version: '0.2.61' },
  sideload: { available: true, currentVersion: '0.2.60', channel: 'store', storeSource: 'sideload', version: '0.2.61' },
  github: { available: true, currentVersion: '0.2.52', channel: 'github', version: '0.2.62' },
};

export function UpdateCheckProvider({ children }: { children: React.ReactNode }) {
  const [showDialog, setShowDialog] = useState(false);
  const [previewInfo, setPreviewInfo] = useState<UpdateInfo | null>(null);

  // Solo en `pnpm dev`/`tauri:dev` (Next reemplaza NODE_ENV y elimina esto del
  // bundle de producción): abre el diálogo con datos falsos para revisar el layout
  // de cada variante sin depender de la Store ni de system_config.
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    const w = window as Window & { __updateDebug?: { preview: (kind: UpdateDialogPreviewKind) => void } };
    w.__updateDebug = {
      preview: (kind) => {
        setPreviewInfo(PREVIEW_INFO[kind]);
        setShowDialog(true);
      },
    };
    return () => {
      delete w.__updateDebug;
    };
  }, []);

  const handleDialogOpenChange = useCallback((open: boolean) => {
    setShowDialog(open);
    if (!open) setPreviewInfo(null);
  }, []);

  const handleShowDialog = useCallback(() => {
    setShowDialog(true);
  }, []);

  const { updateInfo, isChecking, checkForUpdates } = useUpdateCheck({
    checkOnMount: true,
    showNotification: true,
    onUpdateAvailable: (_info) => {
      // En sonner v2.0.7 el toast acepta el call y devuelve toastId valido
      // pero no renderiza visualmente con JSX custom en este contexto Tauri.
      // Comprobado en runtime con fileLogger en v0.2.43 debug build:
      //   [updater_notif] before-toast → after-toast {"toastId":"1"}
      //   pero el toast nunca aparece en pantalla.
      // Saltamos sonner: abrimos el mismo <UpdateDialog> que el flow manual
      // (About.tsx -> setShowUpdateDialog(true)) que funciona en produccion.
      handleShowDialog();
    },
  });

  useEffect(() => {
    // Register the callback so UpdateNotification can trigger the dialog
    setUpdateDialogCallback(handleShowDialog);
    return () => {
      setUpdateDialogCallback(() => {});
    };
  }, [handleShowDialog]);

  // Listen for tray menu events
  useEffect(() => {
    const handleTrayCheck = () => {
      checkForUpdates(true); // Force check from tray
      setShowDialog(true);
    };

    window.addEventListener('check-updates-from-tray', handleTrayCheck);
    return () => window.removeEventListener('check-updates-from-tray', handleTrayCheck);
  }, [checkForUpdates]);

  // Re-check cuando la app vuelve al foreground. Cubre el caso "user deja la
  // app abierta dias y nunca cierra/reabre" — sin esto el check solo dispara
  // una vez en el mount inicial. La cooldown de 24h en updateService evita
  // hammering al endpoint si el user solo cambia de tab y vuelve.
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void fileLogger.info('updater', 'recheck-on-visible');
        checkForUpdates(false);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [checkForUpdates]);

  return (
    <UpdateCheckContext.Provider
      value={{
        updateInfo,
        isChecking,
        checkForUpdates,
        showUpdateDialog: handleShowDialog,
      }}
    >
      {children}
      <UpdateDialog
        open={showDialog}
        onOpenChange={handleDialogOpenChange}
        updateInfo={previewInfo ?? updateInfo}
      />
    </UpdateCheckContext.Provider>
  );
}

export function useUpdateCheckContext() {
  const context = useContext(UpdateCheckContext);
  if (context === undefined) {
    throw new Error('useUpdateCheckContext must be used within UpdateCheckProvider');
  }
  return context;
}
