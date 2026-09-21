// Origen: web Sixale730/maity@3ef2914 packages/shared/src/domain/avatar/animal-avatar.ts
// Copia tal cual (sin adaptaciones). `UpdateAvatarInput` del desktop ganó `full_config?` (aditivo, igual que la web).
import type { AvatarConfiguration, UpdateAvatarInput } from './avatar.types';
import type { LearningPathNode } from '../learning-path/learning-path.types';

export const ANIMALS = [
  { id: 'frog', name: 'Rana', emoji: '🐸' }, { id: 'cat', name: 'Gato', emoji: '🐱' },
  { id: 'dog', name: 'Bulldog', emoji: '🐶' }, { id: 'fox', name: 'Zorro', emoji: '🦊' },
  { id: 'bear', name: 'Oso', emoji: '🐻' }, { id: 'panda', name: 'Panda', emoji: '🐼' },
  { id: 'rabbit', name: 'Conejo', emoji: '🐰' }, { id: 'raccoon', name: 'Mapache', emoji: '🦝' },
  { id: 'penguin', name: 'Pingüino', emoji: '🐧' }, { id: 'axolotl', name: 'Ajolote', emoji: '🩷' },
  { id: 'snake', name: 'Serpiente', emoji: '🐍' },
] as const;
export type AnimalId = typeof ANIMALS[number]['id'];
export const ANIMAL_COLORS = [
  { name: 'Marfil', value: '#ece9e1' }, { name: 'Rosa Maity', value: '#ed176f' },
  { name: 'Azul Maity', value: '#4965e9' }, { name: 'Turquesa', value: '#16a999' },
  { name: 'Lavanda', value: '#aa85d5' }, { name: 'Azul noche', value: '#28364d' },
];
export const MOUNTAIN_BOSSES = [
  { id: 'regateador', name: 'El Regateador', skill: 'Persuasión', mountain: 'Montaña de Fuego' },
  { id: 'niebla', name: 'La Niebla', skill: 'Claridad', mountain: 'Cumbre de la Claridad' },
  { id: 'eco', name: 'El Eco', skill: 'Empatía', mountain: 'Valle de la Escucha' },
  { id: 'caos', name: 'El Caos', skill: 'Estructura', mountain: 'Sierra del Orden' },
  { id: 'rigido', name: 'El Inflexible', skill: 'Adaptación', mountain: 'Pico del Cambio' },
  { id: 'vacio', name: 'El Guardián del Rumbo', skill: 'Propósito', mountain: 'Cumbre del Propósito' },
] as const;
export const bossAsset = (id: typeof MOUNTAIN_BOSSES[number]['id']) => id === 'regateador' ? '/assets/expedition/lava-golem-transparent-v1.webp' : id === 'eco' ? '/assets/expedition/eco-elemental-green-v2.webp' : `/assets/expedition/${id}-elemental-v1.webp`;
export const COSMETIC_REWARDS = [
  { id: 'scarf', name: 'Pañuelo de explorador', requirement: 'Alcanza el nivel 2 · 500 XP', kind: 'level', threshold: 500 },
  { id: 'compass', name: 'Brújula de práctica', requirement: 'Completa 3 desafíos de tu ruta', kind: 'challenge', threshold: 3 },
  { id: 'medal', name: 'Medalla de cumbre', requirement: 'Supera tu primer jefe · primer hito completado', kind: 'boss', threshold: 1 },
  { id: 'helmet', name: 'Casco de expedición', requirement: 'Acumula 1,500 XP', kind: 'level', threshold: 1500 },
  { id: 'harness', name: 'Arnés de ascenso', requirement: 'Completa 6 desafíos de tu ruta', kind: 'challenge', threshold: 6 },
  { id: 'pack', name: 'Mochila de cumbre', requirement: 'Supera 2 jefes de tu ruta', kind: 'boss', threshold: 2 },
  { id: 'rope', name: 'Cuerda de las alturas', requirement: 'Supera 4 jefes de tu ruta', kind: 'boss', threshold: 4 },
] as const;
export type GearId = typeof COSMETIC_REWARDS[number]['id'];
export const CLIMBING_GEAR_IDS: GearId[] = ['helmet', 'harness', 'pack', 'rope'];
export const gearAsset = (id: GearId) => `/assets/avatars/gear-${id === 'scarf' ? 'scarf-v2' : id === 'helmet' ? 'helmet-v4' : id}.webp`;
export interface AnimalDesign { version: 1; animal: AnimalId; shirt: string; pants: string; gear: GearId | null; equipment?: GearId[] }
export const equippedItems = (design: AnimalDesign): GearId[] => [...new Set([...(design.gear ? [design.gear] : []), ...(design.equipment ?? [])])];
export function toggleEquipment(design: AnimalDesign, item: GearId): Partial<AnimalDesign> {
  if (!CLIMBING_GEAR_IDS.includes(item)) return { gear: design.gear === item ? null : item };
  const equipment = design.equipment ?? [];
  return { equipment: equipment.includes(item) ? equipment.filter(id => id !== item) : [...equipment, item] };
}
export const DEFAULT_ANIMAL: AnimalDesign = { version: 1, animal: 'frog', shirt: '#4965e9', pants: '#28364d', gear: null };
export const animalAsset = (id: AnimalId) => `/assets/avatars/${id}-base-v1.webp`;

export function parseAnimalDesign(value: unknown): AnimalDesign | null {
  if (!value || typeof value !== 'object') return null;
  const d = value as Record<string, unknown>;
  if (d.version !== 1 || !ANIMALS.some(a => a.id === d.animal)) return null;
  if (![d.shirt, d.pants].every(c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c))) return null;
  return { version: 1, animal: d.animal as AnimalId, shirt: d.shirt as string, pants: d.pants as string,
    gear: COSMETIC_REWARDS.some(r => r.id === d.gear) ? d.gear as GearId : null,
    ...(Array.isArray(d.equipment) ? { equipment: [...new Set(d.equipment.filter((id): id is GearId => CLIMBING_GEAR_IDS.includes(id as GearId)))] } : {}) };
}
export function buildAnimalUpdate(previous: Partial<AvatarConfiguration>, design: AnimalDesign): UpdateAvatarInput {
  const safe = parseAnimalDesign(design);
  if (!safe) throw new Error('Diseño de personaje inválido');
  return { ...previous, full_config: { ...previous.full_config, animal_avatar: safe } };
}

/** Read-only cosmetics, derived from server progress. Never writes XP or completion. */
export function deriveAdventure(xp: number, nodes: LearningPathNode[]) {
  const checkpoints = [...new Map(nodes.filter(n => n.nodeType === 'checkpoint').map(n => [n.nodeId, n])).values()].sort((a, b) => a.orderIndex - b.orderIndex || a.nodeId.localeCompare(b.nodeId));
  const bosses = MOUNTAIN_BOSSES.map((boss, index) => ({ ...boss, node: checkpoints[index], defeated: checkpoints[index]?.status === 'completed' }));
  const challenges = new Set(nodes.filter(n => ['scenario', 'quiz'].includes(n.nodeType) && n.status === 'completed').map(n => n.nodeId)).size;
  const defeatedCount = bosses.filter(b => b.defeated).length;
  const unlocked = COSMETIC_REWARDS.filter(r => r.kind === 'level' ? Number.isFinite(xp) && xp >= r.threshold : r.kind === 'challenge' ? challenges >= r.threshold : r.id === 'medal' ? bosses[0].defeated : defeatedCount >= r.threshold).map(r => r.id);
  return { bosses, unlocked, challenges, defeatedCount: bosses.filter(b => b.defeated).length };
}
