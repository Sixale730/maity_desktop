import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { render } from '@testing-library/react';
import { ListChecks } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { PortalNavIcon } from '@/shared/components/shell-v6/PortalNavIcon';
import { ROUTE_COLOR } from '@/shared/components/shell-v6/tokens';
import { ALL_NAV_ITEMS, NAV_ITEMS, SETTINGS_NAV_ITEM, isNavItemActive } from './navItems';

const read = (rel: string) => readFileSync(path.resolve(__dirname, rel), 'utf8');

describe('Sidebar NAV_ITEMS', () => {
  it('conserva las rutas del desktop y las mapea a la ruta web del plan', () => {
    const map = Object.fromEntries(ALL_NAV_ITEMS.map((i) => [i.route, i.webRoute]));
    expect(map).toEqual({
      '/': '/dashboard',
      '/conversations': '/conversaciones',
      '/notes': '/notas',
      '/tasks': '/tareas',
      '/chat': '/chat',
      '/settings': '/configuracion',
    });
    // Configuración va aparte (colapsada: debajo del botón de grabar).
    expect(NAV_ITEMS.map((i) => i.route)).not.toContain('/settings');
    expect(SETTINGS_NAV_ITEM.route).toBe('/settings');
  });

  it('ids únicos', () => {
    const ids = ALL_NAV_ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('fallbackClass es la versión literal de accent (sin style="" inline)', () => {
    for (const item of ALL_NAV_ITEMS) {
      expect(item.fallbackClass).toBe(`[--nav-fallback:${item.accent.replace(/ /g, '_')}]`);
    }
    expect(SETTINGS_NAV_ITEM.accent).toBe(ROUTE_COLOR.hoy);
  });

  it('todas las rutas web salvo /tareas tienen ilustración; /tareas cae a ListChecks', () => {
    for (const item of ALL_NAV_ITEMS) {
      const { container, unmount } = render(
        createElement(PortalNavIcon, { to: item.webRoute, fallback: item.fallbackIcon }),
      );
      const hasArt = container.querySelector('.portal-nav-art') !== null;
      expect(hasArt, item.webRoute).toBe(item.route !== '/tasks');
      unmount();
    }
    expect(NAV_ITEMS.find((i) => i.route === '/tasks')?.fallbackIcon).toBe(ListChecks);
  });

  it('las rutas web con color propio están en sidebar-navigation.css', () => {
    const css = read('../../shared/components/shell-v6/sidebar-navigation.css');
    for (const item of ALL_NAV_ITEMS) {
      if (item.route === '/tasks') continue;
      expect(css, item.webRoute).toContain(`[data-nav-route='${item.webRoute}']`);
    }
  });
});

describe('isNavItemActive', () => {
  const byRoute = (r: string) => ALL_NAV_ITEMS.find((i) => i.route === r)!;

  it('Inicio solo por igualdad exacta', () => {
    expect(isNavItemActive('/', byRoute('/'))).toBe(true);
    expect(isNavItemActive('/conversations', byRoute('/'))).toBe(false);
  });

  it('sub-rutas y barra final del export estático', () => {
    expect(isNavItemActive('/conversations', byRoute('/conversations'))).toBe(true);
    expect(isNavItemActive('/conversations/', byRoute('/conversations'))).toBe(true);
    expect(isNavItemActive('/notes/abc', byRoute('/notes'))).toBe(true);
    expect(isNavItemActive('/notesx', byRoute('/notes'))).toBe(false);
    expect(isNavItemActive('/settings', SETTINGS_NAV_ITEM)).toBe(true);
    expect(isNavItemActive(null, SETTINGS_NAV_ITEM)).toBe(false);
  });
});

describe('Sidebar: invariantes que no deben romperse con el restyle', () => {
  const sidebar = read('./index.tsx');
  const controls = read('./SidebarControls.tsx');
  const row = read('./DesktopNavRow.tsx');

  it('anchos w-16/w-64 y fondo de sidebar', () => {
    expect(sidebar).toContain("isCollapsed ? 'w-16' : 'w-64'");
    expect(sidebar).toContain('bg-sidebar');
    expect(sidebar).toContain('border-sidebar-border');
  });

  it('el botón de grabar sigue cableado a handleRecordingToggle', () => {
    expect(sidebar).toContain('onClick={handleRecordingToggle}');
    expect(sidebar).toContain('disabled={isRecording || isStartingRecording}');
    expect(sidebar).toContain('onRecordingToggle={handleRecordingToggle}');
    expect(controls).toContain('onClick={onRecordingToggle}');
  });

  it('las filas no usan style="" (regla CSP del primer paint)', () => {
    expect(row).not.toMatch(/style=\{/);
  });
});
