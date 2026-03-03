'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ChevronDown } from 'lucide-react';
import type { CommunicationFeedbackV4, Recomendacion } from '../../services/conversations.service';

const PRIORITY_STYLES: Record<number, string> = {
  1: 'bg-red-500/20 text-red-300',
  2: 'bg-amber-500/20 text-amber-300',
  3: 'bg-blue-500/20 text-blue-300',
};

function RecomendacionCard({ rec, index }: { rec: Recomendacion; index: number }) {
  const [open, setOpen] = useState(false);
  const priority = rec.prioridad ?? index + 1;

  return (
    <Card className="border-l-[5px] border-l-blue-500 bg-card border-border overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center gap-3 p-4 text-left cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => setOpen(!open)}
      >
        <span className="text-2xl font-extrabold text-blue-500 shrink-0">#{priority}</span>
        <h4 className="text-sm font-semibold text-foreground flex-1">{rec.titulo}</h4>
        <Badge className={PRIORITY_STYLES[priority] ?? PRIORITY_STYLES[3]}>
          P{priority}
        </Badge>
        <ChevronDown
          className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          {rec.descripcion && (
            <p className="text-sm text-muted-foreground">{rec.descripcion}</p>
          )}

          {rec.texto_original && (
            <div className="bg-red-500/10 rounded-lg p-3 border-l-2 border-l-red-500">
              <p className="text-xs font-semibold text-red-400 mb-1">Texto original</p>
              <p className="text-sm text-muted-foreground">{rec.texto_original}</p>
            </div>
          )}

          {rec.texto_mejorado && (
            <div className="bg-emerald-500/10 rounded-lg p-3 border-l-2 border-l-emerald-500">
              <p className="text-xs font-semibold text-emerald-400 mb-1">Texto mejorado</p>
              <p className="text-sm text-muted-foreground">{rec.texto_mejorado}</p>
            </div>
          )}

          {rec.impacto && (
            <p className="text-xs text-emerald-400">Impacto: {rec.impacto}</p>
          )}
          {rec.por_que && (
            <p className="text-xs text-muted-foreground/80">Por qué: {rec.por_que}</p>
          )}
        </div>
      )}
    </Card>
  );
}

interface RecomendacionesSectionProps {
  feedback: CommunicationFeedbackV4;
}

export function RecomendacionesSection({ feedback }: RecomendacionesSectionProps) {
  const recs = feedback.recomendaciones;
  if (!recs || recs.length === 0) return null;

  return (
    <div>
      <h3 className="text-base font-bold text-foreground mb-1">Top Recomendaciones</h3>
      <p className="text-sm text-muted-foreground mb-4">
        Acciones concretas para mejorar tu comunicación.
      </p>

      <div className="space-y-3">
        {recs.slice(0, 3).map((rec, i) => (
          <RecomendacionCard key={i} rec={rec} index={i} />
        ))}
      </div>
    </div>
  );
}
