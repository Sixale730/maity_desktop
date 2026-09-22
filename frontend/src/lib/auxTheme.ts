'use client';

import { useEffect } from 'react';

/**
 * Tema claro/oscuro de las ventanas auxiliares (coach-float, recording-widget, device-picker).
 *
 * `public/aux-theme-boot.js` aplica el tema antes del primer pintado; este hook lo mantiene al
 * día mientras la ventana sigue abierta. Las ventanas aux comparten origen (y localStorage) con
 * la main, así que al alternar el toggle de la barra lateral llega un evento `storage` aquí.
 * `focus`/`visibilitychange` son red de seguridad por si el evento no cruzara entre webviews.
 *
 * Solo alterna `.dark` en <html> — nunca `data-portal-theme` (activa el lienzo de fondo de la
 * main y taparía la transparencia de la ventana). Sin imports de contexts/ ni de la main: el grafo
 * de imports aux está vigilado por app/(aux)/layout.test.ts.
 */
export const AUX_THEME_STORAGE_KEY = 'maity-portal-theme';

export function readAuxThemeIsDark(): boolean {
  try {
    return localStorage.getItem(AUX_THEME_STORAGE_KEY) === 'dark';
  } catch {
    return false;
  }
}

export function applyAuxTheme(): void {
  document.documentElement.classList.toggle('dark', readAuxThemeIsDark());
}

export function useAuxThemeSync(): void {
  useEffect(() => {
    applyAuxTheme();
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === AUX_THEME_STORAGE_KEY) applyAuxTheme();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') applyAuxTheme();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', applyAuxTheme);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', applyAuxTheme);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);
}
