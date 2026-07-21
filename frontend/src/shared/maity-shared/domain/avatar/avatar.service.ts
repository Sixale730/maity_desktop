/**
 * Avatar Service
 * Handles avatar configuration CRUD operations with Supabase
 */

import { supabase } from '../../api/client/supabase';
import type { AvatarConfiguration, UpdateAvatarInput, AccessoryCode } from './avatar.types';
import { DEFAULT_AVATAR_CONFIG } from './avatar.types';

export class AvatarService {
  /**
   * Get avatar configuration for a user
   * Returns null if no avatar is configured
   */
  static async getAvatar(userId: string): Promise<AvatarConfiguration | null> {
    const { data, error } = await supabase.rpc('get_user_avatar', {
      p_user_id: userId,
    });

    if (error) {
      console.error('Error fetching avatar:', error);
      throw error;
    }

    // RPC returns an array, get first item
    if (!data || data.length === 0) {
      return null;
    }

    const row = data[0];
    return {
      ...row,
      accessories: (row.accessories as AccessoryCode[]) || [],
      items: (row.items as string[]) || [],
      full_config: (row.full_config as Record<string, unknown>) || {},
    };
  }

  /**
   * Create or update avatar configuration
   */
  static async upsertAvatar(
    userId: string,
    config: UpdateAvatarInput
  ): Promise<AvatarConfiguration> {
    const { data, error } = await supabase.rpc('upsert_avatar_configuration', {
      p_user_id: userId,
      p_character_preset: config.character_preset || 'human',
      p_outfit_preset: config.outfit_preset || 'casual',
      p_head_type: config.head_type || 'default',
      p_body_type: config.body_type || 'default',
      p_skin_color: config.skin_color || DEFAULT_AVATAR_CONFIG.skin_color,
      p_hair_color: config.hair_color || DEFAULT_AVATAR_CONFIG.hair_color,
      p_shirt_color: config.shirt_color || DEFAULT_AVATAR_CONFIG.shirt_color,
      p_pants_color: config.pants_color || DEFAULT_AVATAR_CONFIG.pants_color,
      p_accessories: config.accessories || [],
      p_items: config.items || [],
      p_full_config: {},
    });

    if (error) {
      console.error('Error saving avatar:', error);
      throw error;
    }

    // RPC returns a single row (not an array)
    return {
      ...data,
      accessories: (data.accessories as AccessoryCode[]) || [],
      items: (data.items as string[]) || [],
      full_config: (data.full_config as Record<string, unknown>) || {},
    };
  }

  /**
   * Get default avatar configuration (for users without custom avatar)
   */
  static getDefaultAvatar(): typeof DEFAULT_AVATAR_CONFIG {
    return { ...DEFAULT_AVATAR_CONFIG };
  }

  /**
   * Check if a user has a custom avatar configured
   */
  static async hasCustomAvatar(userId: string): Promise<boolean> {
    const avatar = await this.getAvatar(userId);
    return avatar !== null;
  }
}
