/**
 * Tabla de navegación de la Sidebar del desktop (paridad visual con la web, sep-2026).
 *
 * Las rutas del desktop NO cambian (`/`, `/conversations`, `/notes`, `/tasks`, `/chat`,
 * `/settings`); cada una se mapea a su ruta equivalente de la web (`webRoute`) SOLO para
 * elegir la ilustración de `PortalNavIcon` y el color por ruta de
 * `shell-v6/sidebar-navigation.css` (que se engancha a `data-nav-route`).
 *
 * `/tasks` no tiene equivalente con ilustración en la web (allí `/tareas` es alias de
 * `/notas`): usa el ícono lucide `ListChecks` de fallback y su acento `ROUTE_COLOR.tareas`.
 *
 * `fallbackClass` fija `--nav-fallback` con una propiedad arbitraria de Tailwind en lugar
 * de `style=""` (regla CSP del primer paint; ver docs/UI_REGLAS.md). Es la versión literal
 * de `accent` (los literales son obligatorios para que Tailwind los genere); el test
 * `navItems.test.ts` verifica que ambos coincidan.
 */
import { Bot, FileText, Home, ListChecks, MessageSquare, Settings, type LucideIcon } from 'lucide-react';
import { ROUTE_COLOR } from '@/shared/components/shell-v6/tokens';

export interface DesktopNavItem {
  id: 'inicio' | 'conversaciones' | 'notas' | 'tareas' | 'chat' | 'configuracion';
  /** Ruta REAL del desktop (router.push). */
  route: string;
  /** Ruta equivalente de la web: elige ilustración y color (data-nav-route). */
  webRoute: string;
  label: string;
  /** Ícono lucide si PortalNavIcon no tiene ilustración para `webRoute`. */
  fallbackIcon: LucideIcon;
  /** Color del ícono (tema oscuro y rutas sin color propio en la web). */
  accent: string;
  /** Clase Tailwind literal que fija `--nav-fallback: accent`. */
  fallbackClass: string;
}

export const NAV_ITEMS: readonly DesktopNavItem[] = [
  {
    id: 'inicio',
    route: '/',
    webRoute: '/dashboard',
    label: 'Inicio',
    fallbackIcon: Home,
    accent: ROUTE_COLOR.progreso,
    fallbackClass: '[--nav-fallback:#1bea9a]',
  },
  {
    id: 'conversaciones',
    route: '/conversations',
    webRoute: '/conversaciones',
    label: 'Conversaciones',
    fallbackIcon: MessageSquare,
    accent: ROUTE_COLOR.convs,
    fallbackClass: '[--nav-fallback:#00f5d4]',
  },
  {
    id: 'notas',
    route: '/notes',
    webRoute: '/notas',
    label: 'Notas',
    fallbackIcon: FileText,
    accent: ROUTE_COLOR.notas,
    fallbackClass: '[--nav-fallback:#a78bfa]',
  },
  {
    id: 'tareas',
    route: '/tasks',
    webRoute: '/tareas',
    label: 'Tareas',
    fallbackIcon: ListChecks,
    accent: ROUTE_COLOR.tareas,
    fallbackClass: '[--nav-fallback:#f97316]',
  },
  {
    id: 'chat',
    route: '/chat',
    webRoute: '/chat',
    label: 'Chat con Maity',
    fallbackIcon: Bot,
    accent: ROUTE_COLOR.sesiones,
    fallbackClass: '[--nav-fallback:#485df4]',
  },
];

/** Configuración va aparte: en la barra colapsada se pinta DEBAJO del botón de grabar. */
export const SETTINGS_NAV_ITEM: DesktopNavItem = {
  id: 'configuracion',
  route: '/settings',
  webRoute: '/configuracion',
  label: 'Configuración',
  fallbackIcon: Settings,
  accent: ROUTE_COLOR.hoy,
  fallbackClass: '[--nav-fallback:hsl(var(--muted-foreground))]',
};

export const ALL_NAV_ITEMS: readonly DesktopNavItem[] = [...NAV_ITEMS, SETTINGS_NAV_ITEM];

/**
 * ¿La fila está activa para `pathname`? `/` solo por igualdad exacta; el resto también
 * por sub-ruta (`/notes/abc`). Tolera la barra final del export estático.
 */
export function isNavItemActive(pathname: string | null | undefined, item: DesktopNavItem): boolean {
  if (!pathname) return false;
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (item.route === '/') return path === '/';
  return path === item.route || path.startsWith(`${item.route}/`);
}
