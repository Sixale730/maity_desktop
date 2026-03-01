'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { MinutaAccionCompleta, MinutaAccionIncompleta } from '../../services/conversations.service';

const PRIORITY_STYLES: Record<string, string> = {
  ALTA: 'bg-red-500/20 text-red-300',
  MEDIA: 'bg-amber-500/20 text-amber-300',
  BAJA: 'bg-blue-500/20 text-blue-300',
};

const STATUS_STYLES: Record<string, string> = {
  PENDIENTE: 'bg-amber-500/20 text-amber-300',
  EN_PROGRESO: 'bg-blue-500/20 text-blue-300',
  COMPLETADA: 'bg-emerald-500/20 text-emerald-300',
};

interface MinutaActionsProps {
  acciones: { lista: MinutaAccionCompleta[]; seguimiento?: unknown };
  incompletas?: MinutaAccionIncompleta[];
}

export function MinutaActions({ acciones, incompletas }: MinutaActionsProps) {
  const lista = acciones?.lista;
  const hasActions = lista && lista.length > 0;
  const hasIncompletas = incompletas && incompletas.length > 0;

  if (!hasActions && !hasIncompletas) return null;

  return (
    <div className="space-y-4">
      {/* Complete actions */}
      {hasActions && (
        <Card className="bg-card border-border">
          <CardContent className="p-5">
            <h3 className="text-base font-bold text-foreground mb-4">Acciones</h3>
            <div className="space-y-3">
              {lista.map((accion, i) => (
                <div key={i} className="rounded-lg border border-border bg-muted/30 p-3">
                  <div className="flex items-start gap-2 mb-1">
                    <p className="text-sm text-foreground flex-1">
                      {accion.accion || accion.descripcion}
                    </p>
                    <Badge className={PRIORITY_STYLES[accion.prioridad?.toUpperCase()] ?? PRIORITY_STYLES.MEDIA}>
                      {accion.prioridad}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    {accion.responsable && <span>👤 {accion.responsable}</span>}
                    {accion.fecha_limite && <span>📅 {accion.fecha_limite}</span>}
                    {accion.estado && (
                      <Badge className={STATUS_STYLES[accion.estado?.toUpperCase()] ?? 'bg-muted text-muted-foreground'} variant="outline">
                        {accion.estado}
                      </Badge>
                    )}
                  </div>
                  {accion.criterio_exito && (
                    <p className="text-xs text-muted-foreground mt-1">Éxito: {accion.criterio_exito}</p>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Incomplete actions */}
      {hasIncompletas && (
        <Card className="bg-card border-amber-500/30">
          <CardContent className="p-5">
            <h3 className="text-base font-bold text-amber-400 mb-4">⚠️ Acciones Incompletas</h3>
            <div className="space-y-3">
              {incompletas.map((inc, i) => (
                <div key={i} className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                  <p className="text-sm text-foreground mb-1">
                    {inc.compromiso || inc.descripcion}
                  </p>
                  {inc.falta && inc.falta.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {inc.falta.map((f, j) => (
                        <Badge key={j} variant="outline" className="text-xs bg-amber-500/10 text-amber-300">
                          Falta: {f}
                        </Badge>
                      ))}
                    </div>
                  )}
                  {inc.que_falta && (
                    <p className="text-xs text-amber-400 mt-1">Falta: {inc.que_falta}</p>
                  )}
                  {inc.sugerencia && (
                    <p className="text-xs text-emerald-400 mt-1">💡 {inc.sugerencia}</p>
                  )}
                  {inc.cita && (
                    <blockquote className="text-xs text-muted-foreground italic border-l-2 border-muted pl-2 mt-1.5">
                      &ldquo;{inc.cita}&rdquo;
                    </blockquote>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
