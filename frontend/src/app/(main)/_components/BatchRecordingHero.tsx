'use client';

import React from 'react';
import { Sparkles } from 'lucide-react';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import { useMeetingMetrics } from '@/hooks/useMeetingMetrics';
import { useCoachTips } from '@/hooks/useCoachTips';
import { AudioLevelBars } from '@/components/audio/AudioLevelBars';
import { HealthGauge } from '@/components/coach/HealthGauge';
import { TalkTimeRing, formatClock } from '@/components/coach/TalkTimeRing';
import { getCategoryMeta, getPriorityColor } from '@/components/coach/tipMeta';

/**
 * Centro de la home mientras se graba en modo LOTE (sin transcripción en vivo).
 *
 * Antes: una barra "Grabando • mm:ss", un punto azul y dos líneas de texto;
 * el resto del panel quedaba vacío toda la sesión y parecía que Maity no
 * hacía nada. Composición aprobada el 2026-09-11 (mockups: artifact
 * "Pantalla de grabación", opciones 1 + 3): temporizador grande, barras por
 * canal en espejo como prueba de captura, tarjeta **Ritmo** + anillo de
 * tiempo de palabra como significado, última recomendación del coach y una
 * leyenda. Reglas en `docs/UI_REGLAS.md` § "Pantalla de grabación en lote".
 *
 * - Las barras son `AudioLevelBars` (hoja sobre `audioLevelsStore`, #07):
 *   este componente NO conoce los niveles y no se re-renderiza por audio.
 * - "Ritmo", no "Salud": en lote el score sólo mide monólogo y reparto de
 *   habla (`coach/audio_heuristics.rs::health_score`, rango 35-75).
 * - Sin indicador de guardados/checkpoints: decisión de producto.
 */

const MIC_COLOR = '#485df4';
const SYS_COLOR = '#10b981';

export const HERO_BAR_COUNT = 44;
const HERO_BAR_MAX_PX = 52;
const HERO_BAR_WIDTH_PX = 6;
const HERO_BAR_GAP_PX = 4;
/** rms → px. El pill usa 200 sobre 24 px; aquí hay 52 px de recorrido. */
const HERO_MULTIPLIER = 500;
const HERO_DURATION_MS = 120;

/**
 * Envolvente en arco (más alto al centro) con un jitter DETERMINISTA para que
 * las barras no formen una campana perfecta. Puro y calculado una sola vez por
 * módulo; exportado para tests.
 */
export function buildEnvelope(count: number, seed = 7): number[] {
  let s = seed;
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  return Array.from({ length: count }, (_, i) => {
    const arch = 0.35 + 0.65 * Math.sin((Math.PI * (i + 0.5)) / count);
    const jitter = 0.7 + 0.3 * rnd();
    return Math.round(arch * jitter * 100) / 100;
  });
}

const MIC_SCALES = buildEnvelope(HERO_BAR_COUNT);
// El canal sistema usa la misma envolvente invertida y algo más baja para que
// las dos mitades no sean simétricas píxel a píxel.
const SYS_SCALES = buildEnvelope(HERO_BAR_COUNT, 11)
  .map((v) => Math.round(v * 0.8 * 100) / 100)
  .reverse();

export function BatchRecordingHero() {
  const { isRecording, isPaused, activeDuration } = useRecordingState();
  const { metrics, isWaitingForAudio } = useMeetingMetrics();
  const { latestTip } = useCoachTips(3);

  const barsActive = isRecording && !isPaused;
  const elapsedSecs = Math.floor(activeDuration ?? 0);

  return (
    <div className="flex flex-col gap-3 animate-fade-in" data-testid="batch-live-hero">
      {/* Temporizador */}
      <div className="flex flex-col items-center gap-1.5 pt-2">
        <div className="flex items-center gap-1.5">
          <span className="relative flex h-2 w-2">
            {!isPaused && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#ff0050] opacity-75" />
            )}
            <span
              className={`relative inline-flex h-2 w-2 rounded-full ${isPaused ? 'bg-amber-400' : 'bg-[#ff0050]'}`}
            />
          </span>
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground">
            {isPaused ? 'Pausado' : 'Grabando'}
          </span>
        </div>
        <span className="text-5xl font-semibold leading-none tabular-nums tracking-wide text-foreground">
          {formatClock(elapsedSecs)}
        </span>
      </div>

      {/* Barras por canal en espejo: mic crece hacia arriba, sistema hacia abajo */}
      <div className="flex flex-col items-center gap-[2px] overflow-hidden py-2" aria-hidden="true">
        <AudioLevelBars
          channel="mic"
          color={MIC_COLOR}
          active={barsActive}
          scales={MIC_SCALES}
          maxHeightPx={HERO_BAR_MAX_PX}
          barWidthPx={HERO_BAR_WIDTH_PX}
          gapPx={HERO_BAR_GAP_PX}
          multiplier={HERO_MULTIPLIER}
          durationMs={HERO_DURATION_MS}
          origin="bottom"
        />
        <AudioLevelBars
          channel="sys"
          color={SYS_COLOR}
          active={barsActive}
          scales={SYS_SCALES}
          maxHeightPx={HERO_BAR_MAX_PX}
          barWidthPx={HERO_BAR_WIDTH_PX}
          gapPx={HERO_BAR_GAP_PX}
          multiplier={HERO_MULTIPLIER}
          durationMs={HERO_DURATION_MS}
          origin="top"
        />
      </div>
      <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: MIC_COLOR }} />
          Tú
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: SYS_COLOR }} />
          Interlocutor
        </span>
      </div>

      {/* Ritmo + tiempo de palabra */}
      <div className="grid grid-cols-[168px_minmax(0,1fr)] gap-3">
        <div className="flex items-center justify-center rounded-xl border border-border bg-card/50 p-3">
          <HealthGauge
            value={metrics?.health ?? 70}
            label="Ritmo"
            className={isWaitingForAudio ? 'opacity-40' : undefined}
          />
        </div>
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-card/50 p-3">
          <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
            Tiempo de palabra
          </span>
          <TalkTimeRing
            userPct={metrics?.userTalkPct ?? 50}
            interlocutorPct={metrics?.interlocutorTalkPct ?? 50}
            userSecs={metrics?.userVoicedSecs}
            interlocutorSecs={metrics?.interlocutorVoicedSecs}
            empty={isWaitingForAudio}
          />
        </div>
      </div>

      {/* Última recomendación del coach (por audio: monólogo / dominancia) */}
      {latestTip && (
        <div className="flex items-center gap-2.5 rounded-xl border border-border bg-card/50 px-3 py-2.5">
          <Sparkles
            className="h-3.5 w-3.5 shrink-0"
            style={{ color: getPriorityColor(latestTip.priority) }}
          />
          <p className="m-0 flex-1 text-[13px] leading-[18px] text-foreground">{latestTip.tip}</p>
          <span className="whitespace-nowrap text-[11px] text-muted-foreground/60">
            {getCategoryMeta(latestTip.category).label}
          </span>
        </div>
      )}

      <p className="m-0 text-center text-xs text-muted-foreground/70">
        {isPaused
          ? 'Grabación pausada · el texto se genera al terminar'
          : 'El texto de la conversación llega a Conversaciones al terminar'}
      </p>
    </div>
  );
}

export default BatchRecordingHero;
