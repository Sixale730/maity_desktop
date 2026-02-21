import { useEffect } from 'react';

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
            const shouldClose = window.confirm(
              'Hay una grabación en progreso. Cerrar la app detendrá la grabación. ¿Continuar?'
            );
            if (shouldClose) {
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
