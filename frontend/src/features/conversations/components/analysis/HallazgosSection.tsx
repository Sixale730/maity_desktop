'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { CommunicationFeedbackV4, Hallazgo } from '../../services/conversations.service';

const DIMENSION_COLORS: Record<string, string> = {
  claridad: 'bg-blue-500/20 text-blue-300',
  proposito: 'bg-purple-500/20 text-purple-300',
  emociones: 'bg-pink-500/20 text-pink-300',
  estructura: 'bg-cyan-500/20 text-cyan-300',
  persuasion: 'bg-amber-500/20 text-amber-300',
  formalidad: 'bg-emerald-500/20 text-emerald-300',
  muletillas: 'bg-orange-500/20 text-orange-300',
  adaptacion: 'bg-indigo-500/20 text-indigo-300',
};

const IMPACT_STYLES: Record<string, string> = {
  positivo: 'border-l-emerald-500',
  negativo: 'border-l-red-500',
  neutro: 'border-l-gray-500',
};

interface HallazgosSectionProps {
  feedback: CommunicationFeedbackV4;
}

export function HallazgosSection({ feedback }: HallazgosSectionProps) {
  if (!feedback.dimensiones) return null;

  // Collect all hallazgos grouped by dimension
  const grouped: { dimension: string; hallazgos: Hallazgo[] }[] = [];

  for (const [key, dim] of Object.entries(feedback.dimensiones)) {
    const d = dim as { hallazgos?: Hallazgo[] };
    if (d.hallazgos && d.hallazgos.length > 0) {
      grouped.push({ dimension: key, hallazgos: d.hallazgos });
    }
  }

  if (grouped.length === 0) return null;

  return (
    <Card className="bg-card border-border">
      <CardContent className="p-5">
        <h3 className="text-base font-bold text-foreground mb-1">Hallazgos por Dimensión</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Evidencia concreta de tu comunicación, organizada por área.
        </p>

        <div className="space-y-4">
          {grouped.map(({ dimension, hallazgos }) => (
            <div key={dimension}>
              <Badge className={`mb-2 ${DIMENSION_COLORS[dimension] ?? 'bg-muted text-muted-foreground'}`}>
                {dimension.charAt(0).toUpperCase() + dimension.slice(1)}
              </Badge>

              <div className="space-y-2 ml-1">
                {hallazgos.map((h, i) => (
                  <div
                    key={i}
                    className={`border-l-2 pl-3 py-1.5 ${IMPACT_STYLES[h.tipo] ?? 'border-l-gray-500'}`}
                  >
                    <p className="text-sm text-foreground">{h.texto}</p>
                    {h.cita && (
                      <blockquote className="text-xs text-muted-foreground italic mt-1 pl-2 border-l border-muted">
                        &ldquo;{h.cita}&rdquo;
                      </blockquote>
                    )}
                    {h.alternativa && (
                      <p className="text-xs text-emerald-400 mt-1">💡 {h.alternativa}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
