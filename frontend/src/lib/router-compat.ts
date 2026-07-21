/**
 * Shim de `react-router-dom` para componentes copiados desde la web (Sixale730/maity).
 * La web usa React Router; el desktop usa Next.js App Router.
 *
 * Va en `src/lib/router-compat.ts`.
 *
 * Uso (find-and-replace en los archivos copiados del web):
 *   - import { useNavigate, useLocation } from 'react-router-dom'
 *   + import { useNavigate, useLocation } from '@/lib/router-compat'
 *
 * Mapeo de rutas especiales (port del onboarding — ver plan when-we-release-the-twinkly-star):
 *   /dashboard | /gamified-dashboard-v2 → /
 *   /agenda → abre en navegador externo (https://www.maity.cloud/agenda), no navega
 *   /auth* → / (no hay rutas de auth en el desktop)
 *   /registration | /billing/plans* → tal cual
 *   resto → tal cual
 */
'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { openExternalUrl } from '@/lib/planLinks'

// Rutas que redirigen a la raíz del desktop
const ROOT_ALIASES = ['/dashboard', '/gamified-dashboard-v2']
// Rutas que van al sitio web externo
const EXTERNAL_ALIASES: Record<string, string> = {
  '/agenda': 'https://www.maity.cloud/agenda',
}

function resolveRoute(path: string): { external?: string; internal?: string } {
  // Limpiar query string para la comparación de prefijo
  const basePath = path.split('?')[0]

  // Redirecciones a raíz
  if (ROOT_ALIASES.includes(basePath)) return { internal: '/' }

  // Rutas de auth web → raíz del desktop
  if (basePath.startsWith('/auth')) return { internal: '/' }

  // Rutas externas (agenda)
  for (const [prefix, externalUrl] of Object.entries(EXTERNAL_ALIASES)) {
    if (basePath === prefix || basePath.startsWith(prefix + '/')) {
      return { external: externalUrl }
    }
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
