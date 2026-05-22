'use client';

import { Card } from '@/components/ui/card';
import { CalendarClock, ClipboardList, Mail, ListTodo } from 'lucide-react';
import type { MinutaV2Seguimiento } from '@/features/conversations/services/conversations.service';
import type { ReactNode } from 'react';

interface MinutaSeguimientoProps {
  seguimiento: MinutaV2Seguimiento | null;
}

export function MinutaSeguimientoSection({ seguimiento }: MinutaSeguimientoProps) {
  if (!seguimiento) return null;

  const { proxima_reunion, agenda_preliminar, preparacion_requerida, distribucion } = seguimiento;
  const proximaText = formatProximaReunion(proxima_reunion);
  const hasAgenda = agenda_preliminar && agenda_preliminar.length > 0;
  const hasPrep = preparacion_requerida && preparacion_requerida.length > 0;
  const hasDist = distribucion && distribucion.length > 0;

  if (!proximaText && !hasAgenda && !hasPrep && !hasDist) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-xs uppercase tracking-wider text-gray-500 px-1">Seguimiento</h2>

      <Card className="bg-card border border-white/10 p-4 space-y-3">
        {proximaText && (
          <FollowupRow icon={<CalendarClock className="h-4 w-4" />} label="Próxima reunión">
            {proximaText}
          </FollowupRow>
        )}
        {hasAgenda && (
          <FollowupRow icon={<ListTodo className="h-4 w-4" />} label="Agenda sugerida">
            <ul className="space-y-0.5">
              {agenda_preliminar.map((a, i) => (
                <li key={i}>· {a}</li>
              ))}
            </ul>
          </FollowupRow>
        )}
        {hasPrep && (
          <FollowupRow icon={<ClipboardList className="h-4 w-4" />} label="Preparación">
            <ul className="space-y-0.5">
              {preparacion_requerida.map((p, i) => (
                <li key={i}>
                  <span className="text-gray-300">{p.participante}:</span>{' '}
                  <span className="text-gray-400">{p.preparacion}</span>
                </li>
              ))}
            </ul>
          </FollowupRow>
        )}
        {hasDist && (
          <FollowupRow icon={<Mail className="h-4 w-4" />} label="Distribución">
            {distribucion.join(', ')}
          </FollowupRow>
        )}
      </Card>
    </section>
  );
}

function FollowupRow({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex gap-3 text-sm">
      <span className="text-gray-500 mt-0.5 shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-xs uppercase tracking-wide text-gray-500 mb-0.5">{label}</div>
        <div className="text-gray-300 text-sm">{children}</div>
      </div>
    </div>
  );
}

function formatProximaReunion(
  pr: MinutaV2Seguimiento['proxima_reunion']
): string | null {
  if (!pr) return null;
  const parts = [pr.fecha, pr.hora, pr.proposito ? `— ${pr.proposito}` : null].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
}
