'use client';

/**
 * Wrapper diferido de `ProgressChartsSection` (pestaña "Muletillas" del
 * dashboard). `ProgressChartsSection` es copia tal cual de la web y usa
 * `recharts` (~345 KB): NO puede entrar al bundle de arranque del home
 * (#24 de la auditoría de recursos, `scripts/lint-main-bundle.js`).
 * Mismo molde que `features/gamification/components/LazyCommunicationTrendChart`
 * (`next/dynamic`, `ssr: false`). Como Radix `TabsContent` no monta la pestaña
 * inactiva, el chunk se descarga SOLO al abrir "Muletillas".
 *
 * NO importar `./ProgressChartsSection` estático desde nada que llegue al home
 * (lo verifica `features/dashboard/dashboard-guards.test.ts`).
 */

import dynamic from 'next/dynamic';
import type { OmiConversationListItem } from '@/features/omi/services/omi.service';

const ProgressChartsSection = dynamic(
  () => import('./ProgressChartsSection').then((m) => ({ default: m.ProgressChartsSection })),
  {
    ssr: false,
    loading: () => <div className="h-full min-h-[240px] rounded-lg bg-muted animate-pulse" />,
  },
);

export function LazyProgressChartsSection({ conversations }: { conversations: OmiConversationListItem[] }) {
  return <ProgressChartsSection conversations={conversations} />;
}
