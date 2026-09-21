'use client';
// Origen: web Sixale730/maity@3ef2914 src/features/dashboard/components/gamified-v2/DashboardTheme.tsx
// Adaptaciones desktop: 'use client'. Es el ÚNICO escritor de `.dark` y `data-portal-theme` en la
// ventana principal (lo monta contexts/ThemeContext.tsx); public/theme-boot.js estampa el valor
// inicial antes del primer pintado. Las ventanas aux no montan esto (siguen `dark bg-transparent`).
import { useContext, useLayoutEffect, useState, type ReactNode } from 'react';
import { ThemeContext, type Theme } from './dashboard-theme-context';
import { Moon, Sun } from 'lucide-react';
import './dashboard-theme.css';

const STORAGE_KEY = 'maity-portal-theme';

export function DashboardTheme({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    try { return localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light'; }
    catch { return 'light'; }
  });
  // El tema es global al documento (lo estampa public/theme-boot.js antes del primer pintado);
  // aquí solo se sincroniza al alternar. Sin limpieza al desmontar: salir del portal no lo revierte.
  useLayoutEffect(() => {
    document.documentElement.dataset.portalTheme = theme;
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  function toggle() {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* Theme still works for this visit. */ }
  }

  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
}

export function DashboardThemeToggle() {
  const context = useContext(ThemeContext);
  if (!context) return null;
  const dark = context.theme === 'dark';
  return <button type="button" className="dashboard-theme-toggle" onClick={context.toggle}
    aria-label={dark ? 'Activar tema claro' : 'Activar tema oscuro'} title={dark ? 'Activar tema claro' : 'Activar tema oscuro'}>
    {dark ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}
    <span>{dark ? 'Tema claro' : 'Tema oscuro'}</span>
  </button>;
}
