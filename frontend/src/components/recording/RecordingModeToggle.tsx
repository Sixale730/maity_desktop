'use client';

import { useConfig, type RecordingMode } from '@/contexts/ConfigContext';

/**
 * Toggle Conversación / Presentación que el usuario elige ANTES de grabar.
 *
 * En "Presentación" (ponente/webinar/clase) el usuario habla casi todo el tiempo a
 * propósito; los motores de evaluación (coach en vivo, eval local y análisis V4 en la
 * nube) dejan de penalizarlo por "acaparar" o "hablar de más". La elección se persiste
 * como default en ConfigContext (localStorage) y se lee en useRecordingStart.
 */
const MODES: ReadonlyArray<{ value: RecordingMode; label: string; icon: string; hint: string }> = [
  {
    value: 'conversation',
    label: 'Conversación',
    icon: '💬',
    hint: 'Reunión o diálogo. Se evalúa el balance de la conversación.',
  },
  {
    value: 'presentation',
    label: 'Presentación',
    icon: '🎤',
    hint: 'Ponencia, webinar o clase: hablas tú casi todo el tiempo. No se penaliza por "acaparar".',
  },
];

interface RecordingModeToggleProps {
  disabled?: boolean;
}

export function RecordingModeToggle({ disabled = false }: RecordingModeToggleProps) {
  const { recordingMode, setRecordingMode } = useConfig();

  return (
    <div className="mb-3 flex flex-col items-center gap-1">
      <div
        role="radiogroup"
        aria-label="Modo de grabación"
        className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-black/30 p-1 backdrop-blur-sm"
      >
        {MODES.map((mode) => {
          const active = recordingMode === mode.value;
          const base =
            'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors';
          const state = active
            ? 'bg-white text-gray-900 shadow-sm'
            : 'text-white/60 hover:text-white hover:bg-white/10';
          const dim = disabled ? ' opacity-50 cursor-not-allowed' : '';
          return (
            <button
              key={mode.value}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              title={mode.hint}
              onClick={() => setRecordingMode(mode.value)}
              className={`${base} ${state}${dim}`}
            >
              <span aria-hidden="true">{mode.icon}</span>
              <span>{mode.label}</span>
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-white/40">
        {recordingMode === 'presentation'
          ? 'Modo ponente: no te evaluaremos por “hablar de más”.'
          : 'Se evalúa el balance de la conversación.'}
      </p>
    </div>
  );
}
