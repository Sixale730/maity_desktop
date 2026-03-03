'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle } from 'lucide-react';
import type { MinutaAccionCompleta, MinutaAccionIncompleta } from '../../services/conversations.service';
import {
  getAccionDescripcion,
  getCompromisoDescripcion,
  getQuienLoDijoDisplay,
  getQuienLoDijoContext,
} from '../../utils/normalize-meeting-minutes';

interface MinutaActionsProps {
  acciones: MinutaAccionCompleta[];
}

interface MinutaIncompleteActionsProps {
  acciones: MinutaAccionIncompleta[];
}

const PRIORITY_STYLES: Record<string, string> = {
  ALTA: 'bg-red-500/15 text-red-400 border-red-500/30',
  MEDIA: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  BAJA: 'bg-gray-500/15 text-gray-400 border-gray-500/30',
};

const STATUS_STYLES: Record<string, string> = {
  PENDIENTE: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  EN_PROGRESO: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  COMPLETADA: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
};

const FALTA_STYLES: Record<string, string> = {
  'dueño': 'bg-red-500/15 text-red-400 border-red-500/30',
  'fecha límite': 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  'fecha': 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  'aprobación formal': 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  'detalle': 'bg-gray-500/15 text-gray-400 border-gray-500/30',
};

const FALTA_LABELS: Record<string, string> = {
  'dueño': 'Dueño',
  'fecha_limite': 'Fecha límite',
  'fecha límite': 'Fecha límite',
  'fecha': 'Fecha',
  'aprobación formal': 'Aprobación formal',
  'aprobacion formal': 'Aprobación formal',
  'detalle': 'Detalle',
};

function getFaltaLabel(raw: string): string {
  return FALTA_LABELS[raw.toLowerCase()] || raw.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
}

export function MinutaActions({ acciones }: MinutaActionsProps) {
  if (!acciones || acciones.length === 0) {
    return (
      <Card className="bg-card border-border">
        <CardContent className="p-6">
          <p className="text-sm text-muted-foreground text-center">Sin acciones identificadas</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card border-border">
      <CardContent className="p-6">
        {/* Mobile: cards */}
        <div className="md:hidden space-y-3">
          {acciones.map((accion) => (
            <div key={accion.id} className="p-3 bg-muted/30 border border-border rounded-lg space-y-2">
              <p className="text-sm text-foreground font-medium">{getAccionDescripcion(accion)}</p>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="text-muted-foreground">👤 {accion.responsable}</span>
                {accion.fecha_limite && <span className="text-muted-foreground">📅 {accion.fecha_limite}</span>}
              </div>
              <div className="flex gap-2">
                <Badge variant="outline" className={`text-xs ${PRIORITY_STYLES[accion.prioridad] || ''}`}>
                  {accion.prioridad}
                </Badge>
                <Badge variant="outline" className={`text-xs ${STATUS_STYLES[accion.estado] || ''}`}>
                  {accion.estado}
                </Badge>
              </div>
              {accion.dependencias && accion.dependencias.length > 0 && (
                <div className="text-xs text-muted-foreground">
                  <span className="font-semibold">Dependencias:</span>{' '}
                  {accion.dependencias.join(', ')}
                </div>
              )}
              {accion.criterio_exito && (
                <div className="text-xs text-muted-foreground">
                  <span className="font-semibold">Criterio de éxito:</span>{' '}
                  {accion.criterio_exito}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Desktop: table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground text-xs uppercase">
                <th className="text-left py-2 pr-3 font-semibold">#</th>
                <th className="text-left py-2 pr-3 font-semibold">Acción</th>
                <th className="text-left py-2 pr-3 font-semibold">Responsable</th>
                <th className="text-left py-2 pr-3 font-semibold">Fecha límite</th>
                <th className="text-left py-2 pr-3 font-semibold">Prioridad</th>
                <th className="text-left py-2 pr-3 font-semibold">Estado</th>
                <th className="text-left py-2 pr-3 font-semibold">Dependencias</th>
                <th className="text-left py-2 font-semibold">Criterio de éxito</th>
              </tr>
            </thead>
            <tbody>
              {acciones.map((accion, index) => (
                <tr key={accion.id} className="border-b border-border/50">
                  <td className="py-3 pr-3 text-muted-foreground">{index + 1}</td>
                  <td className="py-3 pr-3 text-foreground">{getAccionDescripcion(accion)}</td>
                  <td className="py-3 pr-3 text-muted-foreground">{accion.responsable}</td>
                  <td className="py-3 pr-3 text-muted-foreground">{accion.fecha_limite || '-'}</td>
                  <td className="py-3 pr-3">
                    <Badge variant="outline" className={`text-xs ${PRIORITY_STYLES[accion.prioridad] || ''}`}>
                      {accion.prioridad}
                    </Badge>
                  </td>
                  <td className="py-3 pr-3">
                    <Badge variant="outline" className={`text-xs ${STATUS_STYLES[accion.estado] || ''}`}>
                      {accion.estado}
                    </Badge>
                  </td>
                  <td className="py-3 pr-3 text-muted-foreground text-xs">
                    {accion.dependencias?.join(', ') || '-'}
                  </td>
                  <td className="py-3 text-muted-foreground text-xs">
                    {accion.criterio_exito || '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

export function MinutaIncompleteActions({ acciones }: MinutaIncompleteActionsProps) {
  if (!acciones || acciones.length === 0) {
    return (
      <Card className="bg-card border-border">
        <CardContent className="p-6">
          <p className="text-sm text-muted-foreground text-center">Sin acciones incompletas</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card border-amber-500/30">
      <CardContent className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <AlertTriangle className="h-4 w-4 text-amber-400" />
          <h3 className="text-sm font-bold text-amber-400">
            Acciones incompletas
          </h3>
        </div>

        <div className="space-y-3">
          {acciones.map((accion) => {
            const quienDisplay = getQuienLoDijoDisplay(accion.quien_lo_dijo);
            const quienContext = getQuienLoDijoContext(accion.quien_lo_dijo);
            const faltaArray = accion.falta || [];
            const queFaltaString = accion.que_falta;

            return (
              <div
                key={accion.id}
                className="p-4 bg-amber-500/5 border border-amber-500/10 rounded-lg"
              >
                <p className="text-sm font-medium text-foreground mb-1">
                  {getCompromisoDescripcion(accion)}
                </p>

                {quienDisplay && (
                  <p className="text-xs text-muted-foreground mb-1">
                    <span className="font-semibold">Quién lo dijo:</span> {quienDisplay}
                    {quienContext && (
                      <span className="text-muted-foreground/70 ml-1">— {quienContext}</span>
                    )}
                  </p>
                )}

                {/* §7 format: falta as array of badges */}
                {faltaArray.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-1">
                    <span className="text-xs font-semibold text-amber-400">Falta:</span>
                    {faltaArray.map((item, i) => (
                      <Badge
                        key={i}
                        variant="outline"
                        className={`text-xs ${FALTA_STYLES[getFaltaLabel(item).toLowerCase()] || FALTA_STYLES[item.toLowerCase()] || 'bg-gray-500/15 text-gray-400 border-gray-500/30'}`}
                      >
                        {getFaltaLabel(item)}
                      </Badge>
                    ))}
                  </div>
                )}

                {/* Old format fallback: que_falta as string */}
                {faltaArray.length === 0 && queFaltaString && (
                  <p className="text-xs text-amber-400 mb-1">
                    <span className="font-semibold">Falta:</span> {queFaltaString}
                  </p>
                )}

                {accion.sugerencia && (
                  <p className="text-xs text-muted-foreground">
                    <span className="font-semibold">Sugerencia:</span> {accion.sugerencia}
                  </p>
                )}

                {accion.cita && (
                  <blockquote className="mt-2 pl-3 border-l-2 border-amber-500/20 text-xs text-muted-foreground italic leading-relaxed">
                    «{accion.cita}»
                  </blockquote>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
