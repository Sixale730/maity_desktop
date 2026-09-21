/**
 * Shim de `react-router-dom` para componentes copiados desde la web (Sixale730/maity).
 * La web usa React Router; el desktop usa Next.js App Router.
 *
 * Va en `src/lib/router-compat.ts` (sin JSX a propósito: `Link` usa createElement).
 *
 * Uso (find-and-replace en los archivos copiados del web):
 *   - import { useNavigate, useLocation, Link } from 'react-router-dom'
 *   + import { useNavigate, useLocation, Link } from '@/lib/router-compat'
 *
 * Mapeo de rutas web → desktop (`resolveRoute`, lo comparten `useNavigate` y `Link`):
 *   /dashboard | /gamified-dashboard-v2 → /
 *   /conversaciones            → /conversations
 *   /conversaciones/:id        → /conversations?id=:id   (detalle cloud, ver CLAUDE.md § Paginas)
 *   /notas → /notes · /configuracion → /settings
 *   /auth*                     → /   (no hay rutas de auth en el desktop)
 *   /agenda, /avatar*, /skills-arena*, /learning-path*, /expedicion*
 *                              → navegador externo en https://www.maity.cloud/<misma ruta+query>
 *                                (el desktop no tiene esas pantallas; fuera de alcance sep-2026)
 *   /registration | /billing/plans* | resto → tal cual
 */
'use client'

import { createElement, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from 'react'
import NextLink from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { openExternalUrl } from '@/lib/planLinks'

export const MAITY_WEB_ORIGIN = 'https://www.maity.cloud'

// Rutas que redirigen a la raíz del desktop
const ROOT_ALIASES = ['/dashboard', '/gamified-dashboard-v2']
// Renombres web (español) → rutas del desktop
const INTERNAL_ALIASES: Record<string, string> = {
  '/conversaciones': '/conversations',
  '/notas': '/notes',
  '/configuracion': '/settings',
}
// Prefijos que solo existen en la web: se abren en el navegador conservando ruta y query
const EXTERNAL_PREFIXES = ['/agenda', '/avatar', '/skills-arena', '/learning-path', '/expedicion']

export interface ResolvedRoute {
  external?: string
  internal?: string
}

function matchesPrefix(basePath: string, prefix: string): boolean {
  return basePath === prefix || basePath.startsWith(prefix + '/')
}

export function resolveRoute(path: string): ResolvedRoute {
  const queryIndex = path.indexOf('?')
  const basePath = queryIndex >= 0 ? path.slice(0, queryIndex) : path
  const query = queryIndex >= 0 ? path.slice(queryIndex) : ''

  // Redirecciones a raíz
  if (ROOT_ALIASES.includes(basePath)) return { internal: '/' }

  // Rutas de auth web → raíz del desktop
  if (basePath.startsWith('/auth')) return { internal: '/' }

  // Detalle de conversación: /conversaciones/:id → /conversations?id=:id
  const detail = /^\/conversaciones\/([^/]+)\/?$/.exec(basePath)
  if (detail) {
    const params = new URLSearchParams(query.slice(1))
    params.set('id', decodeURIComponent(detail[1]))
    return { internal: `/conversations?${params.toString()}` }
  }

  const renamed = INTERNAL_ALIASES[basePath]
  if (renamed) return { internal: renamed + query }

  // Rutas que solo viven en la web
  if (EXTERNAL_PREFIXES.some((prefix) => matchesPrefix(basePath, prefix))) {
    return { external: MAITY_WEB_ORIGIN + path }
  }

  // El resto pasa tal cual
  return { internal: path }
}

interface NavigateOptions {
  replace?: boolean
}

export function useNavigate() {
  const router = useRouter()
  return (path: string, options?: NavigateOptions) => {
    const resolved = resolveRoute(path)
    if (resolved.external) {
      void openExternalUrl(resolved.external)
      return
    }
    const internal = resolved.internal ?? path
    if (options?.replace) {
      router.replace(internal)
    } else {
      router.push(internal)
    }
  }
}

/**
 * Mimic react-router-dom's useLocation.
 * Expone pathname y search real (vía useSearchParams).
 * NOTA: los componentes que usen useLocation().search deben estar envueltos en
 * <Suspense> porque useSearchParams() requiere suspense boundary en Next.js.
 */
export function useLocation() {
  const pathname = usePathname()
  // useSearchParams() puede ser null fuera de un Suspense boundary; proteger.
  let searchParams: URLSearchParams | null = null
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- wrapped in try/catch para SSR safety
    searchParams = useSearchParams()
  } catch {
    // Fuera de Suspense boundary — devolver search vacío
  }
  const search = searchParams ? `?${searchParams.toString()}` : ''

  return {
    pathname: pathname ?? '/',
    search,
    hash: '',
    state: null,
    key: 'default',
  }
}

export interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  to: string
  replace?: boolean
  children?: ReactNode
}

/**
 * Mimic de `<Link to>` de react-router-dom.
 * - Ruta interna (ya mapeada) → `next/link`.
 * - Ruta que solo existe en la web → `<a href="https://www.maity.cloud/…">` que se
 *   abre en el navegador del sistema con `openExternalUrl` (comando Tauri
 *   `open_external_url`). Sin el `preventDefault`, WebView2 navegaría la ventana
 *   principal fuera de la app.
 */
export function Link({ to, replace, onClick, children, ...rest }: LinkProps) {
  const resolved = resolveRoute(to)
  if (resolved.external) {
    const href = resolved.external
    const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
      onClick?.(event)
      if (event.defaultPrevented) return
      event.preventDefault()
      void openExternalUrl(href)
    }
    return createElement('a', { ...rest, href, rel: 'noopener noreferrer', onClick: handleClick }, children)
  }
  return createElement(NextLink, { ...rest, href: resolved.internal ?? to, replace, onClick }, children)
}
