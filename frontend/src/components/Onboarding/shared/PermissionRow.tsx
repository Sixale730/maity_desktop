import React from 'react';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { PermissionRowProps } from '@/types/onboarding';

export function PermissionRow({ icon, title, description, status, isPending = false, onAction }: PermissionRowProps) {
  const isAuthorized = status === 'authorized';
  const isDenied = status === 'denied';
  const isChecking = isPending;

  const getButtonText = () => {
    if (isChecking) return 'Verificando...';
    if (isDenied) return 'Abrir Configuración';
    return 'Habilitar';
  };

  return (
    <div
      className={cn(
        'flex items-center justify-between rounded-2xl border px-6 py-5',
        'transition-all duration-200',
        isAuthorized ? 'border-foreground/60 bg-muted' : isDenied ? 'border-maity-pink/50 bg-maity-pink/10' : 'bg-card border-border'
      )}
    >
      {/* Left side: Icon + Info */}
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {/* Icon */}
        <div
          className={cn(
            'flex size-10 items-center justify-center rounded-full flex-shrink-0',
            isAuthorized ? 'bg-foreground/10' : isDenied ? 'bg-maity-pink/15' : 'bg-muted'
          )}
        >
          <div className={cn(isAuthorized ? 'text-foreground' : isDenied ? 'text-maity-pink' : 'text-muted-foreground')}>{icon}</div>
        </div>

        {/* Title + Description */}
        <div className="min-w-0 flex-1">
          <div className="font-medium truncate text-foreground">{title}</div>
          <div className="text-sm text-muted-foreground">
            {isAuthorized ? (
              <span className="text-emerald-600 dark:text-maity-green flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Acceso Otorgado
              </span>
            ) : isDenied ? (
              <span className="text-maity-pink flex items-center gap-1">
                <XCircle className="w-3.5 h-3.5" />
                Acceso Denegado - Por favor otórgalo en Configuración del Sistema
              </span>
            ) : (
              <span>{description}</span>
            )}
          </div>
        </div>
      </div>

      {/* Right side: Action button or checkmark */}
      <div className="flex items-center gap-2 flex-shrink-0 ml-3">
        {!isAuthorized && (
          <Button
            variant={isDenied ? "destructive" : "outline"}
            size="sm"
            onClick={onAction}
            disabled={isChecking}
            className="min-w-[100px]"
          >
            {isChecking && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {getButtonText()}
          </Button>
        )}
        {isAuthorized && (
          <div className="flex size-8 items-center justify-center rounded-full bg-maity-green/20">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-maity-green" />
          </div>
        )}
      </div>
    </div>
  );
}
