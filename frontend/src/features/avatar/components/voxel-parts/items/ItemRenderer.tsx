/**
 * ItemRenderer - Dispatches and positions items on characters
 * Routes to the correct item component based on itemId
 */

import type { ItemCode, ItemCategory } from '@maity/shared';
import type { AttachmentPoint } from '@maity/shared';
// Existing items
import { Sword } from './Sword';
import { Shield } from './Shield';
import { Wand } from './Wand';
import { Spatula } from './Spatula';
import { Hammer } from './Hammer';
import { Axe } from './Axe';
import { Book } from './Book';
import { Cape } from './Cape';
// New weapons
import { Bow } from './Bow';
import { Staff } from './Staff';
import { Dagger } from './Dagger';
import { Spear } from './Spear';
// New tools
import { Pickaxe } from './Pickaxe';
import { Shovel } from './Shovel';
import { Wrench } from './Wrench';
// New magical items
import { Orb } from './Orb';
import { Potion } from './Potion';
import { Crystal } from './Crystal';
// New back items
import { Backpack } from './Backpack';
import { Wings } from './Wings';

interface ItemRendererProps {
  itemId: ItemCode;
  attachmentPoint: AttachmentPoint;
}

// Map item codes to their categories for attachment point selection
const ITEM_TO_CATEGORY: Record<ItemCode, ItemCategory> = {
  // Head
  hat_cap: 'head',
  hat_beanie: 'head',
  // Eyes
  glasses_round: 'eyes',
  glasses_square: 'eyes',
  // Ears
  headphones: 'ears',
  // Neck
  bowtie: 'neck',
  necklace: 'neck',
  // Hand right - existing
  sword: 'hand_right',
  wand: 'hand_right',
  spatula: 'hand_right',
  hammer: 'hand_right',
  axe: 'hand_right',
  // Hand right - new weapons
  bow: 'hand_right',
  staff: 'hand_right',
  dagger: 'hand_right',
  spear: 'hand_right',
  // Hand right - new tools
  pickaxe: 'hand_right',
  shovel: 'hand_right',
  wrench: 'hand_right',
  // Hand left - existing
  shield: 'hand_left',
  book: 'hand_left',
  // Hand left - new magical
  orb: 'hand_left',
  potion: 'hand_left',
  crystal: 'hand_left',
  // Back
  cape: 'back',
  backpack: 'back',
  wings: 'back',
};

// Item-specific rotation adjustments (in degrees) [X, Y, Z]
// Y-axis: diagonal forward, Z-axis: negative = tilted down (resting pose)
const ITEM_ROTATIONS: Partial<Record<ItemCode, [number, number, number]>> = {
  // Right hand - weapons (resting at side, tilted down)
  sword: [0, 25, -30],     // Diagonal, resting down
  wand: [0, 20, -20],      // Tilted down
  hammer: [0, 25, -35],    // Head down, resting
  axe: [0, 25, -35],       // Head down, resting
  bow: [0, 30, -20],       // Resting at side
  staff: [0, 15, -15],     // Nearly vertical, slight tilt
  dagger: [0, 25, -25],    // Tilted down
  spear: [0, 20, -25],     // Tilted down
  // Right hand - tools (resting pose)
  spatula: [0, 25, -25],   // Tilted down
  pickaxe: [0, 25, -35],   // Head down
  shovel: [0, 25, -30],    // Tilted down
  wrench: [0, 25, -25],    // Tilted down
  // Left hand - keep facing forward
  shield: [0, 90, 0],      // Face forward
  book: [0, 90, 0],        // Face forward
  orb: [0, 0, 0],          // Floating level
  potion: [0, 0, 0],       // Upright
  crystal: [0, 0, 0],      // Upright
  // Back items
  cape: [0, 0, 0],         // No rotation
  backpack: [0, 0, 0],     // Flat on back
  wings: [0, 0, 0],        // Spread out
};

export function ItemRenderer({ itemId, attachmentPoint }: ItemRendererProps) {
  const position: [number, number, number] = [
    attachmentPoint.x,
    attachmentPoint.y,
    attachmentPoint.z,
  ];

  const baseRotation: [number, number, number] = [
    attachmentPoint.rotationX || 0,
    attachmentPoint.rotationY || 0,
    attachmentPoint.rotationZ || 0,
  ];

  // Add item-specific rotation
  const itemRotation = ITEM_ROTATIONS[itemId] || [0, 0, 0];
  const finalRotation: [number, number, number] = [
    baseRotation[0] + itemRotation[0],
    baseRotation[1] + itemRotation[1],
    baseRotation[2] + itemRotation[2],
  ];

  const scale = attachmentPoint.scale || 1;

  // Dispatch to correct item component
  switch (itemId) {
    // Hand right items - existing
    case 'sword':
      return <Sword position={position} rotation={finalRotation} scale={scale} />;
    case 'wand':
      return <Wand position={position} rotation={finalRotation} scale={scale} />;
    case 'spatula':
      return <Spatula position={position} rotation={finalRotation} scale={scale} />;
    case 'hammer':
      return <Hammer position={position} rotation={finalRotation} scale={scale} />;
    case 'axe':
      return <Axe position={position} rotation={finalRotation} scale={scale} />;

    // Hand right items - new weapons
    case 'bow':
      return <Bow position={position} rotation={finalRotation} scale={scale} />;
    case 'staff':
      return <Staff position={position} rotation={finalRotation} scale={scale} />;
    case 'dagger':
      return <Dagger position={position} rotation={finalRotation} scale={scale} />;
    case 'spear':
      return <Spear position={position} rotation={finalRotation} scale={scale} />;

    // Hand right items - new tools
    case 'pickaxe':
      return <Pickaxe position={position} rotation={finalRotation} scale={scale} />;
    case 'shovel':
      return <Shovel position={position} rotation={finalRotation} scale={scale} />;
    case 'wrench':
      return <Wrench position={position} rotation={finalRotation} scale={scale} />;

    // Hand left items - existing
    case 'shield':
      return <Shield position={position} rotation={finalRotation} scale={scale} />;
    case 'book':
      return <Book position={position} rotation={finalRotation} scale={scale} />;

    // Hand left items - new magical
    case 'orb':
      return <Orb position={position} rotation={finalRotation} scale={scale} />;
    case 'potion':
      return <Potion position={position} rotation={finalRotation} scale={scale} />;
    case 'crystal':
      return <Crystal position={position} rotation={finalRotation} scale={scale} />;

    // Back items
    case 'cape':
      return <Cape position={position} rotation={finalRotation} scale={scale} />;
    case 'backpack':
      return <Backpack position={position} rotation={finalRotation} scale={scale} />;
    case 'wings':
      return <Wings position={position} rotation={finalRotation} scale={scale} />;

    // Head/Eyes/Ears/Neck items are handled by VoxelAccessories
    // Return null for items not handled here
    default:
      return null;
  }
}

export default ItemRenderer;

export function getItemCategory(itemId: ItemCode): ItemCategory {
  return ITEM_TO_CATEGORY[itemId];
}

// Helper to check if item is a new shared item (not accessory)
export function isSharedItem(itemId: ItemCode): boolean {
  const category = ITEM_TO_CATEGORY[itemId];
  return category === 'hand_right' || category === 'hand_left' || category === 'back';
}
