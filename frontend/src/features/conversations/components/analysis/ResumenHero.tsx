'use client';

import { Card, CardContent } from '@/components/ui/card';
import { GaugeChart } from '../charts';
import type { CommunicationFeedbackV4, MeetingDimensionesV4 } from '../../services/conversations.service';

interface ResumenHeroProps {
  feedback: CommunicationFeedbackV4;
}

const DIMENSION_KEYS = ['claridad', 'proposito', 'emociones', 'estructura', 'persuasion', 'formalidad', 'muletillas', 'adaptacion'] as const;

function getDimensionScore(dims: MeetingDimensionesV4, key: typeof DIMENSION_KEYS[number]): number {
  switch (key) {
    case 'emociones': return Math.round((dims.emociones?.intensidad ?? 0) * 100);
    case 'muletillas': return dims.muletillas?.total != null ? Math.max(0, 100 - dims.muletillas.total * 5) : 0;
    default: return (dims[key] as { puntaje?: number })?.puntaje ?? 0;
  }
}
const DIMENSION_EMOJIS: Record<string, string> = {
  claridad: '💡', proposito: '🎯', emociones: '💚', estructura: '🧱',
  persuasion: '🗣️', formalidad: '👔', muletillas: '🔄', adaptacion: '🔀',
};
const DIMENSION_LABELS: Record<string, string> = {
  claridad: 'Claridad', proposito: 'Propósito', emociones: 'Emociones', estructura: 'Estructura',
  persuasion: 'Persuasión', formalidad: 'Formalidad', muletillas: 'Muletillas', adaptacion: 'Adaptación',
};

function getScoreColor(score: number): string {
  if (score >= 75) return 'text-emerald-400';
  if (score >= 50) return 'text-yellow-400';
  return 'text-red-400';
}

function getNivelColor(nivel: string): string {
  const l = nivel.toLowerCase();
  if (l.includes('excelente') || l.includes('sobresaliente')) return 'bg-emerald-500/20 text-emerald-300';
  if (l.includes('bueno') || l.includes('competente')) return 'bg-blue-500/20 text-blue-300';
  if (l.includes('aceptable') || l.includes('adecuado')) return 'bg-yellow-500/20 text-yellow-300';
  return 'bg-red-500/20 text-red-300';
}

export function ResumenHero({ feedback }: ResumenHeroProps) {
  const { resumen, calidad_global } = feedback;
  if (!resumen) return null;

  const score = resumen.puntuacion_global ?? calidad_global?.puntaje ?? 0;

  return (
    <Card className="bg-card border-border">
      <CardContent className="p-6">
        <div className="flex flex-col items-center gap-4">
          <GaugeChart score={score} maxScore={100} size={220} />

          {resumen.nivel && (
            <span className={`px-3 py-1 rounded-full text-sm font-semibold ${getNivelColor(resumen.nivel)}`}>
              {resumen.nivel}
            </span>
          )}

          {resumen.descripcion && (
            <p className="text-sm text-muted-foreground text-center max-w-md">{resumen.descripcion}</p>
          )}

          <div className="flex flex-wrap gap-3 justify-center">
            {resumen.fortaleza && (
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2 max-w-xs">
                <p className="text-xs font-semibold text-emerald-400 mb-0.5">Fortaleza: {resumen.fortaleza}</p>
                {resumen.fortaleza_hint && <p className="text-xs text-muted-foreground">{resumen.fortaleza_hint}</p>}
              </div>
            )}
            {resumen.mejorar && (
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 max-w-xs">
                <p className="text-xs font-semibold text-amber-400 mb-0.5">Mejorar: {resumen.mejorar}</p>
                {resumen.mejorar_hint && <p className="text-xs text-muted-foreground">{resumen.mejorar_hint}</p>}
              </div>
            )}
          </div>
        </div>

        {feedback.dimensiones && (
          <div className="grid grid-cols-4 gap-2 mt-6">
            {DIMENSION_KEYS.map((key) => {
              const puntaje = getDimensionScore(feedback.dimensiones, key);
              return (
                <div key={key} className="flex items-center gap-1.5 bg-muted/50 rounded-lg px-2 py-1.5">
                  <span className="text-sm">{DIMENSION_EMOJIS[key]}</span>
                  <span className="text-xs text-muted-foreground truncate">{DIMENSION_LABELS[key]}</span>
                  <span className={`text-xs font-bold ml-auto ${getScoreColor(puntaje)}`}>{puntaje}</span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
