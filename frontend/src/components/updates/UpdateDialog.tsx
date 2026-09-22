import React, { useState, useEffect } from 'react';
import { Download, AlertCircle, Loader2, ExternalLink, Power, Store } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { UpdateInfo, UpdateProgress } from '@/services/updateService';
import type { RecordingState } from '@/services/recordingService';
import { check, Update } from '@tauri-apps/plugin-updater';
import { exit, relaunch } from '@tauri-apps/plugin-process';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { logger } from '@/lib/logger';
import { fileLogger } from '@/lib/fileLogger';
import { openExternalUrl } from '@/lib/planLinks';
import { STORE_UPDATES_DEEP_LINK, type StoreInstallOutcome } from '@/lib/storeChannel';

interface UpdateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  updateInfo: UpdateInfo | null;
}

export function UpdateDialog({ open, onOpenChange, updateInfo }: UpdateDialogProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [update, setUpdate] = useState<Update | null>(null);
  const [isClosingToUpdate, setIsClosingToUpdate] = useState(false);
  const [isInstallingFromStore, setIsInstallingFromStore] = useState(false);
  const [storeInstallFailed, setStoreInstallFailed] = useState(false);

  // Canal Store (MSIX): no hay objeto `Update` del plugin (bajo identidad de
  // paquete check() no aplica) y el updater de GitHub nunca corre: instalaría el
  // setup.exe NSIS como segunda copia (#71). Si la Store confirmó el update
  // (StoreContext, `storeSource: 'api'`) se instala con el diálogo de la Store;
  // si no, o si eso falla, quedan "Abrir la Store" / "Cerrar Maity".
  const isStoreChannel = updateInfo?.channel === 'store';
  const canInstallFromStore = isStoreChannel && updateInfo?.storeSource === 'api' && !storeInstallFailed;
  const storeBusy = isClosingToUpdate || isInstallingFromStore;

  useEffect(() => {
    if (open && updateInfo?.available) {
      // Reset state when dialog opens
      setIsDownloading(false);
      setProgress(null);
      setError(null);
      setIsClosingToUpdate(false);
      setIsInstallingFromStore(false);
      setStoreInstallFailed(false);

      if (updateInfo.channel === 'store') {
        setUpdate(null);
        return;
      }

      // Get the update object when dialog opens
      check().then((updateResult) => {
        if (updateResult?.available) {
          setUpdate(updateResult);
        } else {
          setError('Actualización ya no disponible');
        }
      }).catch((err) => {
        console.error('Failed to get update object:', err);
        setError('Error al preparar actualización: ' + (err.message || 'Error desconocido'));
      });
    } else {
      // Reset state when dialog closes
      setIsDownloading(false);
      setProgress(null);
      setError(null);
      setUpdate(null);
      setIsClosingToUpdate(false);
      setIsInstallingFromStore(false);
      setStoreInstallFailed(false);
    }
  }, [open, updateInfo]);

  const handleDownloadAndInstall = async () => {
    // Get update object if not already available
    let updateToUse: Update | null = update;
    if (!updateToUse) {
      try {
        const updateResult = await check();
        if (updateResult?.available) {
          updateToUse = updateResult;
          setUpdate(updateResult);
        } else {
          setError('Actualización no disponible');
          return;
        }
      } catch (err: unknown) {
        setError('Error al obtener actualización: ' + (err instanceof Error ? err.message : 'Error desconocido'));
        return;
      }
    }

    // At this point, updateToUse is guaranteed to be non-null
    if (!updateToUse) {
      return; // This should never happen, but TypeScript needs this check
    }

    setIsDownloading(true);
    setError(null);
    setProgress({ downloaded: 0, total: 0, percentage: 0 });

    try {
      let downloaded = 0;
      let contentLength = 0;

      // Use the official Tauri updater API with progress callbacks
      await updateToUse.downloadAndInstall((event) => {
        switch (event.event) {
          case 'Started':
            contentLength = event.data.contentLength || 0;
            logger.debug(`[UpdateDialog] Started downloading ${contentLength} bytes`);
            setProgress({
              downloaded: 0,
              total: contentLength,
              percentage: 0,
            });
            break;

          case 'Progress':
            downloaded += event.data.chunkLength || 0;
            const percentage = contentLength > 0
              ? Math.round((downloaded / contentLength) * 100)
              : 0;
            logger.debug(`[UpdateDialog] Progress: ${downloaded} / ${contentLength} bytes (${percentage}%)`);
            setProgress({
              downloaded,
              total: contentLength,
              percentage,
            });
            break;

          case 'Finished':
            logger.debug('[UpdateDialog] Download finished');
            setProgress({
              downloaded: contentLength,
              total: contentLength,
              percentage: 100,
            });
            break;
        }
      });

      logger.debug('[UpdateDialog] Update installed successfully');
      toast.success('Actualización instalada exitosamente. La aplicación se reiniciará...');

      // Mark download as complete before closing
      setIsDownloading(false);

      // Close dialog before relaunch
      handleOpenChange(false);

      // Relaunch the app
      await relaunch();
    } catch (err: unknown) {
      console.error('Update failed:', err);
      const errMsg = err instanceof Error ? err.message : 'Error desconocido';
      setError(errMsg || 'Error al descargar o instalar actualización');
      setIsDownloading(false);
      toast.error('Actualización fallida: ' + errMsg);
    }
  };

  /**
   * Canal Store: abre "Descargas y actualizaciones" de la Microsoft Store. Su
   * botón "Obtener actualizaciones" fuerza el check; la Store descarga en
   * segundo plano y aplica el paquete cuando Maity esté cerrado.
   */
  const handleOpenStore = async () => {
    void fileLogger.info('updater_dialog', 'store-open-deep-link', { version: updateInfo?.version });
    try {
      await openExternalUrl(STORE_UPDATES_DEEP_LINK);
    } catch (err: unknown) {
      console.error('Failed to open Microsoft Store:', err);
      toast.error('No se pudo abrir la Microsoft Store: ' + (err instanceof Error ? err.message : 'Error desconocido'));
    }
  };

  /**
   * Canal Store: la Store NO puede reemplazar un MSIX en ejecución; el paquete
   * se aplica al siguiente cierre. Se sale con `exit(0)` (RunEvent::Exit en
   * lib.rs corre graceful_shutdown_before_exit como backstop), pero NUNCA con
   * una grabación viva: una jornada de horas no debe depender de ese backstop.
   */
  const handleCloseToUpdate = async () => {
    setIsClosingToUpdate(true);
    try {
      const state = await invoke<RecordingState>('get_recording_state');
      if (state?.is_recording) {
        void fileLogger.info('updater_dialog', 'store-exit-refused-recording', { phase: state.phase });
        toast.warning('Hay una grabación en curso. Detenla antes de cerrar Maity para actualizar.');
        return;
      }
      void fileLogger.info('updater_dialog', 'store-exit-to-update', { version: updateInfo?.version });
      await exit(0);
    } catch (err: unknown) {
      console.error('Failed to exit for Store update:', err);
      toast.error('No se pudo cerrar Maity: ' + (err instanceof Error ? err.message : 'Error desconocido'));
    } finally {
      setIsClosingToUpdate(false);
    }
  };

  /**
   * Canal Store con update confirmado por StoreContext: Windows muestra su propio
   * diálogo de permiso, descarga e instala; al completar cierra Maity para aplicar
   * el paquete. Rust también se niega con grabación viva (`recordingActive`), pero
   * se chequea aquí primero para no abrir el diálogo de la Store en balde.
   */
  const handleInstallFromStore = async () => {
    setIsInstallingFromStore(true);
    try {
      const state = await invoke<RecordingState>('get_recording_state');
      if (state?.is_recording) {
        void fileLogger.info('updater_dialog', 'store-install-refused-recording', { phase: state.phase });
        toast.warning('Hay una grabación en curso. Detenla antes de actualizar Maity.');
        return;
      }
      void fileLogger.info('updater_dialog', 'store-install-start', { version: updateInfo?.version });
      const outcome = await invoke<StoreInstallOutcome>('store_install_updates');
      void fileLogger.info('updater_dialog', 'store-install-result', { ...outcome });
      switch (outcome.kind) {
        case 'completed':
          toast.success('Actualización instalada. Maity se cerrará para aplicarla.');
          break;
        case 'canceled':
          onOpenChange(false);
          break;
        case 'recordingActive':
          toast.warning('Hay una grabación en curso. Detenla antes de actualizar Maity.');
          break;
        case 'noUpdates':
          setStoreInstallFailed(true);
          toast.info('La Store ya no reporta la actualización. Revisa «Descargas y actualizaciones».');
          break;
        case 'error':
          setStoreInstallFailed(true);
          toast.error('La Store no pudo instalar la actualización: ' + outcome.detail);
          break;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      void fileLogger.error('updater_dialog', 'store-install-failed', { message });
      setStoreInstallFailed(true);
      toast.error('No se pudo actualizar desde la Store: ' + message);
    } finally {
      setIsInstallingFromStore(false);
    }
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return '';
    try {
      return new Date(dateString).toLocaleDateString();
    } catch {
      return dateString;
    }
  };

  // Prevent closing the dialog when downloading
  const handleOpenChange = (newOpen: boolean) => {
    // If trying to close while downloading, prevent it
    if (!newOpen && (isDownloading || isInstallingFromStore)) {
      return;
    }
    // Otherwise, allow normal close behavior
    onOpenChange(newOpen);
  };

  // Prevent ESC key from closing dialog during download
  const handleEscapeKeyDown = (event: KeyboardEvent) => {
    if (isDownloading || isInstallingFromStore) {
      event.preventDefault();
    }
  };

  // Prevent outside clicks from closing dialog during download
  const handleInteractOutside = (event: Event) => {
    if (isDownloading || isInstallingFromStore) {
      event.preventDefault();
    }
  };

  if (!updateInfo?.available) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-[500px]"
        onEscapeKeyDown={handleEscapeKeyDown}
        onInteractOutside={handleInteractOutside}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isDownloading ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin text-maity-blue" />
                Descargando Actualización
              </>
            ) : error ? (
              <>
                <AlertCircle className="h-5 w-5 text-destructive" />
                Error de Actualización
              </>
            ) : isStoreChannel ? (
              <>
                <Store className="h-5 w-5 text-maity-blue" />
                Actualización disponible en la Microsoft Store
              </>
            ) : (
              <>
                <Download className="h-5 w-5 text-maity-blue" />
                Actualización Disponible
              </>
            )}
          </DialogTitle>
          <DialogDescription>
            {isDownloading
              ? 'Descargando la última versión...'
              : error
              ? 'Ocurrió un error durante la actualización'
              : isStoreChannel
              ? `Maity ${updateInfo.version} ya está publicada en la Microsoft Store`
              : `Una nueva versión (${updateInfo.version}) está disponible`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {!isDownloading && !error && (
            <>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Versión Actual:</span>
                  <span className="font-medium">{updateInfo.currentVersion}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Nueva Versión:</span>
                  <span className="font-medium text-maity-blue">{updateInfo.version}</span>
                </div>
                {updateInfo.date && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Fecha de Lanzamiento:</span>
                    <span className="font-medium">{formatDate(updateInfo.date)}</span>
                  </div>
                )}
              </div>

              {isStoreChannel && canInstallFromStore && (
                <div className="bg-muted rounded-lg p-3 space-y-1">
                  <p className="text-sm text-foreground">
                    {isInstallingFromStore
                      ? 'Descargando desde la Microsoft Store… Acepta el aviso de Windows si aparece.'
                      : 'Pulsa «Actualizar ahora»: Windows descarga la versión nueva desde la Microsoft Store.'}
                  </p>
                  <p className="text-sm text-foreground">
                    Al terminar, Maity se cierra para aplicar la actualización.
                  </p>
                </div>
              )}

              {isStoreChannel && !canInstallFromStore && (
                <div className="bg-muted rounded-lg p-3 space-y-1">
                  <p className="text-sm text-foreground">
                    La Microsoft Store descarga la actualización en segundo plano y la aplica
                    cuando Maity está cerrado.
                  </p>
                  <p className="text-sm text-foreground">
                    Abre la Store y pulsa <span className="font-medium">«Obtener actualizaciones»</span>;
                    después cierra Maity para que se instale.
                  </p>
                </div>
              )}

              {updateInfo.body && (
                <div className="bg-muted rounded-lg p-3 max-h-40 overflow-y-auto">
                  <p className="text-sm text-foreground whitespace-pre-wrap">
                    {updateInfo.body}
                  </p>
                </div>
              )}
            </>
          )}

          {isDownloading && progress && (
            <div className="space-y-2">
              <div className="relative">
                <div className="w-full bg-border-strong rounded-full h-3">
                  <div
                    className="bg-[#3a4ac3] h-3 rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${Math.min(progress.percentage, 100)}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                  <span>{Math.round(progress.percentage)}% completado</span>
                  {progress.total > 0 && (
                    <span>
                      {formatBytes(progress.downloaded)} / {formatBytes(progress.total)}
                    </span>
                  )}
                </div>
              </div>
              <p className="text-sm text-muted-foreground text-center">
                La aplicación se reiniciará automáticamente después de la instalación
              </p>
            </div>
          )}

          {error && (
            <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}
        </div>

        <DialogFooter>
          {!isDownloading && !error && canInstallFromStore && (
            <>
              <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={storeBusy}>
                Más Tarde
              </Button>
              <Button variant="outline" onClick={handleOpenStore} disabled={storeBusy}>
                <ExternalLink className="h-4 w-4 mr-2" />
                Abrir la Store
              </Button>
              <Button
                onClick={handleInstallFromStore}
                disabled={storeBusy}
                className="bg-[#3a4ac3] hover:bg-[#2b3892]"
              >
                {isInstallingFromStore ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 mr-2" />
                )}
                Actualizar ahora
              </Button>
            </>
          )}
          {!isDownloading && !error && isStoreChannel && !canInstallFromStore && (
            <>
              <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={storeBusy}>
                Más Tarde
              </Button>
              <Button variant="outline" onClick={handleOpenStore} disabled={storeBusy}>
                <ExternalLink className="h-4 w-4 mr-2" />
                Abrir la Store
              </Button>
              <Button
                onClick={handleCloseToUpdate}
                disabled={storeBusy}
                className="bg-[#3a4ac3] hover:bg-[#2b3892]"
              >
                {isClosingToUpdate ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Power className="h-4 w-4 mr-2" />
                )}
                Cerrar Maity para actualizar
              </Button>
            </>
          )}
          {!isDownloading && !error && !isStoreChannel && (
            <>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Más Tarde
              </Button>
              <Button onClick={handleDownloadAndInstall} className="bg-[#3a4ac3] hover:bg-[#2b3892]">
                <Download className="h-4 w-4 mr-2" />
                Descargar e Instalar
              </Button>
            </>
          )}
          {error && (
            <Button variant="outline" onClick={() => handleOpenChange(false)}>
              Cerrar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}
