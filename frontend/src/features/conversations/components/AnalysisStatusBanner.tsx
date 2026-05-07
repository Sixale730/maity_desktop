import { Loader2, AlertCircle, RefreshCw, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { AnalysisPhase } from '../utils/derivePhase';

interface AnalysisStatusBannerProps {
  phase: AnalysisPhase;
  onRetry?: () => void;
}

/**
 * Visual status of the analysis. Renders nothing for terminal happy states (completed/skipped/idle);
 * the rest of the page already shows the analysis itself in those cases.
 */
export function AnalysisStatusBanner({ phase, onRetry }: AnalysisStatusBannerProps) {
  if (phase === 'idle' || phase === 'completed' || phase === 'skipped') return null;

  if (phase === 'polling') {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 mb-4">
        <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
        <span className="text-sm text-foreground flex-1">Analizando conversación...</span>
      </div>
    );
  }

  if (phase === 'stalled') {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-amber-300/40 bg-amber-50/50 dark:bg-amber-900/10 px-4 py-3 mb-4">
        <Clock className="h-4 w-4 text-amber-600 shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-sm text-foreground">Tarda más de lo normal…</span>
          <p className="text-xs text-muted-foreground mt-0.5">El servidor todavía no devuelve resultado. Puedes esperar o reintentar.</p>
        </div>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Reintentar
          </Button>
        )}
      </div>
    );
  }

  // phase === 'failed'
  return (
    <div className="flex items-center gap-3 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 mb-4">
      <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="text-sm text-foreground">No se pudo completar el análisis</span>
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          Reintentar
        </Button>
      )}
    </div>
  );
}
