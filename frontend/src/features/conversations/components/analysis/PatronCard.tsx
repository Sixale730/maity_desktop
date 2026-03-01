'use client';

import { Card, CardContent } from '@/components/ui/card';
import type { CommunicationFeedbackV4 } from '../../services/conversations.service';

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

        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1 rounded-lg bg-blue-500/10 border border-blue-500/20 p-3">
            <p className="text-xs text-blue-400 font-semibold mb-1">Actual</p>
            <p className="text-sm text-foreground">{patron.actual}</p>
          </div>
          <span className="text-muted-foreground text-lg">→</span>
          <div className="flex-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-3">
            <p className="text-xs text-emerald-400 font-semibold mb-1">Evolución</p>
            <p className="text-sm text-foreground">{patron.evolucion}</p>
          </div>
        </div>

        {patron.senales && patron.senales.length > 0 && (
          <div className="mb-3">
            <p className="text-xs font-semibold text-muted-foreground mb-1.5">Señales detectadas</p>
            <div className="flex flex-wrap gap-1.5">
              {patron.senales.map((s, i) => (
                <span key={i} className="text-xs px-2 py-1 rounded-full bg-muted text-muted-foreground">
                  {s}
                </span>
              ))}
            </div>
          </div>
        )}

        {patron.que_cambiaria && (
          <div className="bg-amber-500/10 rounded-lg p-3 text-sm">
            <strong className="text-amber-400">¿Qué cambiar?</strong>{' '}
            <span className="text-muted-foreground">{patron.que_cambiaria}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
