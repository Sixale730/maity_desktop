'use client';
/**
 * STUB desktop de `ExplorerPortrait` (web Sixale730/maity@3ef2914
 * src/features/avatar/components/ExplorerPortrait.tsx).
 *
 * El explorador/avatar animal studio está FUERA de alcance del desktop (decisión
 * de Julio, sep-2026): no se embarcan sus capas ni su CSS. `ExpeditionReward`
 * (copia tal cual) lo importa, así que existe con la misma firma y no pinta
 * nada. El dashboard muestra el retrato 2D (`features/dashboard/adapters/DashboardPortrait`).
 */
import type { ExplorerDesign } from './explorer-design';

export type ExplorerFinish = 'default' | 'gold' | 'crystal';

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- misma firma que la web
export function ExplorerPortrait(_props: { design: ExplorerDesign; finish?: ExplorerFinish }) {
  return null;
}
