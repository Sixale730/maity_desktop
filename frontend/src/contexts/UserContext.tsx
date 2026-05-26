/**
 * Shim para que los componentes del web que usan `useUser()` sigan funcionando
 * en el desktop. Mapea `useAuth().maityUser` del AuthContext del desktop a la
 * forma `{ userProfile }` que la web espera.
 *
 * Vive en `src/contexts/UserContext.tsx`. Los imports de la web
 * (`@/contexts/UserContext`) resuelven aquí automáticamente.
 *
 * Si el shape de `MaityUser` no incluye exactamente {id, name, email, role},
 * ajusta el mapeo de abajo. La web sólo accede a estos 4 campos.
 */
'use client'

import { useAuth } from '@/contexts/AuthContext'
import type { MaityUser } from '@/types/auth'

export interface UserProfile {
  id: string
  name?: string
  first_name?: string
  last_name?: string
  email?: string
  role?: string
  avatar_url?: string
}

interface UserContextValue {
  userProfile: UserProfile | null
}

/**
 * Mapea MaityUser → UserProfile. Solo extrae campos que la web realmente usa.
 * Si MaityUser tiene otros nombres de campos (ej. first_name + last_name),
 * arma `name` aquí.
 */
function toUserProfile(u: MaityUser | null): UserProfile | null {
  if (!u) return null
  // MaityUser del desktop tipicamente tiene first_name/last_name/email.
  // La web espera name único. Concatena para no perder información.
  const anyU = u as unknown as {
    id: string
    name?: string
    first_name?: string
    last_name?: string
    email?: string
    role?: string
  }
  const composed = [anyU.first_name, anyU.last_name].filter(Boolean).join(' ').trim()
  const name = anyU.name ?? (composed || undefined)
  return {
    id: anyU.id,
    name: name || undefined,
    first_name: anyU.first_name,
    last_name: anyU.last_name,
    email: anyU.email,
    role: anyU.role,
  }
}

export function useUser(): UserContextValue {
  const { maityUser } = useAuth()
  return { userProfile: toUserProfile(maityUser) }
}

// Si algún componente lo necesita como provider explícito, este es no-op:
export function UserProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
