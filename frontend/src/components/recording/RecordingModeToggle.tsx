'use client';

import { invoke } from '@tauri-apps/api/core';
import { useConfig, type RecordingMode } from '@/contexts/ConfigContext';
import { logger } from '@/lib/logger';

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

  const handleSelect = (mode: RecordingMode) => {
    if (mode === recordingMode) return;
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
        return (
          <button
            key={mode.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => handleSelect(mode.value)}
            className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
              active
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-white/10'
            }`}
          >
            <span aria-hidden="true">{mode.icon}</span>
            <span>{mode.label}</span>
          </button>
        );
      })}
    </div>
  );
}
