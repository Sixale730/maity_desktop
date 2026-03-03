'use client';

import { Card, CardContent } from '@/components/ui/card';
import { CalendarDays, ListChecks, BookOpen, Send, CalendarPlus } from 'lucide-react';
import type { MinutaSeguimientoData, MinutaPreparacionItem } from '../../services/conversations.service';
import { getProximaReunionDisplay } from '../../utils/normalize-meeting-minutes';

interface MinutaSeguimientoProps {
  seguimiento: MinutaSeguimientoData | null;
  userName?: string;
}

const GENERIC_NAMES = ['user', 'usuario', 'interlocutor', 'otro', 'unknown', 'no especificado'];

export function MinutaSeguimiento({ seguimiento, userName }: MinutaSeguimientoProps) {
  if (!seguimiento) {
    return (
      <Card className="bg-card border-border">
        <CardContent className="p-6">
          <p className="text-sm text-muted-foreground text-center">Sin seguimiento definido</p>
        </CardContent>
      </Card>
    );
  }

  const proximaDisplay = getProximaReunionDisplay(seguimiento.proxima_reunion);
  const agenda = seguimiento.agenda_preliminar || seguimiento.agenda_sugerida || [];
  const preparacion = seguimiento.preparacion_requerida as MinutaPreparacionItem[] | undefined || [];
  const preparacionStrings = seguimiento.preparacion || [];
  const distribucionRaw = seguimiento.distribucion_minuta || seguimiento.distribucion || [];
  const distribucion = distribucionRaw.filter(name => !GENERIC_NAMES.includes(name.toLowerCase()));
  if (userName && !distribucion.some(d => d.toLowerCase() === userName.toLowerCase())) {
    distribucion.unshift(userName);
  }

  const hasContent = proximaDisplay ||
    seguimiento.evento_adicional ||
    agenda.length > 0 ||
    (Array.isArray(preparacion) && preparacion.length > 0) ||
    preparacionStrings.length > 0 ||
    distribucion.length > 0;

  if (!hasContent) {
    return (
      <Card className="bg-card border-border">
        <CardContent className="p-6">
          <p className="text-sm text-muted-foreground text-center">Sin seguimiento definido</p>
        </CardContent>
      </Card>
    );
  }

  // Determine if preparacion_requerida contains objects (§7) or strings (old)
  const prepIsObjects = Array.isArray(preparacion) && preparacion.length > 0 && typeof preparacion[0] === 'object';

  return (
    <Card className="bg-card border-border">
      <CardContent className="p-6">
        <h3 className="text-sm font-bold text-foreground mb-4 flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-cyan-400" />
          Seguimiento
        </h3>

        <div className="space-y-4">
          {proximaDisplay && (
            <div className="flex gap-3 items-start">
              <CalendarDays className="h-4 w-4 text-cyan-400 shrink-0 mt-0.5" />
              <div>
                <span className="text-xs font-semibold text-muted-foreground uppercase">Próxima reunión</span>
                <p className="text-sm text-muted-foreground mt-0.5">{proximaDisplay}</p>
              </div>
            </div>
          )}

          {seguimiento.evento_adicional && (
            <div className="flex gap-3 items-start">
              <CalendarPlus className="h-4 w-4 text-pink-400 shrink-0 mt-0.5" />
              <div>
                <span className="text-xs font-semibold text-muted-foreground uppercase">Evento adicional</span>
                <p className="text-sm text-muted-foreground mt-0.5">{seguimiento.evento_adicional}</p>
              </div>
            </div>
          )}

          {agenda.length > 0 && (
            <div className="flex gap-3 items-start">
              <ListChecks className="h-4 w-4 text-violet-400 shrink-0 mt-0.5" />
              <div>
                <span className="text-xs font-semibold text-muted-foreground uppercase">Agenda sugerida</span>
                <ul className="mt-1 space-y-1">
                  {agenda.map((item, i) => (
                    <li key={i} className="text-sm text-muted-foreground flex gap-2">
                      <span className="text-muted-foreground/50">•</span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* §7 format: preparacion_requerida as objects */}
          {prepIsObjects && (
            <div className="flex gap-3 items-start">
              <BookOpen className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <span className="text-xs font-semibold text-muted-foreground uppercase">Preparación</span>
                <ul className="mt-1 space-y-1">
                  {(preparacion as MinutaPreparacionItem[]).map((item, i) => (
                    <li key={i} className="text-sm text-muted-foreground flex gap-2">
                      <span className="text-muted-foreground/50">•</span>
                      <span><strong className="text-foreground">{item.participante}</strong> → {item.preparacion}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* Old format fallback: preparacion as strings */}
          {!prepIsObjects && preparacionStrings.length > 0 && (
            <div className="flex gap-3 items-start">
              <BookOpen className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <span className="text-xs font-semibold text-muted-foreground uppercase">Preparación</span>
                <ul className="mt-1 space-y-1">
                  {preparacionStrings.map((item, i) => (
                    <li key={i} className="text-sm text-muted-foreground flex gap-2">
                      <span className="text-muted-foreground/50">•</span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {distribucion.length > 0 && (
            <div className="flex gap-3 items-start">
              <Send className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <span className="text-xs font-semibold text-muted-foreground uppercase">Distribución</span>
                <p className="text-sm text-muted-foreground mt-0.5">{distribucion.join(', ')}</p>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
