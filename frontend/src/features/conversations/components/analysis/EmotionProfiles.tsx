'use client';

import { Card, CardContent } from '@/components/ui/card';
import { EmotionRadarChart, MiniRadar } from '../charts';
import type { CommunicationFeedbackV4 } from '../../services/conversations.service';

const SPEAKER_COLORS = ['#3b82f6', '#8b5cf6', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4'];

interface EmotionProfilesProps {
  feedback: CommunicationFeedbackV4;
}

export function EmotionProfiles({ feedback }: EmotionProfilesProps) {
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
            Cada punta del radar es una emoción. Cuanto más grande el área, más presente está.
          </p>
          <EmotionRadarChart porHablante={emociones.por_hablante} hablantes={hablantes} />
          {emociones.lectura_emocional && (
            <div className="bg-blue-500/10 rounded-lg p-3 text-sm mt-3">
              <strong>Lectura:</strong> {emociones.lectura_emocional}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Individual speaker cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {speakers.map((speaker) => {
          const data = emociones.por_hablante[speaker];
          const idx = hablantes.indexOf(speaker);
          const color = SPEAKER_COLORS[(idx >= 0 ? idx : speakers.indexOf(speaker)) % SPEAKER_COLORS.length];

          return (
            <Card key={speaker} className="bg-card border-border">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
                  <h4 className="text-sm font-semibold text-foreground">{speaker}</h4>
                  {data.dominante && (
                    <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground ml-auto">
                      {data.dominante}
                    </span>
                  )}
                </div>
                <MiniRadar speakerData={data} color={color} />
                {data.subtexto && (
                  <p className="text-xs text-muted-foreground mt-1">{data.subtexto}</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
