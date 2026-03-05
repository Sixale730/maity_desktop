'use client';

import { Card, CardContent } from '@/components/ui/card';
import { EmotionRadarChart } from '../charts';
import type { CommunicationFeedbackV4 } from '../../services/conversations.service';

const SPEAKER_COLORS = ['#3b82f6', '#8b5cf6', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4'];

const EMOTION_EMOJIS: Record<string, string> = {
  alegria: '😊', confianza: '🤝', miedo: '😨', sorpresa: '😲',
  tristeza: '😢', disgusto: '😤', ira: '😡', anticipacion: '🔮',
  alegría: '😊', anticipación: '🔮',
};

interface EmotionProfilesProps {
  feedback: CommunicationFeedbackV4;
  speakerNameMap?: Record<string, string>;
}

export function EmotionProfiles({ feedback, speakerNameMap = {} }: EmotionProfilesProps) {
  const emociones = feedback.dimensiones?.emociones;
  if (!emociones?.por_hablante) return null;

  const hablantes = feedback.meta?.hablantes ?? Object.keys(emociones.por_hablante);
  const speakers = Object.keys(emociones.por_hablante);

  return (
    <div className="space-y-4">
      {/* Combined radar */}
      <Card className="bg-card border-border">
        <CardContent className="p-5">
          <h3 className="text-base font-bold text-foreground mb-1">Perfil Emocional General</h3>
          <p className="text-sm text-muted-foreground mb-3">
            Cada punta del radar es una emoción. Cuanto más grande el área, más presente está esa emoción en la reunión.
          </p>
          <EmotionRadarChart porHablante={emociones.por_hablante} hablantes={hablantes} speakerNameMap={speakerNameMap} />
          {(emociones.lectura_emocional || emociones.emocion_dominante) && (
            <div className="bg-blue-500/10 rounded-lg p-3 text-sm mt-3">
              <strong>Lectura:</strong>{' '}
              {emociones.lectura_emocional
                ?? `La reunión está dominada por ${emociones.emocion_dominante}. Las emociones negativas son mínimas.`}
            </div>
          )}

          {/* Per-speaker tone summary */}
          {speakers.length > 0 && (
            <div className="mt-5">
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Tono por hablante</p>
              <div className="flex flex-wrap gap-4 justify-center">
                {speakers.map((speaker, idx) => {
                  const data = emociones.por_hablante[speaker];
                  if (!data) return null;
                  const hIdx = hablantes.indexOf(speaker);
                  const color = SPEAKER_COLORS[(hIdx >= 0 ? hIdx : idx) % SPEAKER_COLORS.length];
                  const emoji = EMOTION_EMOJIS[data.dominante?.toLowerCase()] ?? '💬';
                  const pct = data.dominante_pct != null ? Math.round(data.dominante_pct * 100) : null;

                  return (
                    <div key={speaker} className="flex flex-col items-center text-center p-3 rounded-lg bg-muted/30 min-w-[120px]">
                      <span className="text-2xl mb-1">{emoji}</span>
                      <span className="text-sm font-semibold" style={{ color }}>{speakerNameMap[speaker] || speaker}</span>
                      <span className="text-xs text-muted-foreground mt-0.5">
                        {data.dominante}{pct != null && ` (${pct}%)`}
                      </span>
                      {data.subtexto && (
                        <span className="text-xs text-muted-foreground/70 italic mt-1">{data.subtexto}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
