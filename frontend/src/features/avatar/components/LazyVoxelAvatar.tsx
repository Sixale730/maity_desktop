/**
 * Shim de `@/features/avatar/components/LazyVoxelAvatar`. El desktop no tiene
 * el sistema de voxel avatars. Renderizamos un círculo con iniciales — usado
 * por SidebarFooterV5 para el botón del usuario en el footer del sidebar.
 *
 * Va en `src/features/avatar/components/LazyVoxelAvatar.tsx`.
 */
'use client'

import { useUser } from '@/contexts/UserContext'

interface LazyVoxelAvatarProps {
  config?: unknown   // ignorado — el desktop no maneja config de voxel
  size?: 'xs' | 'sm' | 'md' | 'lg'
  className?: string
}

const SIZE_PX: Record<NonNullable<LazyVoxelAvatarProps['size']>, number> = {
  xs: 24,
  sm: 32,
  md: 40,
  lg: 56,
}

function getInitials(name?: string, email?: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/)
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
    if (parts[0]) return parts[0].slice(0, 2).toUpperCase()
  }
  if (email) return email.slice(0, 2).toUpperCase()
  return '··'
}

export function LazyVoxelAvatar({ size = 'sm', className }: LazyVoxelAvatarProps) {
  const { userProfile } = useUser()
  const px = SIZE_PX[size]
  const initials = getInitials(userProfile?.name, userProfile?.email)
  return (
    <div
      className={className}
      style={{
        width: px,
        height: px,
        borderRadius: 6,
        background: 'linear-gradient(135deg,#485df4,#ff0050)',
        color: '#fff',
        display: 'grid',
        placeItems: 'center',
        fontSize: Math.round(px * 0.38),
        fontWeight: 600,
        flexShrink: 0,
      }}
    >
      {initials}
    </div>
  )
}

export default LazyVoxelAvatar
