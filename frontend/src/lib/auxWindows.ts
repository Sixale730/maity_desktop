/**
 * Rutas que corren en ventanas webview auxiliares propias (no en la ventana
 * principal). Lista canónica para código nuevo — `layout.tsx` (isSpecialRoute)
 * y `BackgroundDownloadStarter.tsx` tienen copias históricas de esta lista.
 */
export const AUX_WINDOW_PATHS = ['/coach-float', '/recording-widget', '/device-picker'] as const

export function isAuxWindowPath(pathname: string | null | undefined): boolean {
  return !!pathname && (AUX_WINDOW_PATHS as readonly string[]).includes(pathname)
}
