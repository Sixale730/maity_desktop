import { useEffect, useRef } from 'react';
import { createSubscriptionGroup } from '@/lib/tauriSubscribe';

/**
 * Guard contra cerrar la ventana mientras hay una grabacion activa.
 * Como el handler en Rust (WindowEvent::CloseRequested en lib.rs) ahora
 * esconde la ventana en el tray en lugar de matar el proceso, una
 * grabacion activa seguiria corriendo en background si el user cierra
 * sin avisar. El guard avisa al user y le da la opcion explicita.
 */
export function useWindowCloseGuard(isRecording: boolean) {
  // Latest-ref: antes `isRecording` era dependencia del efecto, así que el
  // handler de cierre se desregistraba y volvía a registrar cada vez que
  // arrancaba o paraba una grabación (issue #65).
  const isRecordingRef = useRef(isRecording);
  isRecordingRef.current = isRecording;
  // Re-entrada: tras confirmar se vuelve a pedir close() para que corra el
  // handler de Rust; esa segunda vuelta no debe volver a preguntar.
  const forcingHideRef = useRef(false);

  useEffect(() => {
    const subs = createSubscriptionGroup();

    const setup = async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const appWindow = getCurrentWindow();
        subs.add(appWindow.onCloseRequested(async (event) => {
          // SIEMPRE preventDefault, haya grabacion o no. @tauri-apps/api llama
          // destroy() por su cuenta cuando el handler no previene, y con
          // core:window:allow-destroy concedido (8bdd3bf) ese destroy() SI
          // funciona: destruye la ventana y la app sale entera. El hide a la
          // bandeja ya lo hace Rust (CloseRequested en lib.rs).
          event.preventDefault();
          if (forcingHideRef.current) {
            forcingHideRef.current = false;
            return;
          }
          if (isRecordingRef.current) {
            const shouldHide = window.confirm(
              'Hay una grabación en progreso. Cerrar la ventana esconderá la app en la bandeja del sistema y la grabación continuará en segundo plano. ¿Continuar?'
            );
            if (shouldHide) {
              // Forzar el hide via el handler de Rust: dispara el flujo de
              // cleanup de idle (close coach-float, stop preview monitor)
              // sin detener la grabacion en curso.
              forcingHideRef.current = true;
              appWindow.close();
            }
          }
        }));
      } catch {
        // Not in Tauri environment (e.g., browser dev), skip
      }
    };

    setup();
    return () => subs.dispose();
  }, []);
}
