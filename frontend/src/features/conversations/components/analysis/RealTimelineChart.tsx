'use client';

import { Card, CardContent } from '@/components/ui/card';
import { TimelineChart } from '../charts';
import type { CommunicationFeedbackV4 } from '../../services/conversations.service';

interface RealTimelineChartProps {
  feedback: CommunicationFeedbackV4;
  speakerNameMap?: Record<string, string>;
}

export function RealTimelineChart({ feedback, speakerNameMap }: RealTimelineChartProps) {
  const { timeline, meta } = feedback;
  if (!timeline?.segmentos || timeline.segmentos.length === 0) return null;
  if (!meta) return null;

  return (
    <Card className="bg-card border-border">
      <CardContent className="p-5">
        <h3 className="text-base font-bold text-foreground mb-1">Línea Temporal</h3>
        <p className="text-sm text-muted-foreground mb-3">
          Cada segmento muestra quién habla. Los segmentos verdes son diálogo real.
        </p>

        <TimelineChart timeline={timeline} meta={meta} speakerNameMap={speakerNameMap} />

        <div className="bg-green-500/10 rounded-lg p-3 text-sm mt-3">
          <strong>Tip:</strong> Intercala preguntas cada 5 minutos para generar más diálogo.
          Los bloques largos de un solo color indican monólogo.
        </div>
      </CardContent>
    </Card>
  );
}
