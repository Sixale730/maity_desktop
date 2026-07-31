/**
 * Rutas que corren en ventanas webview auxiliares propias (no en la ventana
 * principal). LISTA CANÓNICA — todos los consumidores (`layout.tsx`,
 * `BackgroundDownloadStarter`, initializers con gate) importan de aquí; al
 * agregar una ventana auxiliar nueva basta con sumarla a este array.
 */
export const AUX_WINDOW_PATHS = ['/coach-float', '/recording-widget', '/device-picker'] as const

export function isAuxWindowPath(pathname: string | null | undefined): boolean {
  return !!pathname && (AUX_WINDOW_PATHS as readonly string[]).includes(pathname)
}
