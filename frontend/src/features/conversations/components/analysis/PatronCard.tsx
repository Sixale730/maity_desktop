'use client';

import { Card, CardContent } from '@/components/ui/card';
import type { CommunicationFeedbackV4 } from '../../services/conversations.service';

const SENAL_ICONS = ['📊', '🔀', '💡', '🎯', '🔑'];

interface PatronCardProps {
  feedback: CommunicationFeedbackV4;
}

export function PatronCard({ feedback }: PatronCardProps) {
  const patron = feedback.patron;
  if (!patron) return null;

  return (
    <Card className="bg-card border-border">
      <CardContent className="p-5">
        <h3 className="text-base font-bold text-foreground mb-3">Patrón de Comunicación</h3>

        {patron.actual && (
          <p className="text-sm text-muted-foreground mb-3">{patron.actual}</p>
        )}

        {patron.senales && patron.senales.length > 0 && (
          <div className="mb-3">
            <p className="text-xs font-semibold text-muted-foreground mb-1.5">Señales detectadas</p>
            <div className="space-y-0.5">
              {patron.senales.map((s, i) => (
                <div key={i} className="flex items-start gap-2 py-1.5">
                  <span className="text-sm shrink-0">{SENAL_ICONS[i % SENAL_ICONS.length]}</span>
                  <span className="text-sm text-muted-foreground">
                    <strong className="text-foreground">Señal {i + 1}:</strong> {s}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {patron.evolucion && (
          <p className="text-sm italic text-muted-foreground/80 mb-3">{patron.evolucion}</p>
        )}

        {patron.que_cambiaria && (
          <div className="bg-muted/50 rounded-lg p-3 text-sm">
            <strong className="text-cyan-400">¿Qué cambiar?</strong>{' '}
            <span className="text-muted-foreground">{patron.que_cambiaria}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
