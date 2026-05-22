'use client';

import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Calendar, ExternalLink, User } from 'lucide-react';
import type { MinutaV2Accion } from '@/features/conversations/services/conversations.service';

interface MinutaAccionesProps {
  acciones: MinutaV2Accion[];
  onJumpToSegment?: (segmentIndex: number) => void;
}

const FALTA_LABELS: Record<string, string> = {
  'dueño': 'responsable',
  'fecha': 'fecha',
};

const PRIORITY_LABELS: Record<string, string> = {
  alta: 'Alta',
  media: 'Media',
  baja: 'Baja',
};

export function MinutaAcciones({ acciones, onJumpToSegment }: MinutaAccionesProps) {
  if (!acciones || acciones.length === 0) return null;

  const incompletas = acciones.filter((a) => !a.completa).length;

  return (
    <section className="space-y-3">
      <h2 className="text-xs uppercase tracking-wider text-gray-500 px-1 flex items-center gap-2">
        <span>
          Acciones{' '}
          <span className="text-gray-600 normal-case font-normal">({acciones.length})</span>
        </span>
        {incompletas > 0 && (
          <span className="text-amber-400/80 normal-case font-normal text-[10px] tracking-normal">
            · {incompletas} incompletas
          </span>
        )}
      </h2>

      <div className="space-y-2">
        {acciones.map((a) => (
          <Card
            key={a.id}
            className={`bg-card border p-4 ${
              a.completa ? 'border-white/10' : 'border-amber-500/20 bg-amber-500/[0.02]'
            }`}
          >
            <div className="flex items-start gap-3">
              <div
                className={`mt-1 h-2 w-2 rounded-full shrink-0 ${
                  a.completa ? 'bg-cyan-400/70' : 'bg-amber-400/70'
                }`}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-100 leading-snug">{a.accion}</p>

                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  <span className="flex items-center gap-1 text-gray-400">
                    <User className="h-3 w-3 text-gray-600" />
                    {a.responsable || (
                      <span className="text-amber-300/80">Sin responsable</span>
                    )}
                  </span>
                  <span className="flex items-center gap-1 text-gray-400">
                    <Calendar className="h-3 w-3 text-gray-600" />
                    {a.fecha_limite || <span className="text-amber-300/80">Sin fecha</span>}
                  </span>
                  {a.prioridad && (
                    <Badge
                      variant="outline"
                      className={`text-[10px] py-0 px-1.5 ${priorityClasses(a.prioridad)}`}
                    >
                      {PRIORITY_LABELS[a.prioridad]}
                    </Badge>
                  )}
                </div>

                {!a.completa && a.falta && a.falta.length > 0 && (
                  <div className="mt-2 flex items-center gap-1.5 text-xs text-amber-300/80">
                    <AlertTriangle className="h-3 w-3" />
                    <span>Falta: {a.falta.map((f) => FALTA_LABELS[f] || f).join(', ')}</span>
                  </div>
                )}

                {a.cita && (
                  <p className="mt-2 text-xs italic text-gray-500 border-l-2 border-white/10 pl-2.5">
                    «{a.cita}»
                  </p>
                )}

                {a.segment_ref != null && onJumpToSegment && (
                  <button
                    type="button"
                    onClick={() => onJumpToSegment(a.segment_ref!)}
                    className="mt-2 inline-flex items-center gap-1 text-xs text-cyan-400/80 hover:text-cyan-300 transition-colors"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Ver en transcripción
                  </button>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}

function priorityClasses(prio: 'alta' | 'media' | 'baja'): string {
  if (prio === 'alta') return 'border-red-500/40 text-red-300 bg-red-500/10';
  if (prio === 'media') return 'border-amber-500/40 text-amber-300 bg-amber-500/10';
  return 'border-emerald-500/40 text-emerald-300 bg-emerald-500/10';
}
