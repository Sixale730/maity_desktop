// Origen: web Sixale730/maity@3ef2914 src/features/dashboard/components/gamified-v2/dashboard-theme-context.ts
// Copia tal cual (sin adaptaciones: no usa hooks de cliente fuera de useContext).
import { createContext, useContext } from 'react';

export type Theme = 'light' | 'dark';
export const ThemeContext = createContext<{ theme: Theme; toggle: () => void } | null>(null);
export function useDashboardTheme() {
  return useContext(ThemeContext)?.theme ?? 'light';
}
