'use client';

import { Card, CardContent } from '@/components/ui/card';
import type { MinutaSeguimientoData } from '../../services/conversations.service';

interface MinutaSeguimientoProps {
  seguimiento: MinutaSeguimientoData;
}

export function MinutaSeguimiento({ seguimiento }: MinutaSeguimientoProps) {
  if (!seguimiento) return null;

  const proximaReunion = seguimiento.proxima_reunion;
  const agenda = seguimiento.agenda_sugerida || seguimiento.agenda_preliminar;
  const preparacion = seguimiento.preparacion_requerida;
  const distribucion = seguimiento.distribucion_minuta;

  const hasContent = proximaReunion || seguimiento.evento_adicional || agenda?.length || preparacion?.length || distribucion?.length;
  if (!hasContent) return null;

  return (
    <Card className="bg-card border-border">
      <CardContent className="p-5">
        <h3 className="text-base font-bold text-foreground mb-4">Seguimiento</h3>

        <div className="space-y-4">
          {/* Next meeting */}
          {proximaReunion && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1">Próxima reunión</p>
              {typeof proximaReunion === 'string' ? (
                <p className="text-sm text-foreground">{proximaReunion}</p>
              ) : (
                <div className="text-sm text-foreground space-y-0.5">
                  <p>📅 {proximaReunion.fecha} {proximaReunion.hora && `a las ${proximaReunion.hora}`}</p>
                  {proximaReunion.lugar && <p>📍 {proximaReunion.lugar}</p>}
                  {proximaReunion.proposito && <p>🎯 {proximaReunion.proposito}</p>}
                </div>
              )}
            </div>
          )}

          {seguimiento.evento_adicional && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1">Evento adicional</p>
              <p className="text-sm text-foreground">{seguimiento.evento_adicional}</p>
            </div>
          )}

          {/* Suggested agenda */}
          {agenda && agenda.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1">Agenda sugerida</p>
              <ul className="list-disc list-inside text-sm text-muted-foreground space-y-0.5">
                {agenda.map((item, i) => <li key={i}>{item}</li>)}
              </ul>
            </div>
          )}

          {/* Preparation */}
          {preparacion && preparacion.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1">Preparación requerida</p>
              <ul className="list-disc list-inside text-sm text-muted-foreground space-y-0.5">
                {preparacion.map((item, i) => (
                  <li key={i}>
                    {typeof item === 'string' ? item : `${item.participante}: ${item.preparacion}`}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Distribution */}
          {distribucion && distribucion.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1">Distribución</p>
              <div className="flex flex-wrap gap-1.5">
                {distribucion.map((name, i) => (
                  <span key={i} className="text-xs px-2 py-1 rounded-full bg-muted text-muted-foreground">
                    {name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
