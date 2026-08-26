'use client';

import { MessageSquare } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import type { AnalysisSkipped } from '../services/conversations.service';

/**
 * Tarjeta del tab "Análisis" cuando la web decidió NO analizar (#72).
 *
 * Ramifica por `marker.reason` porque los dos motivos conocidos cuentan
 * historias opuestas: `insufficient_user_words` es "no dijiste suficiente";
 * `no_evaluable_speech` es "dijiste bastante, pero nunca concentrado en una
 * conversación" (bloque de jornada de 60 min con "mm-hmm"). Pintar el primero
 * sobre una grabación de una hora era falso y contradecía las métricas que el
 * propio marcador trae.
 *
 * Reglas: nunca inventar cifras (sin defaults tipo `min_required ?? 15`: si
 * el marcador no trae el número, se omite la frase con número), y un reason
 * desconocido cae en un texto genérico. Copys espejo de la web
 * (`omi.analysis_insufficient*`, `omi.analysis_no_speech*`).
 */

const FOOTER =
  'Esta grabación se deja sin evaluar a propósito y no consumió tu cuota de análisis. La minuta sigue disponible en su pestaña.';

function pluralWords(n: number): string {
  return n === 1 ? '1 palabra' : `${n} palabras`;
}

function SkippedBody({ marker }: { marker: AnalysisSkipped }) {
  switch (marker.reason) {
    case 'insufficient_user_words': {
      const hasMin = typeof marker.min_required === 'number';
      const hasCount = typeof marker.user_words === 'number';
      const detail = hasMin
        ? `Se necesitan al menos ${marker.min_required} palabras tuyas para generar un análisis de comunicación.${
            hasCount ? ` Esta conversación tiene ${pluralWords(marker.user_words as number)} tuyas.` : ''
          }`
        : hasCount
          ? `Esta conversación tiene ${pluralWords(marker.user_words as number)} tuyas, por debajo del mínimo para generar un análisis de comunicación.`
          : 'La transcripción no tiene suficientes palabras tuyas para generar un análisis de comunicación.';
      return (
        <>
          <h3 className="text-lg font-medium mb-2 text-foreground">Conversación muy corta para analizar</h3>
          <p className="text-muted-foreground">{detail}</p>
          <p className="text-muted-foreground text-sm mt-2">
            El análisis de 6 dimensiones evalúa una conversación completa: con tan poco de tu voz, puntuar estructura o
            propósito sería inventar.
          </p>
          {marker.speakers === 1 && (
            <p className="text-muted-foreground text-sm mt-2">
              Además no se detectó a nadie más hablando: sin interlocutor, empatía y adaptación tampoco se pueden medir.
            </p>
          )}
        </>
      );
    }

    case 'no_evaluable_speech': {
      const total = marker.metrics?.duracion_total_min;
      const discarded = marker.metrics?.palabras_descartadas ?? 0;
      const lead =
        typeof total === 'number' && total > 0
          ? `Grabaste ${Math.round(total)} min, pero en ningún tramo de 5 minutos hubo suficiente habla continua para evaluar.`
          : 'En ningún tramo de 5 minutos hubo suficiente habla continua para evaluar.';
      return (
        <>
          <h3 className="text-lg font-medium mb-2 text-foreground">
            No se encontró una conversación en esta grabación
          </h3>
          <p className="text-muted-foreground">
            {lead} Grabar la jornada completa está bien: cuando haya una conversación real dentro, se analiza solo ese
            tramo.
          </p>
          {discarded > 0 && (
            <p className="text-muted-foreground text-sm mt-2">
              Se descartaron {pluralWords(discarded)} que el reconocimiento de voz probablemente inventó sobre ruido.
            </p>
          )}
        </>
      );
    }

    case 'all_providers_failed':
      // Marcador legacy (anterior al issue #39 de la web): hoy un fallo de
      // proveedor escribe `null` + analysis_status='failed', pero quedan filas
      // viejas con este reason dentro del marcador skipped. No es "sin
      // evaluar a propósito" ni sabemos si consumió cuota: no usar el pie común.
      return (
        <>
          <h3 className="text-lg font-medium mb-2 text-foreground">No se pudo completar el análisis</h3>
          <p className="text-muted-foreground">
            El servicio de análisis falló al procesar esta grabación. La minuta sigue disponible en su pestaña.
          </p>
        </>
      );

    default:
      return (
        <>
          <h3 className="text-lg font-medium mb-2 text-foreground">Esta grabación se dejó sin evaluar</h3>
          <p className="text-muted-foreground">
            El contenido no permitió generar un análisis de comunicación significativo.
          </p>
        </>
      );
  }
}

export function AnalysisSkippedCard({ marker }: { marker: AnalysisSkipped }) {
  const showFooter = marker.reason !== 'all_providers_failed';
  return (
    <Card data-testid="analysis-skipped-card" data-reason={marker.reason}>
      <CardContent className="p-12 text-center">
        <MessageSquare className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
        <SkippedBody marker={marker} />
        {showFooter && <p className="text-muted-foreground text-sm mt-4">{FOOTER}</p>}
      </CardContent>
    </Card>
  );
}
