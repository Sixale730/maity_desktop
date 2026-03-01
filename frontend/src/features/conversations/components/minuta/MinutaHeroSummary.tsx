'use client';

import { Card, CardContent } from '@/components/ui/card';
import type { MeetingMinutesData } from '../../services/conversations.service';

interface MinutaHeroSummaryProps {
  data: MeetingMinutesData;
}

export function MinutaHeroSummary({ data }: MinutaHeroSummaryProps) {
  const meta = data.meta;
  const firstTema = data.temas?.[0];

  return (
    <Card className="bg-card border-border">
      <CardContent className="p-5">
        <h3 className="text-base font-bold text-foreground mb-2">{meta?.titulo || 'Minuta de Reunión'}</h3>

        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground mb-3">
          {meta?.fecha && <span>📅 {meta.fecha}</span>}
          {meta?.duracion_minutos && <span>⏱️ {meta.duracion_minutos} min</span>}
          {meta?.tipo_reunion && <span>📋 {meta.tipo_reunion}</span>}
          {meta?.total_palabras > 0 && <span>💬 {meta.total_palabras.toLocaleString()} palabras</span>}
        </div>

        {firstTema?.resumen && (
          <p className="text-sm text-muted-foreground">{firstTema.resumen}</p>
        )}

        {data.temas && data.temas.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {data.temas.slice(0, 5).map((tema, i) => (
              <span key={i} className="text-xs px-2 py-1 rounded-full bg-muted text-muted-foreground">
                {tema.titulo || tema.nombre || `Tema ${i + 1}`}
              </span>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
