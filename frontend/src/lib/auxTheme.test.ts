import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AUX_THEME_STORAGE_KEY, useAuxThemeSync } from './auxTheme';

afterEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove('dark');
  delete document.documentElement.dataset.portalTheme;
});

describe('useAuxThemeSync', () => {
  it('por defecto es claro (sin .dark)', () => {
    document.documentElement.classList.add('dark');
    renderHook(() => useAuxThemeSync());
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('aplica oscuro si la main lo guardó', () => {
    localStorage.setItem(AUX_THEME_STORAGE_KEY, 'dark');
    renderHook(() => useAuxThemeSync());
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('sigue en vivo el toggle de la barra lateral (evento storage)', () => {
    renderHook(() => useAuxThemeSync());
    localStorage.setItem(AUX_THEME_STORAGE_KEY, 'dark');
    window.dispatchEvent(new StorageEvent('storage', { key: AUX_THEME_STORAGE_KEY, newValue: 'dark' }));
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    localStorage.setItem(AUX_THEME_STORAGE_KEY, 'light');
    window.dispatchEvent(new StorageEvent('storage', { key: AUX_THEME_STORAGE_KEY, newValue: 'light' }));
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('re-lee al recuperar el foco y nunca escribe data-portal-theme', () => {
    renderHook(() => useAuxThemeSync());
    localStorage.setItem(AUX_THEME_STORAGE_KEY, 'dark');
    window.dispatchEvent(new Event('focus'));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.dataset.portalTheme).toBeUndefined();
  });
});
