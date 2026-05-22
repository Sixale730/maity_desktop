'use client';

import type { MeetingMinutesDataV2 } from '@/features/conversations/services/conversations.service';
import { MinutaToolbar } from './MinutaToolbar';
import { MinutaHeader } from './MinutaHeader';
import { MinutaTldr } from './MinutaTldr';
import { MinutaChapters } from './MinutaChapters';
import { MinutaDecisiones } from './MinutaDecisiones';
import { MinutaAcciones } from './MinutaAcciones';
import { MinutaSeguimientoSection } from './MinutaSeguimiento';

interface MinutaDashboardV2Props {
  minuta: MeetingMinutesDataV2;
  onJumpToSegment?: (segmentIndex: number) => void;
}

export function MinutaDashboardV2({ minuta, onJumpToSegment }: MinutaDashboardV2Props) {
  return (
    <div className="space-y-6">
      <MinutaToolbar minuta={minuta} />

      <MinutaHeader meta={minuta.meta} />

      <MinutaTldr tldr={minuta.tldr} keywords={minuta.keywords ?? []} />

      <MinutaChapters chapters={minuta.chapters ?? []} onJumpToSegment={onJumpToSegment} />

      <MinutaDecisiones
        decisiones={minuta.decisiones ?? []}
        onJumpToSegment={onJumpToSegment}
      />

      <MinutaAcciones acciones={minuta.acciones ?? []} onJumpToSegment={onJumpToSegment} />

      <MinutaSeguimientoSection seguimiento={minuta.seguimiento} />
    </div>
  );
}
