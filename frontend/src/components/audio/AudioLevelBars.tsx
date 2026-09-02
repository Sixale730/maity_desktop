'use client';

import React from 'react';
import { useAudioLevels } from '@/lib/audioLevelsStore';

/**
 * Barras de nivel de audio (mic/sistema) — componente HOJA memoizado
 * (issue #07 de la auditoría de recursos).
 *
 * Antes: `AudioBars5` (coach-float) y `AudioBars` (recording-widget) recibían
 * `rms` por prop, leído del `useState` de niveles de LA PÁGINA COMPLETA.
 * Cada tick de audio (10-20 Hz) re-renderizaba ~70 nodos de la página,
 * incluyendo el árbol debajo del `backdrop-filter: blur()`.
 *
 * Ahora: este componente consume `useAudioLevels` DIRECTO (vía
 * `audioLevelsStore`), así que SOLO ÉL se re-renderiza en cada tick — la
 * página padre ya ni siquiera sabe cuándo cambian los niveles.
 *
 * `React.memo`: como el padre ya no pasa `rms`/`levels`, las únicas props
 * que cambian entre renders del padre son color/active (estado de
 * grabación, no de audio) — memoizar evita reconciliar este árbol cuando el
 * padre re-renderiza por otras razones (tips, timer, etc.) sin que cambien
 * esas props. El re-render por cambio de nivel sigue ocurriendo igual,
 * disparado por `useSyncExternalStore`, memo no lo impide ni debe hacerlo.
 */

const DEFAULT_SCALES = [0.4, 0.8, 0.6, 1.0, 0.5];
/**
 * Alturas idle (px) del patrón "casi plano" cuando NO hay audio ni
 * grabación. Valores subidos (vs. un idle a 0) para que el silencio no se
 * vea más "alto" que la voz — bug histórico "barras al revés" de coach-float.
 */
const DEFAULT_IDLE_HEIGHTS = [2, 3, 2, 3, 2];
const DEFAULT_MAX_HEIGHT_PX = 16;
const DEFAULT_BAR_WIDTH_PX = 4; // Tailwind `w-1` del coach-float original.
const DEFAULT_MULTIPLIER = 600;
const DEFAULT_DURATION_MS = 150;
/** Umbral para considerar que hay audio real entrando (cualquiera de los dos canales). */
const LIVE_AUDIO_THRESHOLD = 0.005;
/** scaleY mínimo — equivalente al piso de 2px del diseño original, para que la barra nunca desaparezca del todo. */
const MIN_SCALE_Y = 0.02;

export interface AudioLevelBarsProps {
  /** Canal que pinta ESTA instancia — cada instancia muestra un solo canal. */
  channel: 'mic' | 'sys';
  /** Color de relleno, ya resuelto por el caller según su propio estado (grabando/pausado/idle). */
  color: string;
  /**
   * Si el caller quiere que las barras animen con niveles reales (p. ej.
   * `recordingActive && !isPaused`). Se combina con `hasLiveAudio` —derivado
   * aquí adentro, porque el padre ya NO tiene acceso a los niveles— así que
   * el preview de audio (sin grabar) también anima las barras, igual que el
   * comportamiento original de coach-float.
   *
   * Nota: esto difiere del original en un caso extremo — pausado CON
   * audio residual detectado (`hasLiveAudio`) anima igual, mientras que el
   * original congelaba SIEMPRE en pausa. Es un borde despreciable (el
   * threshold es 0.005 y en pausa no debería haber señal real); no vale la
   * pena una tercera prop `isPaused` solo por esto.
   *
   * Default `true`: úsalo para paneles que siempre deben reflejar el nivel
   * crudo sin distinguir "idle" (recording-widget).
   */
  active?: boolean;
  scales?: number[];
  idleHeights?: number[];
  maxHeightPx?: number;
  barWidthPx?: number;
  /** rms → px. coach-float usa 600 (barras chicas, sensibles); recording-widget usa 200 (barras grandes). */
  multiplier?: number;
  durationMs?: number;
  className?: string;
}

function AudioLevelBarsImpl({
  channel,
  color,
  active = true,
  scales = DEFAULT_SCALES,
  idleHeights = DEFAULT_IDLE_HEIGHTS,
  maxHeightPx = DEFAULT_MAX_HEIGHT_PX,
  barWidthPx = DEFAULT_BAR_WIDTH_PX,
  multiplier = DEFAULT_MULTIPLIER,
  durationMs = DEFAULT_DURATION_MS,
  className = '',
}: AudioLevelBarsProps) {
  const { micRms, sysRms } = useAudioLevels({ enabled: true });
  const rms = channel === 'mic' ? micRms : sysRms;
  const hasLiveAudio = micRms > LIVE_AUDIO_THRESHOLD || sysRms > LIVE_AUDIO_THRESHOLD;
  const isActive = active || hasLiveAudio;

  return (
    <div
      className={`flex items-end gap-[2px] ${className}`}
      style={{ height: `${maxHeightPx}px` }}
    >
      {scales.map((scale, i) => {
        const heightPx = isActive
          ? Math.max(2, Math.min(maxHeightPx, rms * multiplier * scale))
          : (idleHeights[i] ?? idleHeights[idleHeights.length - 1] ?? 2);
        // scaleY en vez de height: `transform` es compositor-only y no
        // fuerza reflow — animar `height` invalidaba la región del
        // backdrop-filter del contenedor padre en cada frame (recomposición
        // del blur por CPU). Barra de altura FIJA (maxHeightPx) que se
        // "encoge" desde abajo con transform-origin.
        const scaleY = Math.max(MIN_SCALE_Y, Math.min(1, heightPx / maxHeightPx));
        return (
          <div
            key={i}
            className="rounded-full transition-transform"
            style={{
              width: `${barWidthPx}px`,
              height: `${maxHeightPx}px`,
              backgroundColor: color,
              transform: `scaleY(${scaleY})`,
              transformOrigin: 'bottom',
              transitionDuration: `${durationMs}ms`,
            }}
          />
        );
      })}
    </div>
  );
}

export const AudioLevelBars = React.memo(AudioLevelBarsImpl);
