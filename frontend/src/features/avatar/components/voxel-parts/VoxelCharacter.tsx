/**
 * VoxelCharacter - Character Dispatcher
 * Routes to the appropriate character component based on preset
 * Supports shared items that can be equipped on any character
 */

import { VoxelHuman } from './VoxelHuman';
import {
  VoxelChicken,
  VoxelDog,
  VoxelLionKnight,
  VoxelKnight,
  VoxelRobot,
  VoxelKenneyHuman,
  // Animals
  VoxelCat,
  VoxelPanda,
  VoxelBear,
  VoxelFrog,
  // Fantasy
  VoxelWizard,
  VoxelNinja,
  // Professions
  VoxelChef,
  VoxelScientist,
} from './characters';
import { ItemRenderer, isSharedItem, getItemCategory } from './items';
import type { CharacterPreset, HeadType, BodyType, AccessoryCode, OutfitPreset, ItemCode } from '@maity/shared';
import { getAttachmentPoints } from '@maity/shared';

interface VoxelCharacterProps {
  characterPreset?: CharacterPreset;
  outfitPreset?: OutfitPreset;
  headType?: HeadType;
  bodyType?: BodyType;
  skinColor?: string;
  hairColor?: string;
  shirtColor?: string;
  pantsColor?: string;
  accessories?: AccessoryCode[];
  items?: ItemCode[];
  animate?: boolean;
}

export function VoxelCharacter({
  characterPreset = 'human',
  outfitPreset,
  headType = 'default',
  bodyType = 'default',
  skinColor = '#FFD7C4',
  hairColor = '#3D2314',
  shirtColor = '#4A90D9',
  pantsColor = '#3D3D3D',
  accessories = [],
  items = [],
  animate = false,
}: VoxelCharacterProps) {
  // Get attachment points for this character type
  const attachments = getAttachmentPoints(characterPreset);

  // Filter items to only render shared items (hand/back items)
  // Head/Eyes/Ears/Neck accessories are handled by VoxelAccessories
  const sharedItems = items.filter(isSharedItem);

  // Render items attached to this character
  const renderItems = () => (
    <>
      {sharedItems.map((itemId) => {
        const category = getItemCategory(itemId);
        const attachmentKey = category === 'hand_right' ? 'handRight' :
                              category === 'hand_left' ? 'handLeft' :
                              category;
        const attachmentPoint = attachments[attachmentKey as keyof typeof attachments];

        return (
          <ItemRenderer
            key={itemId}
            itemId={itemId}
            attachmentPoint={attachmentPoint}
          />
        );
      })}
    </>
  );

  // Dispatch to the correct character component based on preset
  switch (characterPreset) {
    case 'chicken':
      return (
        <group>
          <VoxelChicken animate={animate} />
          {renderItems()}
        </group>
      );

    case 'dog':
      return (
        <group>
          <VoxelDog animate={animate} />
          {renderItems()}
        </group>
      );

    case 'lion_knight':
      return (
        <group>
          <VoxelLionKnight animate={animate} />
          {renderItems()}
        </group>
      );

    case 'knight':
      return (
        <group>
          <VoxelKnight animate={animate} />
          {renderItems()}
        </group>
      );

    case 'robot':
      return (
        <group>
          <VoxelRobot animate={animate} />
          {renderItems()}
        </group>
      );

    case 'kenney_human':
      return (
        <group>
          <VoxelKenneyHuman animate={animate} />
          {renderItems()}
        </group>
      );

    // Animals
    case 'cat':
      return (
        <group>
          <VoxelCat animate={animate} />
          {renderItems()}
        </group>
      );

    case 'panda':
      return (
        <group>
          <VoxelPanda animate={animate} />
          {renderItems()}
        </group>
      );

    case 'bear':
      return (
        <group>
          <VoxelBear animate={animate} />
          {renderItems()}
        </group>
      );

    case 'frog':
      return (
        <group>
          <VoxelFrog animate={animate} />
          {renderItems()}
        </group>
      );

    // Fantasy
    case 'wizard':
      return (
        <group>
          <VoxelWizard animate={animate} />
          {renderItems()}
        </group>
      );

    case 'ninja':
      return (
        <group>
          <VoxelNinja animate={animate} />
          {renderItems()}
        </group>
      );

    // Professions
    case 'chef':
      return (
        <group>
          <VoxelChef animate={animate} />
          {renderItems()}
        </group>
      );

    case 'scientist':
      return (
        <group>
          <VoxelScientist animate={animate} />
          {renderItems()}
        </group>
      );

    case 'human':
    default:
      return (
        <group>
          <VoxelHuman
            headType={headType}
            bodyType={bodyType}
            skinColor={skinColor}
            hairColor={hairColor}
            shirtColor={shirtColor}
            pantsColor={pantsColor}
            accessories={accessories}
            outfitPreset={outfitPreset}
            animate={animate}
          />
          {renderItems()}
        </group>
      );
  }
}

export default VoxelCharacter;
