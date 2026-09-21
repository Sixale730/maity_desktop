// Origen: web Sixale730/maity@3ef2914 src/features/avatar/components/explorer-design.ts
// Copia tal cual (sin adaptaciones). Lo usa el dashboard de expedición (activeExplorer).
import type { AvatarConfiguration } from '@maity/shared';

export const EXPLORER_COLORS = [
  { id: 'pink', name: 'Rosa', hex: '#ed268a', hue: 0 },
  { id: 'cyan', name: 'Turquesa', hex: '#00cbd5', hue: 225 },
  { id: 'blue', name: 'Azul', hex: '#4976ee', hue: 285 },
  { id: 'violet', name: 'Violeta', hex: '#a66bea', hue: 325 },
  { id: 'amber', name: 'Ámbar', hex: '#ffbd35', hue: 95 },
  { id: 'coral', name: 'Coral', hex: '#ff705b', hue: 45 },
  { id: 'lime', name: 'Lima', hex: '#a9de46', hue: 145 },
  { id: 'green', name: 'Esmeralda', hex: '#24bd85', hue: 185 },
  { id: 'indigo', name: 'Índigo', hex: '#6964ee', hue: 305 },
] as const;
export const EXPLORER_CLOTHES = [
  { id: 'ivory', name: 'Marfil', hex: '#ffffff' },
  { id: 'sky', name: 'Cielo', hex: '#b9d9f1' },
  { id: 'lavender', name: 'Lavanda', hex: '#dac4ec' },
  { id: 'mint', name: 'Menta', hex: '#b7e5d5' },
  { id: 'rose', name: 'Rosado', hex: '#f2bfd8' },
  { id: 'sand', name: 'Arena', hex: '#e8d2ae' },
  { id: 'peach', name: 'Durazno', hex: '#f3c3ad' },
  { id: 'sage', name: 'Salvia', hex: '#a4bda7' },
  { id: 'navy', name: 'Marino', hex: '#526183' },
  { id: 'slate', name: 'Pizarra', hex: '#77838e' },
] as const;
export const EXPLORER_EYES = ['neutral', 'happy', 'focused', 'curious', 'angry', 'wink', 'surprised', 'calm'] as const;
export type ExplorerDesign = { version: 1; visor: typeof EXPLORER_COLORS[number]['id']; shoes: typeof EXPLORER_COLORS[number]['id']; clothes: typeof EXPLORER_CLOTHES[number]['id']; eyes: typeof EXPLORER_EYES[number]; animate?: boolean };
export const DEFAULT_EXPLORER: ExplorerDesign = { version: 1, visor: 'pink', shoes: 'pink', clothes: 'ivory', eyes: 'neutral', animate: true };
export function parseExplorer(value: unknown): ExplorerDesign | null {
  if (!value || typeof value !== 'object') return null;
  const d = value as ExplorerDesign;
  if (d.version !== 1 || !EXPLORER_COLORS.some(c => c.id === d.visor) || !EXPLORER_COLORS.some(c => c.id === d.shoes) || !EXPLORER_CLOTHES.some(c => c.id === d.clothes) || !EXPLORER_EYES.includes(d.eyes)) return null;
  if (d.animate !== undefined && typeof d.animate !== 'boolean') return null;
  return { version: 1, animate: d.animate ?? true, visor: d.visor, shoes: d.shoes, clothes: d.clothes, eyes: d.eyes };
}
export function explorerUpdate(previous: Partial<AvatarConfiguration>, design: ExplorerDesign) {
  const safe = parseExplorer(design);
  if (!safe) throw new Error('Diseño no válido');
  return { ...previous, full_config: { ...previous.full_config, active_avatar: 'explorer', explorer_avatar: safe } };
}
export function activeExplorer(config: Partial<AvatarConfiguration>) {
  return config.full_config?.active_avatar === 'explorer' ? parseExplorer(config.full_config.explorer_avatar) : null;
}
