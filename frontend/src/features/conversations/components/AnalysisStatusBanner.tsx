import { Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { type AnalysisPhase } from '../hooks/useAnalysisPolling';

interface AnalysisStatusBannerProps {
  phase: AnalysisPhase;
  hasV4: boolean;
  hasMinuta: boolean;
  retryCount: number;
  error: string | null;
  onRetry: () => void;
}

function PartialIndicator({ label, done }: { label: string; done: boolean }) {
  return (
    <Badge variant="outline" className={`text-xs gap-1 ${done ? 'text-green-600 border-green-300' : 'text-muted-foreground'}`}>
      {done ? '✓' : <Loader2 className="h-3 w-3 animate-spin" />}
      {label}
    </Badge>
  );
}

export function AnalysisStatusBanner({ phase, hasV4, hasMinuta, retryCount, error, onRetry }: AnalysisStatusBannerProps) {
  if (phase === 'idle' || phase === 'completed') return null;

  if (phase === 'polling') {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 mb-4">
        <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
        <span className="text-sm text-foreground flex-1">Analizando conversación...</span>
        <div className="flex items-center gap-2">
          <PartialIndicator label="Minuta" done={hasMinuta} />
          <PartialIndicator label="Análisis" done={hasV4} />
        </div>
      </div>
    );
  }

  if (phase === 'retrying') {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-amber-300/40 bg-amber-50/50 dark:bg-amber-900/10 px-4 py-3 mb-4">
        <RefreshCw className="h-4 w-4 animate-spin text-amber-600 shrink-0" />
        <span className="text-sm text-foreground flex-1">
          Reintentando análisis (intento {retryCount} de 2)...
        </span>
        <div className="flex items-center gap-2">
          <PartialIndicator label="Minuta" done={hasMinuta} />
          <PartialIndicator label="Análisis" done={hasV4} />
        </div>
      </div>
    );
  }

  // phase === 'failed'
  return (
    <div className="flex items-center gap-3 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 mb-4">
      <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="text-sm text-foreground">No se pudo completar el análisis</span>
        {error && <p className="text-xs text-muted-foreground mt-0.5 truncate">{error}</p>}
      </div>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
        Reintentar
      </Button>
    </div>
  );
}
