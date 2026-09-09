'use client';

/**
 * Wrapper diferido de `CommunicationTrendChart`: mantiene recharts (~345 KB)
 * fuera del bundle de arranque del home (#24 de la auditoría de recursos).
 * Mismo molde que `registration/page.tsx` y `billing/plans/page.tsx`
 * (`dynamic` + `ssr: false`) y mismo espíritu que `LazyVoxelAvatar`.
 *
 * `ssr: false` además evita el warning de ResponsiveContainer sin ancho en
 * el prerender estático. El fallback ocupa la misma altura mínima que el
 * contenedor (`min-h-[240px]`) para que el Card no salte al cargar.
 */

import dynamic from 'next/dynamic';
import type { CommunicationTrendPoint } from './CommunicationTrendChart';

const CommunicationTrendChart = dynamic(
  () => import('./CommunicationTrendChart').then((m) => ({ default: m.CommunicationTrendChart })),
  {
    ssr: false,
    loading: () => <div className="h-full min-h-[240px] rounded-lg bg-white/5 animate-pulse" />,
  },
);

export type { CommunicationTrendPoint };

export function LazyCommunicationTrendChart({ data }: { data: CommunicationTrendPoint[] }) {
  return <CommunicationTrendChart data={data} />;
}
