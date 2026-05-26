/**
 * Shim de `react-router-dom` para componentes copiados desde la web (Sixale730/maity).
 * La web usa React Router; el desktop usa Next.js App Router.
 *
 * Va en `src/lib/router-compat.ts`.
 *
 * Uso (find-and-replace en los archivos copiados del web):
 *   - import { useNavigate, useLocation } from 'react-router-dom'
 *   + import { useNavigate, useLocation } from '@/lib/router-compat'
 */
'use client'

import { usePathname, useRouter } from 'next/navigation'

export function useNavigate() {
  const router = useRouter()
  return (path: string) => {
    router.push(path)
  }
}

/** Mimic react-router-dom's useLocation. Solo expone `pathname`, que es lo que la web usa. */
export function useLocation() {
  const pathname = usePathname()
  return {
    pathname: pathname ?? '/',
    search: '',
    hash: '',
    state: null,
    key: 'default',
  }
}
