/**
 * Shim de `@/shared/components/AdminViewRoleSelector`. El desktop no tiene el
 * sistema de view-role (admin previewing as user/manager). Renderizamos null
 * para que el SidebarFooterV5 lo pueda incluir sin romper.
 *
 * Va en `src/shared/components/AdminViewRoleSelector.tsx`.
 */
'use client'

export function AdminViewRoleSelector() {
  return null
}

export default AdminViewRoleSelector
