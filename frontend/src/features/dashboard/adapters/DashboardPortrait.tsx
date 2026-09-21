'use client';
/**
 * Retrato 2D del dashboard — reemplaza a `VoxelAvatar` (three.js) en los archivos
 * copiados de la web (`ExpeditionPilot`). Mismas props que `VoxelAvatar`
 * (`config`, `size`, `scene`) para que el copiado solo cambie el import:
 *
 *   import { DashboardPortrait as VoxelAvatar } from '@/features/dashboard/adapters/DashboardPortrait';
 *
 * POR QUÉ: three.js / @react-three NO entran al arranque de la home (#24 de la
 * auditoría de recursos, `scripts/lint-main-bundle.js`) y el avatar animal
 * studio está fuera de alcance del desktop. Pinta las iniciales del usuario
 * (`LetterAvatar`, el mismo del dashboard anterior) dentro de un anillo de marca;
 * llena el contenedor que le dé el CSS (`.expedition-avatar>div{width:100%;height:100%}`).
 */
import type { AvatarConfiguration, AvatarSize } from '@maity/shared';
import { useUser } from '@/contexts/UserContext';

const TEXT_SIZE: Record<AvatarSize, string> = {
  xs: 'text-[10px]',
  sm: 'text-xs',
  md: 'text-lg',
  lg: 'text-3xl',
  xl: 'text-4xl',
};

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

/** Avatar de iniciales (del dashboard anterior de gamificación). */
export function LetterAvatar({ name, size = 'md' }: { name: string; size?: AvatarSize }) {
  return (
    <div className="w-full h-full rounded-full bg-gradient-to-br from-maity-blue to-[#9b4dca] flex items-center justify-center">
      <span className={`${TEXT_SIZE[size]} font-bold text-white select-none`}>{initialsOf(name) || '?'}</span>
    </div>
  );
}

export interface DashboardPortraitProps {
  /** Aceptado por compatibilidad con `VoxelAvatar`; el retrato 2D no lo usa. */
  config?: Partial<AvatarConfiguration>;
  size?: AvatarSize;
  /** `scene` en la web dibuja el escenario 3D; aquí solo añade el anillo de marca. */
  scene?: boolean;
  /** Nombre a mostrar; por defecto el del usuario con sesión (maityUser). */
  name?: string;
}

export function DashboardPortrait({ size = 'md', scene = false, name }: DashboardPortraitProps) {
  const { userProfile } = useUser();
  const displayName = name ?? userProfile?.name ?? userProfile?.first_name ?? '';
  return (
    <div
      className={`dashboard-portrait w-full h-full aspect-square rounded-full ${scene ? 'p-1 bg-gradient-to-br from-primary to-maity-blue shadow-lg' : ''}`}
      role="img"
      aria-label={displayName ? `Retrato de ${displayName}` : 'Tu retrato'}
    >
      <LetterAvatar name={displayName} size={size} />
    </div>
  );
}
