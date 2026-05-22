'use client';

import { Calendar, Clock, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { MinutaV2Meta } from '@/features/conversations/services/conversations.service';

interface MinutaHeaderProps {
  meta: MinutaV2Meta;
}

export function MinutaHeader({ meta }: MinutaHeaderProps) {
  const participantes = meta.participantes ?? [];
  const fechaDisplay = formatDate(meta.fecha, meta.idioma);

  return (
    <header className="space-y-3">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-semibold text-white leading-tight">{meta.titulo}</h1>
        <div className="flex gap-2 flex-wrap">
          <Badge variant="outline" className="border-cyan-500/30 text-cyan-300 bg-cyan-500/10">
            {meta.tipo_reunion}
          </Badge>
          {meta.categoria_interlocutor && (
            <Badge variant="outline" className="border-white/10 text-gray-400">
              {meta.categoria_interlocutor}
            </Badge>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-gray-400">
        {fechaDisplay && (
          <span className="flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5" />
            {fechaDisplay}
          </span>
        )}
        {meta.duracion_minutos != null && (
          <span className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            {meta.duracion_minutos} min
          </span>
        )}
        {participantes.length > 0 && (
          <span className="flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" />
            {participantes.length} participantes
          </span>
        )}
      </div>

      {participantes.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {participantes.map((p, i) => (
            <li
              key={`${p.nombre}-${i}`}
              className="text-xs px-2 py-1 rounded-full bg-white/5 border border-white/10 text-gray-300"
            >
              <span className="font-medium text-gray-200">{p.nombre}</span>
              {p.rol && <span className="text-gray-500 ml-1">· {p.rol}</span>}
            </li>
          ))}
        </ul>
      )}
    </header>
  );
}

function formatDate(date: string | null | undefined, idioma: 'es' | 'en'): string | null {
  if (!date) return null;
  try {
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return date;
    return d.toLocaleDateString(idioma === 'en' ? 'en-US' : 'es-MX', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return date;
  }
}
