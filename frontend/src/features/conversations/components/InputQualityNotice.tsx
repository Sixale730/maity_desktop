'use client';

import { Info } from 'lucide-react';
import type { CalidadInsumo } from '../services/conversations.service';

/**
 * Lee `communication_feedback_v4.calidad_insumo` (#147) de forma defensiva.
 * Filas analizadas antes de ago-2026 no traen la clave → `null` y el aviso no
 * se pinta. Espejo de `readCalidadInsumo` de la web.
 */
export function readCalidadInsumo(feedbackV4: unknown): CalidadInsumo | null {
  if (!feedbackV4 || typeof feedbackV4 !== 'object') return null;
  const raw = (feedbackV4 as Record<string, unknown>).calidad_insumo;
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.duracion_total_min !== 'number' || typeof c.tramos_densos_min !== 'number') return null;
  return {
    duracion_total_min: c.duracion_total_min,
    tramos_densos_min: c.tramos_densos_min,
    ratio_alucinacion: typeof c.ratio_alucinacion === 'number' ? c.ratio_alucinacion : 0,
    palabras_descartadas: typeof c.palabras_descartadas === 'number' ? c.palabras_descartadas : 0,
    hablantes_detectados: typeof c.hablantes_detectados === 'number' ? c.hablantes_detectados : undefined,
    confianza_atribucion:
      c.confianza_atribucion === 'alta' || c.confianza_atribucion === 'baja' ? c.confianza_atribucion : null,
    nivel: c.nivel === 'baja' ? 'baja' : 'alta',
  };
}

/**
 * "Se analizaron X min de Y grabados": sobre qué se calculó el puntaje y qué
 * quedó fuera. Se pinta encima del dashboard SOLO cuando algo quedó fuera —
 * una grabación limpia no lleva aviso. Copys espejo de `omi.input_quality_*`.
 */
export function InputQualityNotice({ calidad }: { calidad: CalidadInsumo }) {
  const partial = calidad.tramos_densos_min < calidad.duracion_total_min - 0.5;
  const discarded = calidad.palabras_descartadas > 0;
  const lowConfidence = calidad.nivel === 'baja';

  if (!partial && !discarded && !lowConfidence) return null;

  const tone = lowConfidence
    ? 'border-amber-500/30 bg-amber-500/5 text-amber-200'
    : 'border-sky-500/20 bg-sky-500/5 text-sky-100';

  return (
    <div
      className={`rounded-lg border px-4 py-3 text-sm flex gap-3 ${tone}`}
      data-testid="input-quality-notice"
      data-nivel={calidad.nivel}
    >
      <Info className="h-4 w-4 mt-0.5 shrink-0 opacity-80" />
      <div className="space-y-1">
        {partial && (
          <p>
            Se analizaron {Math.round(calidad.tramos_densos_min)} min de conversación dentro de{' '}
            {Math.round(calidad.duracion_total_min)} min grabados. El resto no tenía habla continua y no se evaluó.
          </p>
        )}
        {discarded && (
          <p className="opacity-80">
            Se descartaron {calidad.palabras_descartadas} palabras que el reconocimiento de voz probablemente inventó
            sobre ruido.
          </p>
        )}
        {lowConfidence && (
          <p>
            Aun así, una parte del audio evaluado ({Math.round(calidad.ratio_alucinacion * 100)}%) parece ruido
            transcrito, así que el puntaje puede no reflejar solo lo que dijiste.
          </p>
        )}
      </div>
    </div>
  );
}
