/**
 * Avatar Types for the Voxel Avatar System
 * Crossy Road style 3D avatars with customizable parts and colors
 */

// ===== Character Presets =====

export type CharacterPreset =
  | 'human' | 'chicken' | 'dog' | 'lion_knight' | 'knight' | 'robot' | 'kenney_human'
  // New animals
  | 'cat' | 'panda' | 'bear' | 'frog'
  // Fantasy
  | 'wizard' | 'ninja'
  // Professions
  | 'chef' | 'scientist';

// ===== Character Sources =====

export type CharacterSource = 'maity' | 'opengameart' | 'kenney';

export interface CharacterSourceConfig {
  name: string;
  description: string;
}

export const CHARACTER_SOURCES: Record<CharacterSource, CharacterSourceConfig> = {
  maity: { name: 'Maity Original', description: 'Personajes originales de Maity' },
  opengameart: { name: 'OpenGameArt', description: 'Modelos de la comunidad' },
  kenney: { name: 'Kenney.nl', description: 'Assets CC0 de Kenney' },
};

export interface PresetCharacterConfig {
  id: CharacterPreset;
  name: string;
  emoji: string;
  source: CharacterSource;
  customizable?: boolean;
}

export const PRESET_CHARACTERS: PresetCharacterConfig[] = [
  // Maity Original
  { id: 'human', name: 'Humano', emoji: '👤', source: 'maity', customizable: true },
  { id: 'chicken', name: 'Pollo', emoji: '🐔', source: 'maity' },
  { id: 'dog', name: 'Perro', emoji: '🐶', source: 'maity' },
  { id: 'lion_knight', name: 'León Caballero', emoji: '🦁', source: 'maity' },
  // Animals
  { id: 'cat', name: 'Gato', emoji: '🐱', source: 'maity' },
  { id: 'panda', name: 'Panda', emoji: '🐼', source: 'maity' },
  { id: 'bear', name: 'Oso', emoji: '🐻', source: 'maity' },
  { id: 'frog', name: 'Rana', emoji: '🐸', source: 'maity' },
  // Fantasy
  { id: 'wizard', name: 'Mago', emoji: '🧙', source: 'maity' },
  { id: 'ninja', name: 'Ninja', emoji: '🥷', source: 'maity' },
  // Professions
  { id: 'chef', name: 'Chef', emoji: '👨‍🍳', source: 'maity' },
  { id: 'scientist', name: 'Científico', emoji: '🔬', source: 'maity' },
  // OpenGameArt
  { id: 'knight', name: 'Caballero', emoji: '⚔️', source: 'opengameart' },
  { id: 'robot', name: 'Robot', emoji: '🤖', source: 'opengameart' },
  // Kenney
  { id: 'kenney_human', name: 'Humano Kenney', emoji: '🧑', source: 'kenney' },
];

// ===== Part Types (for human customization) =====

export type HeadType = 'default' | 'round' | 'square' | 'tall';
export type BodyType = 'default' | 'slim' | 'athletic' | 'casual';

// ===== Outfit Presets =====

export type OutfitPreset = 'casual' | 'business' | 'worker' | 'formal' | 'sporty';

export interface OutfitConfig {
  id: OutfitPreset;
  name: string;
  emoji: string;
  shirtColor: string;
  pantsColor: string;
  hasTie?: boolean;
  tieColor?: string;
}

export const OUTFIT_PRESETS: OutfitConfig[] = [
  {
    id: 'casual',
    name: 'Casual',
    emoji: '👕',
    shirtColor: '#4A90D9',
    pantsColor: '#3D3D3D',
  },
  {
    id: 'business',
    name: 'Ejecutivo',
    emoji: '👔',
    shirtColor: '#1A1A2E',
    pantsColor: '#1A1A2E',
    hasTie: true,
    tieColor: '#DC2626',
  },
  {
    id: 'worker',
    name: 'Trabajador',
    emoji: '🧑‍🔧',
    shirtColor: '#F97316',
    pantsColor: '#F97316',
  },
  {
    id: 'formal',
    name: 'Formal',
    emoji: '👗',
    shirtColor: '#9333EA',
    pantsColor: '#9333EA',
  },
  {
    id: 'sporty',
    name: 'Deportivo',
    emoji: '🏃',
    shirtColor: '#EF4444',
    pantsColor: '#1F2937',
  },
];

export type AccessoryCode =
  | 'glasses_round'
  | 'glasses_square'
  | 'hat_cap'
  | 'hat_beanie'
  | 'headphones'
  | 'bowtie'
  | 'necklace';

// Re-export ItemCode for convenience
export type { ItemCode } from './items.types';

// ===== Database Types =====

export interface AvatarConfiguration {
  id: string;
  user_id: string;
  character_preset: CharacterPreset;
  outfit_preset: OutfitPreset;
  head_type: HeadType;
  body_type: BodyType;
  skin_color: string;
  hair_color: string;
  shirt_color: string;
  pants_color: string;
  accessories: AccessoryCode[];
  items: string[];  // ItemCode[] - shared items (sword, shield, cape, etc.)
  full_config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface UpdateAvatarInput {
  character_preset?: CharacterPreset;
  outfit_preset?: OutfitPreset;
  head_type?: HeadType;
  body_type?: BodyType;
  skin_color?: string;
  hair_color?: string;
  shirt_color?: string;
  pants_color?: string;
  accessories?: AccessoryCode[];
  items?: string[];  // ItemCode[]
}

// ===== Display Types =====

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface AvatarColors {
  skin: string;
  hair: string;
  shirt: string;
  pants: string;
}

// ===== Default Values =====

export const DEFAULT_AVATAR_CONFIG: Omit<AvatarConfiguration, 'id' | 'user_id' | 'created_at' | 'updated_at'> = {
  character_preset: 'human',
  outfit_preset: 'casual',
  head_type: 'default',
  body_type: 'default',
  skin_color: '#FFD7C4',
  hair_color: '#3D2314',
  shirt_color: '#4A90D9', // From casual outfit
  pants_color: '#3D3D3D', // From casual outfit
  accessories: [],
  items: [],  // Shared items (sword, shield, cape, etc.)
  full_config: {},
};

// ===== Color Presets =====

export const SKIN_COLORS = [
  '#FFE4C4', // Light
  '#FFD7C4', // Default
  '#F5D0A9', // Fair
  '#D2A679', // Medium
  '#C4A484', // Tan
  '#8D5524', // Brown
  '#6B4423', // Dark Brown
  '#3D2314', // Deep
];

export const HAIR_COLORS = [
  '#3D2314', // Dark Brown (default)
  '#5C4033', // Brown
  '#000000', // Black
  '#4A3728', // Chocolate
  '#8B4513', // Saddle Brown
  '#D2691E', // Cocoa
  '#FFD700', // Blonde
  '#B8860B', // Dark Blonde
  '#FF6347', // Red/Ginger
  '#8B008B', // Purple
  '#4169E1', // Blue
  '#228B22', // Green
];

export const MAITY_PRESET_COLORS = [
  '#485df4', // Primary blue
  '#1bea9a', // Primary green
  '#ff0050', // Accent pink
  '#ffd93d', // Yellow
  '#9b4dca', // Purple
  '#ff8c42', // Orange
  '#ef4444', // Red
  '#1A1A2E', // Dark
  '#374151', // Gray
  '#ffffff', // White
];

// ===== Part Options =====

export const HEAD_TYPE_OPTIONS: { value: HeadType; label: string }[] = [
  { value: 'default', label: 'Normal' },
  { value: 'round', label: 'Redonda' },
  { value: 'square', label: 'Cuadrada' },
  { value: 'tall', label: 'Alta' },
];

export const BODY_TYPE_OPTIONS: { value: BodyType; label: string }[] = [
  { value: 'default', label: 'Normal' },
  { value: 'slim', label: 'Delgado' },
  { value: 'athletic', label: 'Atletico' },
  { value: 'casual', label: 'Casual' },
];

export const ACCESSORY_OPTIONS: { value: AccessoryCode; label: string; emoji: string }[] = [
  { value: 'glasses_round', label: 'Lentes Redondos', emoji: '👓' },
  { value: 'glasses_square', label: 'Lentes Cuadrados', emoji: '🕶️' },
  { value: 'hat_cap', label: 'Gorra', emoji: '🧢' },
  { value: 'hat_beanie', label: 'Gorro', emoji: '🎓' },
  { value: 'headphones', label: 'Audifonos', emoji: '🎧' },
  { value: 'bowtie', label: 'Corbatin', emoji: '🎀' },
  { value: 'necklace', label: 'Collar', emoji: '📿' },
];

// ===== Size Config =====

export const AVATAR_SIZE_CONFIG: Record<AvatarSize, { width: number; height: number; cameraZ: number }> = {
  xs: { width: 32, height: 32, cameraZ: 6 },
  sm: { width: 48, height: 48, cameraZ: 5.5 },
  md: { width: 80, height: 80, cameraZ: 5 },
  lg: { width: 150, height: 150, cameraZ: 4.5 },
  xl: { width: 300, height: 300, cameraZ: 4 },
};
