/**
 * OnboardingAvatarStep Component
 * Simplified avatar editor for the onboarding flow
 * Medium customization: character, outfit, skin color, hair color
 */

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/ui/components/ui/button';
import { Loader2, ArrowRight } from 'lucide-react';
import { VoxelAvatar } from '@/features/avatar/components/VoxelAvatar';
import { CharacterSelector } from '@/features/avatar/components/CharacterSelector';
import { OutfitSelector } from '@/features/avatar/components/OutfitSelector';
import { ColorPicker } from '@/features/avatar/components/ColorPicker';
import {
  AvatarService,
  DEFAULT_AVATAR_CONFIG,
  SKIN_COLORS,
  HAIR_COLORS,
  OUTFIT_PRESETS,
} from '@maity/shared';
import type {
  CharacterPreset,
  OutfitPreset,
  UpdateAvatarInput,
} from '@maity/shared';

interface OnboardingAvatarStepProps {
  userId: string;
  onComplete: () => void;
  preview?: boolean;
}

export function OnboardingAvatarStep({ userId, onComplete, preview }: OnboardingAvatarStepProps) {
  const [isSaving, setIsSaving] = useState(false);
  // Derive initial loading from the `preview` prop (computable during render) so
  // preview mode never flashes a loading state — React "You Might Not Need an Effect".
  const [isLoading, setIsLoading] = useState(!preview);

  // Avatar configuration state
  const [characterPreset, setCharacterPreset] = useState<CharacterPreset>(
    DEFAULT_AVATAR_CONFIG.character_preset
  );
  const [outfitPreset, setOutfitPreset] = useState<OutfitPreset>(
    DEFAULT_AVATAR_CONFIG.outfit_preset
  );
  const [skinColor, setSkinColor] = useState(DEFAULT_AVATAR_CONFIG.skin_color);
  const [hairColor, setHairColor] = useState(DEFAULT_AVATAR_CONFIG.hair_color);

  // Derived shirt/pants colors from outfit preset
  const currentOutfit = OUTFIT_PRESETS.find((o) => o.id === outfitPreset);
  const shirtColor = currentOutfit?.shirtColor || DEFAULT_AVATAR_CONFIG.shirt_color;
  const pantsColor = currentOutfit?.pantsColor || DEFAULT_AVATAR_CONFIG.pants_color;

  // Is customizable (only humans can customize appearance)
  const isHuman = characterPreset === 'human';

  // Build config for preview
  const previewConfig = {
    character_preset: characterPreset,
    outfit_preset: outfitPreset,
    head_type: DEFAULT_AVATAR_CONFIG.head_type,
    body_type: DEFAULT_AVATAR_CONFIG.body_type,
    skin_color: skinColor,
    hair_color: hairColor,
    shirt_color: shirtColor,
    pants_color: pantsColor,
    accessories: [],
  };

  // Load existing avatar on mount (skip in preview mode)
  useEffect(() => {
    if (preview) return;

    const loadExistingAvatar = async () => {
      try {
        const existing = await AvatarService.getAvatar(userId);
        if (existing) {
          console.log('[OnboardingAvatarStep] Loaded existing avatar:', existing);
          setCharacterPreset(existing.character_preset);
          setOutfitPreset(existing.outfit_preset);
          setSkinColor(existing.skin_color);
          setHairColor(existing.hair_color);
        }
      } catch (error) {
        console.error('[OnboardingAvatarStep] Error loading avatar:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadExistingAvatar();
  }, [userId, preview]);

  // Handle save and continue
  const handleContinue = async () => {
    if (preview) {
      onComplete();
      return;
    }

    setIsSaving(true);

    try {
      const input: UpdateAvatarInput = {
        character_preset: characterPreset,
        outfit_preset: outfitPreset,
        head_type: DEFAULT_AVATAR_CONFIG.head_type,
        body_type: DEFAULT_AVATAR_CONFIG.body_type,
        skin_color: skinColor,
        hair_color: hairColor,
        shirt_color: shirtColor,
        pants_color: pantsColor,
        accessories: [],
      };

      await AvatarService.upsertAvatar(userId, input);
      console.log('[OnboardingAvatarStep] Avatar saved successfully');
      onComplete();
    } catch (error) {
      console.error('[OnboardingAvatarStep] Error saving avatar:', error);
      // Still continue even on error - avatar creation shouldn't block onboarding
      onComplete();
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
        <p className="text-muted-foreground">Cargando...</p>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.3 }}
      className="w-full space-y-6"
    >
      {/* Header */}
      <div className="text-center space-y-2">
        <h2 className="text-2xl sm:text-3xl font-bold">Crea tu Avatar</h2>
        <p className="text-muted-foreground">
          Personaliza tu personaje para representarte en Maity
        </p>
      </div>

      {/* Avatar Preview */}
      <div className="flex justify-center py-4">
        <div className="bg-gradient-to-b from-muted/50 to-muted rounded-2xl p-4">
          <VoxelAvatar
            config={previewConfig}
            size="lg"
            enableRotation
            autoRotate
            animate
          />
        </div>
      </div>

      {/* Customization Options */}
      <div className="space-y-6">
        {/* Character Selector */}
        <CharacterSelector
          selected={characterPreset}
          onChange={setCharacterPreset}
        />

        {/* Only show outfit and colors for human */}
        {isHuman && (
          <>
            {/* Outfit Selector */}
            <OutfitSelector
              selected={outfitPreset}
              onChange={setOutfitPreset}
            />

            {/* Color Pickers Row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <ColorPicker
                label="Color de Piel"
                colors={SKIN_COLORS}
                value={skinColor}
                onChange={setSkinColor}
              />
              <ColorPicker
                label="Color de Cabello"
                colors={HAIR_COLORS}
                value={hairColor}
                onChange={setHairColor}
              />
            </div>
          </>
        )}

        {/* Non-human message */}
        {!isHuman && (
          <div className="text-center py-4">
            <p className="text-sm text-muted-foreground">
              Los personajes predefinidos tienen un estilo fijo y no se pueden personalizar.
            </p>
          </div>
        )}
      </div>

      {/* Continue Button */}
      <div className="flex justify-center pt-4">
        <Button
          onClick={handleContinue}
          disabled={isSaving}
          size="lg"
          className="w-full sm:w-auto px-8 bg-accent hover:bg-accent/90 text-black font-semibold"
        >
          {isSaving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Guardando...
            </>
          ) : (
            <>
              Continuar
              <ArrowRight className="ml-2 h-4 w-4" />
            </>
          )}
        </Button>
      </div>
    </motion.div>
  );
}
