'use client'

/**
 * Tema claro/oscuro de la ventana principal (paridad con la web, sep-2026).
 *
 * - Claro por defecto; la elección vive en localStorage `maity-portal-theme`.
 * - `public/theme-boot.js` (bloqueante en el <head> de app/(main)/layout.tsx) estampa
 *   `data-portal-theme` y `.dark` en <html> ANTES del primer pintado → sin flash.
 * - `DashboardTheme` (features/dashboard/components/gamified-v2) es el ÚNICO escritor de
 *   `.dark`/`data-portal-theme` después del arranque. Este provider solo lo envuelve.
 * - Las paletas neutral/cool/warm se retiraron (decisión de Julio): el oscuro es el de la web.
 * - Las ventanas aux (coach-float, recording-widget, device-picker) no montan esto: siguen
 *   `dark bg-transparent` por su propio root layout.
 */

import React, { useContext, useEffect } from 'react'
import { DashboardTheme } from '@/features/dashboard/components/gamified-v2/DashboardTheme'
import {
  ThemeContext,
  type Theme,
} from '@/features/dashboard/components/gamified-v2/dashboard-theme-context'

export type { Theme }

/** Key de las paletas retiradas; se limpia una vez para no dejar basura en storage. */
const LEGACY_PALETTE_KEY = 'maity-theme-palette'

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    try {
      localStorage.removeItem(LEGACY_PALETTE_KEY)
    } catch {
      /* storage no disponible: nada que limpiar */
    }
    // Las clases theme-* las ponía el provider viejo; si una sesión vieja las dejó, fuera.
    document.documentElement.classList.remove('theme-neutral', 'theme-cool', 'theme-warm')
  }, [])

  return <DashboardTheme>{children}</DashboardTheme>
}

/** `{ theme, toggle }` del tema global. Debe usarse dentro de <ThemeProvider>. */
export function useTheme(): { theme: Theme; toggle: () => void } {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider')
  }
  return context
}
