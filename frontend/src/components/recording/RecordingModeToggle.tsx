'use client';

import { invoke } from '@tauri-apps/api/core';
import { useConfig, type RecordingMode } from '@/contexts/ConfigContext';
import { logger } from '@/lib/logger';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  PRESENTER_MODE_FEATURE,
  isFeatureEnabled,
  useQuotaStatus,
} from '@/hooks/usePlanStatus';

/**
 * Toggle Conversación / Presentación que vive en la VISTA DE GRABACIÓN (junto al panel
 * de feedback en vivo). Se puede cambiar mientras grabas: aplica al instante porque el
 * coach lee el modo dinámicamente, y se persiste para la evaluación post-reunión + nube.
 *
 * En "Presentación" (ponente/webinar/clase) el usuario habla casi todo el tiempo a
 * propósito; los motores de evaluación dejan de penalizarlo por "acaparar".
 */
const MODES: ReadonlyArray<{ value: RecordingMode; label: string; icon: string }> = [
  { value: 'conversation', label: 'Conversación', icon: '💬' },
  { value: 'presentation', label: 'Presentación', icon: '🎤' },
];

export function RecordingModeToggle() {
  const { recordingMode, setRecordingMode } = useConfig();
  const { data: quotaStatus } = useQuotaStatus();
  // Fail-open: sin datos (offline/loading) o feature ausente → habilitado.
  // El enforcement real es server-side; esto es cortesía de UI.
  const presenterAllowed = isFeatureEnabled(quotaStatus, PRESENTER_MODE_FEATURE);

  const handleSelect = (mode: RecordingMode) => {
    if (mode === recordingMode) return;
    if (mode === 'presentation' && !presenterAllowed) return;
    setRecordingMode(mode); // persiste como default para la próxima grabación
    // Propagar a la grabación en curso: sessionStorage para el stop/eval, y avisar al
    // coach en vivo (lee el flag dinámicamente → el cambio surte efecto de inmediato).
    try {
      sessionStorage.setItem('active_recording_mode', mode);
    } catch {
      /* sessionStorage no disponible — no es fatal */
    }
    invoke('coach_set_presentation_mode', { isPresentation: mode === 'presentation' }).catch(
      (e) => logger.debug('coach_set_presentation_mode failed:', e)
    );
  };

  return (
    <div
      role="radiogroup"
      aria-label="Modo de grabación"
      title="Presentación: hablas tú casi todo el tiempo; no te evaluamos por “hablar de más”."
      className="inline-flex items-center gap-0.5 rounded-full border border-white/10 bg-white/5 p-0.5"
    >
      {MODES.map((mode) => {
        const active = recordingMode === mode.value;
        const locked = mode.value === 'presentation' && !presenterAllowed;
        const button = (
          <button
            key={mode.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={locked}
            onClick={() => handleSelect(mode.value)}
            className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
              active
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-white/10'
            } disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent`}
          >
            <span aria-hidden="true">{mode.icon}</span>
            <span>{mode.label}</span>
          </button>
        );
        if (!locked) return button;
        // Radix no dispara tooltips sobre elementos disabled → wrapper span.
        return (
          <TooltipProvider key={`locked-${mode.value}`} delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">{button}</span>
              </TooltipTrigger>
              <TooltipContent side="top">
                Modo ponente es una función Pro — mejora tu plan para activarlo.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      })}
    </div>
  );
}
