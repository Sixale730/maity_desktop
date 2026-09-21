'use client';

/**
 * Toggle sol/luna del tema claro/oscuro en la Sidebar.
 *
 * Mismos íconos y textos que `DashboardThemeToggle` de la web
 * (Sixale730/maity@3ef2914 features/dashboard/components/gamified-v2/DashboardTheme.tsx),
 * pero con clases de la barra del desktop y leyendo `useTheme()` de ThemeContext
 * (que envuelve a DashboardTheme: único escritor de `.dark`/`data-portal-theme`).
 */
import React from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';

interface ThemeToggleProps {
  isCollapsed: boolean;
}

export function ThemeToggle({ isCollapsed }: ThemeToggleProps) {
  const { theme, toggle } = useTheme();
  const dark = theme === 'dark';
  const label = dark ? 'Activar tema claro' : 'Activar tema oscuro';
  const Icon = dark ? Sun : Moon;

  if (isCollapsed) {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-label={label}
        title={label}
        className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-sidebar-accent transition-colors"
      >
        <Icon className="w-5 h-5" aria-hidden="true" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className="w-full flex items-center justify-center px-3 py-1.5 mt-1 text-sm font-medium text-secondary-foreground bg-secondary hover:bg-secondary/80 rounded-lg transition-colors shadow-sm"
    >
      <Icon className="w-4 h-4 mr-2" aria-hidden="true" />
      <span>{dark ? 'Tema claro' : 'Tema oscuro'}</span>
    </button>
  );
}
