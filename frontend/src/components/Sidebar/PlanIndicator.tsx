'use client';

/**
 * Indicador compacto de plan/uso en el footer del sidebar.
 *
 * Estados:
 *  - Kill switch apagado, sin datos (offline/error) o plan ilimitado → null.
 *  - Trial: días restantes (+ horas de análisis si existe analysis_minutes).
 *  - Free: análisis de hoy disponible/usado (feature omi_conversation daily).
 *
 * Click → Settings tab "Mi plan". Colapsado → solo icono con tooltip.
 * Sin breakpoints md:/lg: (regla DPI Windows del repo).
 */
import { useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Gauge } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useAuth } from '@/contexts/AuthContext';
import {
  ANALYSIS_FEATURE,
  QUOTA_STATUS_QUERY_KEY,
  TRIAL_MINUTES_FEATURE,
  getQuotaFeature,
  isUnlimitedPlan,
  quotasActive,
  useEffectivePlan,
  useQuotaStatus,
} from '@/hooks/usePlanStatus';

interface PlanIndicatorProps {
  isCollapsed: boolean;
}

export function PlanIndicator({ isCollapsed }: PlanIndicatorProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { maityUser } = useAuth();
  const { data: quotaStatus } = useQuotaStatus();
  const { data: plan } = useEffectivePlan();

  // Refrescar el uso en cuanto un finalize termina (sin esperar el interval).
  useEffect(() => {
    if (!maityUser?.id) return;
    const onSyncChanged = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { jobType?: string; status?: string }
        | undefined;
      if (detail?.jobType === 'finalize_conversation' && detail?.status === 'completed') {
        queryClient.invalidateQueries({ queryKey: [QUOTA_STATUS_QUERY_KEY, maityUser.id] });
      }
    };
    window.addEventListener('sync-status-changed', onSyncChanged);
    return () => window.removeEventListener('sync-status-changed', onSyncChanged);
  }, [queryClient, maityUser?.id]);

  const label = useMemo(() => {
    if (!quotasActive(quotaStatus)) return null;

    const trialing = plan?.status === 'trialing';
    if (trialing) {
      const parts: string[] = [];
      if (plan?.trial_end) {
        const daysLeft = Math.max(
          0,
          Math.ceil((Date.parse(plan.trial_end) - Date.now()) / 86_400_000)
        );
        parts.push(`Prueba: ${daysLeft}d restantes`);
      } else {
        parts.push('Prueba activa');
      }
      const minutes = getQuotaFeature(quotaStatus, TRIAL_MINUTES_FEATURE);
      if (minutes && minutes.limit > 0) {
        const hoursLeft = Math.max(0, Math.floor((minutes.limit - minutes.used) / 60));
        parts.push(`${hoursLeft}h de análisis`);
      }
      return parts.join(' · ');
    }

    // Pro/Enterprise (o feature ausente): sin ruido en el sidebar.
    if (isUnlimitedPlan(quotaStatus)) return null;

    const analysis = getQuotaFeature(quotaStatus, ANALYSIS_FEATURE);
    if (!analysis) return null;
    const available = analysis.used < analysis.limit;
    const period = analysis.kind === 'daily' ? 'de hoy' : 'del mes';
    return available
      ? `Análisis ${period}: disponible`
      : `Análisis ${period}: usado`;
  }, [quotaStatus, plan]);

  if (!label) return null;

  const goToPlan = () => router.push('/settings?tab=plan');

  if (isCollapsed) {
    return (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={goToPlan}
              aria-label={label}
              className="flex items-center justify-center w-full py-2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <Gauge className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{label}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <button
      onClick={goToPlan}
      className="flex items-center gap-2 w-full px-3 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors border-t border-border"
    >
      <Gauge className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}
