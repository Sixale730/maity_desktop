import { Calendar, CheckCircle2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { CommunicationFeedback } from '../../services/conversations.service';

function extractAccionText(item: unknown): { descripcion: string; tiene_fecha: boolean } {
  if (typeof item === 'string') return { descripcion: item, tiene_fecha: false };
  if (typeof item === 'object' && item !== null) {
    const obj = item as Record<string, unknown>;
    return {
      descripcion: typeof obj.descripcion === 'string' ? obj.descripcion : String(obj.descripcion ?? ''),
      tiene_fecha: obj.tiene_fecha === true,
    };
  }
  return { descripcion: String(item), tiene_fecha: false };
}

function extractPendienteText(item: unknown): { tema: string; razon: string } {
  if (typeof item === 'string') return { tema: item, razon: '' };
  if (typeof item === 'object' && item !== null) {
    const obj = item as Record<string, unknown>;
    return {
      tema: typeof obj.tema === 'string' ? obj.tema : String(obj.tema ?? ''),
      razon: typeof obj.razon === 'string' ? obj.razon : '',
    };
  }
  return { tema: String(item), razon: '' };
}

interface TemasSectionProps {
  feedback: CommunicationFeedback;
}

export function TemasSection({ feedback }: TemasSectionProps) {
  const temas = feedback.temas;
  if (!temas) return null;

  const hasTemas = temas.temas_tratados && temas.temas_tratados.length > 0;
  const hasAcciones = temas.acciones_usuario && temas.acciones_usuario.length > 0;
  const hasPendientes = temas.temas_sin_cerrar && temas.temas_sin_cerrar.length > 0;

  if (!hasTemas && !hasAcciones && !hasPendientes) return null;

  return (
    <div className="space-y-6">
      {/* Temas tratados */}
      {hasTemas && (
        <div className="space-y-2">
          <h3 className="text-base font-semibold text-foreground">Temas Tratados</h3>
          <div className="flex flex-wrap gap-2">
            {temas.temas_tratados!.map((tema, i) => (
              <Badge key={i} variant="secondary" className="text-sm">
                {typeof tema === 'string' ? tema : String(tema)}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Compromisos */}
      {hasAcciones && (
        <div className="space-y-2">
          <h3 className="text-base font-semibold text-foreground">Compromisos del Usuario</h3>
          <ul className="space-y-2">
            {temas.acciones_usuario!.map((item, i) => {
              const { descripcion, tiene_fecha } = extractAccionText(item);
              return (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <Calendar
                    className={`h-4 w-4 mt-0.5 flex-shrink-0 ${tiene_fecha ? 'text-green-500' : 'text-muted-foreground/40'}`}
                  />
                  <span className="text-muted-foreground">{descripcion}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Temas sin cerrar */}
      {hasPendientes && (
        <div className="space-y-2">
          <h3 className="text-base font-semibold text-foreground">Temas Sin Cerrar</h3>
          <div className="space-y-2">
            {temas.temas_sin_cerrar!.map((item, i) => {
              const { tema, razon } = extractPendienteText(item);
              return (
                <div
                  key={i}
                  className="rounded-lg border border-border bg-card p-3"
                  style={{ borderLeftWidth: '3px', borderLeftColor: '#f59e0b' }}
                >
                  <div className="text-sm font-medium text-foreground">{tema}</div>
                  {razon && (
                    <div className="text-xs text-muted-foreground mt-1">{razon}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
