// Origen: web Sixale730/maity@3ef2914 src/features/dashboard/components/gamified-v2/DashboardTheme.test.tsx
// Copia tal cual (vitest + jsdom + testing-library, igual que la web).
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DashboardTheme, DashboardThemeToggle } from './DashboardTheme';
import { useDashboardTheme } from './dashboard-theme-context';

afterEach(() => {
  cleanup();
  localStorage.removeItem('maity-portal-theme');
  document.documentElement.classList.remove('dark');
  delete document.documentElement.dataset.portalTheme;
  vi.restoreAllMocks();
});
const renderTheme = () => render(<DashboardTheme><DashboardThemeToggle /></DashboardTheme>);

describe('Dashboard appearance', () => {
  it('defaults to light, persists the choice and keeps it after unmount', () => {
    const view = renderTheme();
    expect(document.documentElement.dataset.portalTheme).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name:'Activar tema oscuro' }));
    expect(document.documentElement.dataset.portalTheme).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem('maity-portal-theme')).toBe('dark');
    view.unmount();
    // El tema es global al documento: salir de una ruta protegida no lo revierte.
    expect(document.documentElement.dataset.portalTheme).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    renderTheme();
    expect(document.documentElement.dataset.portalTheme).toBe('dark');
    fireEvent.click(screen.getByRole('button', { name:'Activar tema claro' }));
    expect(document.documentElement.dataset.portalTheme).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('allows changing theme when preference storage is unavailable', () => {
    vi.spyOn(Storage.prototype,'getItem').mockImplementation(() => { throw Error('Unavailable'); });
    vi.spyOn(Storage.prototype,'setItem').mockImplementation(() => { throw Error('Unavailable'); });
    renderTheme();
    fireEvent.click(screen.getByRole('button', { name:'Activar tema oscuro' }));
    expect(document.documentElement.dataset.portalTheme).toBe('dark');
  });

  it('reports light when used outside the provider', () => {
    const Probe = () => <span data-testid="theme">{useDashboardTheme()}</span>;
    render(<Probe />);
    expect(screen.getByTestId('theme').textContent).toBe('light');
  });
});
