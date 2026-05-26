import type { Lens } from '../types';

export interface LensSpec {
  id: Lens;
  /** i18n key for the label (e.g. "chat.lens_ask"). */
  labelKey: string;
  /** Hex color for accent + dot. `null` means "neutral grey" (Abierta). */
  color: string | null;
  /** i18n key for the one-line hint. */
  hintKey: string;
}

/**
 * Catalog of listening lenses. Exposed from a non-component module so that
 * react-refresh fast-refresh on the picker component isn't broken by mixing
 * constants + components in a single file.
 */
export const LENSES: LensSpec[] = [
  { id: 'open', labelKey: 'chat.lens_open', color: null, hintKey: 'chat.lens_open_hint' },
  { id: 'ask', labelKey: 'chat.lens_ask', color: 'hsl(var(--maity-blue))', hintKey: 'chat.lens_ask_hint' },
  { id: 'mirror', labelKey: 'chat.lens_mirror', color: 'hsl(var(--chart-3))', hintKey: 'chat.lens_mirror_hint' },
  { id: 'push', labelKey: 'chat.lens_push', color: 'hsl(var(--primary))', hintKey: 'chat.lens_push_hint' },
  { id: 'sum', labelKey: 'chat.lens_sum', color: 'hsl(var(--maity-warning))', hintKey: 'chat.lens_sum_hint' },
];
