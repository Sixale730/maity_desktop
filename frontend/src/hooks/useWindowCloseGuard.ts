import { useEffect } from 'react';

/**
 * Guard contra cerrar la ventana mientras hay una grabacion activa.
 * Como el handler en Rust (WindowEvent::CloseRequested en lib.rs) ahora
 * esconde la ventana en el tray en lugar de matar el proceso, una
 * grabacion activa seguiria corriendo en background si el user cierra
 * sin avisar. El guard avisa al user y le da la opcion explicita.
 */
export function useWindowCloseGuard(isRecording: boolean) {
  useEffect(() => {
    let cleanup: (() => void) | undefined;

    const setup = async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const appWindow = getCurrentWindow();
        cleanup = await appWindow.onCloseRequested(async (event) => {
          if (isRecording) {
            event.preventDefault();
            const shouldHide = window.confirm(
              'Hay una grabación en progreso. Cerrar la ventana esconderá la app en la bandeja del sistema y la grabación continuará en segundo plano. ¿Continuar?'
            );
            if (shouldHide) {
              // Forzar el hide via el handler de Rust: dispara el flujo de
              // cleanup de idle (close coach-float, stop preview monitor)
              // sin detener la grabacion en curso.
              appWindow.close();
            }
          }
        });
      } catch {
        // Not in Tauri environment (e.g., browser dev), skip
      }
    };

    setup();
    return () => cleanup?.();
  }, [isRecording]);
}
