/**
 * Avatar Hooks
 * React Query hooks for avatar operations
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AvatarService } from '../avatar.service';
import type { AvatarConfiguration, UpdateAvatarInput } from '../avatar.types';
import { DEFAULT_AVATAR_CONFIG } from '../avatar.types';

// Query keys
export const avatarKeys = {
  all: ['avatar'] as const,
  user: (userId: string) => [...avatarKeys.all, userId] as const,
};

/**
 * Fetch avatar configuration for a user
 */
export function useAvatar(userId: string | undefined) {
  return useQuery({
    queryKey: avatarKeys.user(userId || ''),
    queryFn: () => AvatarService.getAvatar(userId!),
    enabled: !!userId,
    staleTime: 10 * 60 * 1000, // 10 minutes
  });
}

/**
 * Get avatar with fallback to default
 * Returns default config if user has no custom avatar
 */
export function useAvatarWithDefault(userId: string | undefined) {
  const { data, isLoading, error } = useAvatar(userId);

  // Create a partial config from the default or actual data
  const avatarConfig: Partial<AvatarConfiguration> = data || {
    head_type: DEFAULT_AVATAR_CONFIG.head_type,
    body_type: DEFAULT_AVATAR_CONFIG.body_type,
    skin_color: DEFAULT_AVATAR_CONFIG.skin_color,
    hair_color: DEFAULT_AVATAR_CONFIG.hair_color,
    shirt_color: DEFAULT_AVATAR_CONFIG.shirt_color,
    pants_color: DEFAULT_AVATAR_CONFIG.pants_color,
    accessories: DEFAULT_AVATAR_CONFIG.accessories,
  };

  return {
    avatar: avatarConfig,
    isLoading,
    error,
    hasCustomAvatar: !!data,
  };
}

/**
 * Update avatar configuration
 */
export function useUpdateAvatar() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ userId, config }: { userId: string; config: UpdateAvatarInput }) =>
      AvatarService.upsertAvatar(userId, config),
    onSuccess: (data, { userId }) => {
      // Update the cache immediately
      queryClient.setQueryData(avatarKeys.user(userId), data);
      // Invalidate to refetch in background
      queryClient.invalidateQueries({ queryKey: avatarKeys.user(userId) });
    },
  });
}

/**
 * Check if user has a custom avatar
 */
export function useHasCustomAvatar(userId: string | undefined) {
  const { data, isLoading } = useAvatar(userId);
  return {
    hasCustomAvatar: !!data,
    isLoading,
  };
}
