import React, { useState, useEffect, useRef } from 'react';
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
import { UpdateInfo, UpdateProgress, type DirectInstallOutcome } from '@/services/updateService';
import type { RecordingState } from '@/services/recordingService';
import { check, type DownloadEvent } from '@tauri-apps/plugin-updater';
import { Channel, invoke } from '@tauri-apps/api/core';
import { isPostStopInFlight } from '@/lib/postStopState';
import { toast } from 'sonner';
import { logger } from '@/lib/logger';
import { fileLogger } from '@/lib/fileLogger';
import { openExternalUrl } from '@/lib/planLinks';
import { STORE_PDP_DEEP_LINK, STORE_UPDATES_DEEP_LINK, type StoreInstallOutcome } from '@/lib/storeChannel';
import { compareVersions } from '@/lib/versionCompare';

interface UpdateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  updateInfo: UpdateInfo | null;
}

export function UpdateDialog({ open, onOpenChange, updateInfo }: UpdateDialogProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isClosingToUpdate, setIsClosingToUpdate] = useState(false);
  const [isInstallingFromStore, setIsInstallingFromStore] = useState(false);
  const [storeInstallFailed, setStoreInstallFailed] = useState(false);
  // Instalación NSIS en vuelo: el re-check del tray (UpdateCheckProvider) cambia
  // `updateInfo` a media descarga y el efecto de apertura reseteaba la barra.
  const installInFlightRef = useRef(false);

  // Canal Store (MSIX): no hay objeto `Update` del plugin (bajo identidad de
  // paquete check() no aplica) y el updater de GitHub nunca corre: instalaría el
  // setup.exe NSIS como segunda copia (#71). Si la Store confirmó el update
  // (StoreContext, `storeSource: 'api'`) se instala con el diálogo de la Store;
  // si no, o si eso falla, quedan "Abrir la Store" / "Cerrar Maity".
  // Copia de prueba (MSIX con firma ≠ `store`): la Store nunca la actualiza, así que
  // ni "Actualizar ahora" ni "Cerrar Maity" sirven — solo reinstalar desde la Store.
  const isStoreChannel = updateInfo?.channel === 'store';
  const isSideloaded = isStoreChannel && updateInfo?.storeSource === 'sideload';
  const canInstallFromStore = isStoreChannel && updateInfo?.storeSource === 'api' && !storeInstallFailed;
  const storeBusy = isClosingToUpdate || isInstallingFromStore;
  // StoreContext no expone el número nuevo: puede faltar. Y nunca se pinta una
  // "Nueva Versión" igual a la actual (el bug de e4f31b1 leía el paquete instalado).
  const newVersion =
    updateInfo?.version && compareVersions(updateInfo.version, updateInfo.currentVersion) !== 0
      ? updateInfo.version
      : undefined;

  useEffect(() => {
    // A media instalación NSIS no se resetea nada (re-check del tray u otra apertura).
    if (installInFlightRef.current) return;
    if (open && updateInfo?.available) {
      // Reset state when dialog opens
      setIsDownloading(false);
      setProgress(null);
      setError(null);
      setIsClosingToUpdate(false);
      setIsInstallingFromStore(false);
      setStoreInstallFailed(false);

      if (updateInfo.channel === 'store') {
        return;
      }

      // Solo sonda de disponibilidad: la descarga y la instalación las hace Rust
      // (`direct_update_install`), el JS nunca toca el objeto `Update`.
      check().then((updateResult) => {
        if (!updateResult?.available) setError('Actualización ya no disponible');
      }).catch((err) => {
        logger.error('[UpdateDialog] check falló', err);
        setError('Error al preparar actualización: ' + (err.message || 'Error desconocido'));
      });
    } else {
      // Reset state when dialog closes
      setIsDownloading(false);
      setProgress(null);
      setError(null);
      setIsClosingToUpdate(false);
      setIsInstallingFromStore(false);
      setStoreInstallFailed(false);
    }
  }, [open, updateInfo]);

  /**
   * Canal directo (NSIS): TODO el update lo hace el comando Rust
   * `direct_update_install` (B2). En Windows el plugin termina con
   * `process::exit(0)` y se salta `RunEvent::Exit`; Rust se niega con grabación o
   * post-proceso y cierra DB/sidecar antes del instalador. Aquí no hay
   * `downloadAndInstall`/`download`/`install`/`relaunch`: en Windows el proceso
   * muere dentro del invoke y NSIS `/P /R` relanza; en macOS/Linux Rust reinicia.
   */
  const handleDownloadAndInstall = async () => {
    // Pre-chequeo de fase: cualquier fase distinta de idle (incluye stopping).
    try {
      const state = await invoke<RecordingState>('get_recording_state');
      const busy = state?.phase ? state.phase !== 'idle' : Boolean(state?.is_recording);
      if (busy) {
        void fileLogger.info('updater_dialog', 'direct-install-refused-recording', { phase: state?.phase });
        toast.warning('Hay una grabación en curso. Detenla antes de actualizar Maity.');
        return;
      }
    } catch {
      /* Rust es la autoridad: direct_update_install se niega igual */
    }

    // Tras detener, la fase ya es idle pero el JS sigue guardando / el lote transcribiendo.
    if (isPostStopInFlight()) {
      void fileLogger.info('updater_dialog', 'direct-install-refused-post-stop', {});
      toast.warning('Maity está guardando o transcribiendo la última grabación. Actualiza cuando termine.');
      return;
    }

    installInFlightRef.current = true;
    setIsDownloading(true);
    setError(null);
    setProgress({ downloaded: 0, total: 0, percentage: 0 });

    let downloaded = 0;
    let contentLength = 0;
    const onEvent = new Channel<DownloadEvent>();
    onEvent.onmessage = (event) => {
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

        case 'Progress': {
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
        }

        case 'Finished':
          logger.debug('[UpdateDialog] Download finished');
          setProgress({
            downloaded: contentLength,
            total: contentLength,
            percentage: 100,
          });
          break;
      }
    };

    try {
      void fileLogger.info('updater_dialog', 'direct-install-start', { version: updateInfo?.version });
      const outcome = await invoke<DirectInstallOutcome>('direct_update_install', { onEvent });
      void fileLogger.info('updater_dialog', 'direct-install-result', { ...outcome });
      switch (outcome.kind) {
        case 'restarting':
          // El proceso se va: se deja `isDownloading`.
          toast.success('Actualización instalada. Maity se reiniciará…');
          break;
        case 'noUpdate':
          setIsDownloading(false);
          setError('Actualización ya no disponible');
          break;
        case 'recordingActive':
          setIsDownloading(false);
          setProgress(null);
          toast.warning('Empezó una grabación durante la descarga. Actualiza cuando la detengas.');
          break;
        case 'postProcessing':
          setIsDownloading(false);
          setProgress(null);
          toast.warning('Maity está guardando o transcribiendo la última grabación. Actualiza cuando termine.');
          break;
        case 'busy':
          setIsDownloading(false);
          toast.info('La actualización ya se está instalando.');
          break;
        case 'unsupported':
          setIsDownloading(false);
          setError('Esta instalación se actualiza desde su tienda.');
          break;
        case 'error':
          setIsDownloading(false);
          setError(outcome.detail || 'Error al descargar o instalar actualización');
          toast.error('Actualización fallida: ' + outcome.detail);
          break;
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      void fileLogger.error('updater_dialog', 'direct-install-failed', { message: errMsg });
      setError(errMsg || 'Error al descargar o instalar actualización');
      setIsDownloading(false);
      toast.error('Actualización fallida: ' + errMsg);
    } finally {
      installInFlightRef.current = false;
    }
  };

  /**
   * Canal Store: abre "Descargas y actualizaciones" de la Microsoft Store. Su
   * botón "Obtener actualizaciones" fuerza el check; la Store descarga en
   * segundo plano y aplica el paquete cuando Maity esté cerrado.
   */
  const handleOpenStore = () => openStoreLink(STORE_UPDATES_DEEP_LINK);

  /** Copia de prueba: la página de Maity en la Store, para instalar la versión de la Store. */
  const handleOpenStorePage = () => openStoreLink(STORE_PDP_DEEP_LINK);

  const openStoreLink = async (link: string) => {
    void fileLogger.info('updater_dialog', 'store-open-deep-link', { version: updateInfo?.version, link });
    try {
      await openExternalUrl(link);
    } catch (err: unknown) {
      console.error('Failed to open Microsoft Store:', err);
      toast.error('No se pudo abrir la Microsoft Store: ' + (err instanceof Error ? err.message : 'Error desconocido'));
    }
  };

  /**
   * Canal Store: la Store NO puede reemplazar un MSIX en ejecución; el paquete
   * se aplica al siguiente cierre. Sale por el comando Rust `exit_for_update`
   * (#83): registra `app.exit` `update`/`store_button` antes de cerrar y se niega
   * (`recording_active`) en cualquier fase distinta de idle — una jornada de
   * horas no debe depender del backstop de RunEvent::Exit.
   */
  const handleCloseToUpdate = async () => {
    const recordingWarning = 'Hay una grabación en curso. Detenla antes de cerrar Maity para actualizar.';
    setIsClosingToUpdate(true);
    try {
      const state = await invoke<RecordingState>('get_recording_state');
      if (state?.is_recording) {
        void fileLogger.info('updater_dialog', 'store-exit-refused-recording', { phase: state.phase });
        toast.warning(recordingWarning);
        return;
      }
      void fileLogger.info('updater_dialog', 'store-exit-to-update', { version: updateInfo?.version });
      await invoke('exit_for_update');
    } catch (err: unknown) {
      if (String(err).includes('recording_active')) {
        void fileLogger.info('updater_dialog', 'store-exit-refused-recording', { source: 'rust' });
        toast.warning(recordingWarning);
        return;
      }
      logger.error('[UpdateDialog] exit_for_update falló', err);
      toast.error('No se pudo cerrar Maity: ' + (err instanceof Error ? err.message : String(err) || 'Error desconocido'));
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
      {/* `grid-cols-[minmax(0,1fr)]`: sin esto la columna única del grid de DialogContent
          crece hasta el ancho mínimo de su hijo más ancho (el pie con 3 botones
          `whitespace-nowrap`) y versiones + caja gris se salían del card (captura 2026-09-23). */}
      <DialogContent
        className="sm:max-w-[540px] grid-cols-[minmax(0,1fr)]"
        onEscapeKeyDown={handleEscapeKeyDown}
        onInteractOutside={handleInteractOutside}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-6">
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
            ) : isSideloaded ? (
              <>
                <Store className="h-5 w-5 shrink-0 text-maity-blue" />
                Esta copia de Maity no se actualiza sola
              </>
            ) : isStoreChannel ? (
              <>
                <Store className="h-5 w-5 shrink-0 text-maity-blue" />
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
              : isSideloaded
              ? newVersion
                ? `Maity ${newVersion} ya está en la Microsoft Store`
                : 'Hay una versión nueva de Maity en la Microsoft Store'
              : isStoreChannel
              ? newVersion
                ? `Maity ${newVersion} ya está publicada en la Microsoft Store`
                : 'Hay una versión nueva de Maity en la Microsoft Store'
              : newVersion
              ? `Una nueva versión (${newVersion}) está disponible`
              : 'Hay una nueva versión disponible'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {!isDownloading && !error && (
            <>
              <div className="space-y-2">
                <div className="flex justify-between gap-4 text-sm">
                  <span className="text-muted-foreground">Versión Actual:</span>
                  <span className="font-medium">{updateInfo.currentVersion}</span>
                </div>
                {newVersion && (
                  <div className="flex justify-between gap-4 text-sm">
                    <span className="text-muted-foreground">Nueva Versión:</span>
                    <span className="font-medium text-maity-blue">{newVersion}</span>
                  </div>
                )}
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

              {isSideloaded && (
                <div className="bg-muted rounded-lg p-3 space-y-1">
                  <p className="text-sm text-foreground">
                    Esta copia se instaló con un paquete de prueba, no desde la Microsoft Store,
                    así que Windows no la va a actualizar.
                  </p>
                  <p className="text-sm text-foreground">
                    Para recibir actualizaciones: espera a que termine de sincronizar, cierra Maity,
                    desinstálala e instálala desde la Microsoft Store. Tus conversaciones
                    sincronizadas se conservan en la nube.
                  </p>
                </div>
              )}

              {isStoreChannel && !canInstallFromStore && !isSideloaded && (
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

        {/* `sm:flex-wrap` + `gap-2`: los botones Store (hasta 3, `whitespace-nowrap`) pasan
            a otra línea en vez de desbordar; `sm:space-x-0` porque el margen de space-x
            se rompe al envolver. */}
        <DialogFooter className="gap-2 sm:flex-wrap sm:space-x-0">
          {!isDownloading && !error && isSideloaded && (
            <>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Más Tarde
              </Button>
              <Button onClick={handleOpenStorePage} className="bg-[#3a4ac3] hover:bg-[#2b3892]">
                <ExternalLink className="h-4 w-4 mr-2" />
                Abrir Maity en la Store
              </Button>
            </>
          )}
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
          {!isDownloading && !error && isStoreChannel && !canInstallFromStore && !isSideloaded && (
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
