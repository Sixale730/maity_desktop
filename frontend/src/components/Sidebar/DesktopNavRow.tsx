'use client';

/**
 * Fila de navegación de la Sidebar del desktop.
 *
 * Adaptación de web Sixale730/maity@3ef2914 src/shared/components/shell-v6/NavRow.tsx:
 * - Mismo look: `data-nav-route` (color por ruta de sidebar-navigation.css), `--nav-color`,
 *   ilustración `PortalNavIcon`, activo con `color-mix` (12 % fondo / 35 % borde).
 * - Navega con `router.push` a la ruta REAL del desktop (sin react-router ni zonas).
 * - Estilos con clases (propiedades arbitrarias de Tailwind), nunca `style=""`: regla CSP
 *   del primer paint (docs/UI_REGLAS.md).
 * - Colapsada: cuadro 40×40 con Tooltip de Radix (como el resto de la barra del desktop).
 * - Sin badges (el desktop no tiene contadores en la barra).
 */
import React from 'react';
import { useRouter } from 'next/navigation';
import { PortalNavIcon } from '@/shared/components/shell-v6/PortalNavIcon';
import '@/shared/components/shell-v6/sidebar-navigation.css';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { DesktopNavItem } from './navItems';

interface DesktopNavRowProps {
  item: DesktopNavItem;
  active: boolean;
  collapsed: boolean;
}

const ACTIVE_CLASSES =
  '[background:color-mix(in_srgb,var(--nav-color)_12%,transparent)] [border-color:color-mix(in_srgb,var(--nav-color)_35%,transparent)]';
const INACTIVE_CLASSES = 'bg-transparent border-transparent hover:bg-sidebar-accent';

export function DesktopNavRow({ item, active, collapsed }: DesktopNavRowProps) {
  const router = useRouter();
  const go = () => router.push(item.route);

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            data-nav-route={item.webRoute}
            onClick={go}
            aria-label={item.label}
            aria-current={active ? 'page' : undefined}
            className={`relative grid place-items-center w-10 h-10 rounded-[9px] border transition-colors [color:var(--nav-color)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring ${item.fallbackClass} ${active ? ACTIVE_CLASSES : INACTIVE_CLASSES}`}
          >
            <PortalNavIcon to={item.webRoute} fallback={item.fallbackIcon} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">
          <p>{item.label}</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <button
      type="button"
      data-nav-route={item.webRoute}
      onClick={go}
      aria-current={active ? 'page' : undefined}
      className={`w-full flex items-center gap-2.5 min-h-[44px] px-2.5 py-[7px] my-px rounded-lg border text-left text-[12.5px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 ${item.fallbackClass} ${active ? `${ACTIVE_CLASSES} text-foreground font-semibold` : `${INACTIVE_CLASSES} text-foreground/60 hover:text-foreground font-medium`}`}
    >
      <span className="portal-nav-icon shrink-0 [color:var(--nav-color)]">
        <PortalNavIcon to={item.webRoute} fallback={item.fallbackIcon} />
      </span>
      <span className="flex-1 truncate">{item.label}</span>
    </button>
  );
}
