/**
 * LazyVoxelAvatar Component
 *
 * Lazy-loaded wrapper for VoxelAvatar that defers Three.js loading.
 * Use this in layout components (sidebar, navigation) to keep
 * vendor-3d (~904 KB) out of the critical rendering path.
 */

import { lazy, Suspense } from 'react';
import type { AvatarConfiguration, AvatarSize } from '@maity/shared';

const VoxelAvatar = lazy(() =>
  import('./VoxelAvatar').then((m) => ({ default: m.VoxelAvatar }))
);

const SIZE_MAP: Record<AvatarSize, number> = {
  xs: 32,
  sm: 48,
  md: 80,
  lg: 150,
  xl: 300,
};

interface LazyVoxelAvatarProps {
  config: Partial<AvatarConfiguration>;
  size?: AvatarSize;
  className?: string;
  enableRotation?: boolean;
  autoRotate?: boolean;
  enableZoom?: boolean;
  showPedestal?: boolean;
  animate?: boolean;
}

export function LazyVoxelAvatar({ size = 'md', className = '', ...props }: LazyVoxelAvatarProps) {
  const dim = SIZE_MAP[size];

  return (
    <Suspense
      fallback={
        <div
          className={`bg-muted rounded-lg animate-pulse ${className}`}
          style={{ width: dim, height: dim }}
        />
      }
    >
      <VoxelAvatar size={size} className={className} {...props} />
    </Suspense>
  );
}
