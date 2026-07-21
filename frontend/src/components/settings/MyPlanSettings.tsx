'use client';

/**
 * Sección "Mi plan" de Configuración: plan actual, uso del período, countdown
 * del trial y CTA de upgrade. Visible para todos los roles.
 *
 * Con el kill switch de billing apagado (o sin datos) muestra solo el nombre
 * del plan con una nota — nunca bloquea ni asusta (fail-open).
 */
import { invoke } from '@tauri-apps/api/core';
import { Check, CreditCard, ExternalLink, Loader2, Lock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PRICING_URL } from '@/lib/quotaErrors';
import {
  quotasActive,
  useEffectivePlan,
  useQuotaStatus,
  type QuotaFeature,
} from '@/hooks/usePlanStatus';

const PLAN_LABELS: Record<string, string> = {
  free: 'Free',
  pro: 'Pro',
  enterprise: 'Enterprise',
  trial: 'Prueba',
};

const FEATURE_LABELS: Record<string, string> = {
  omi_conversation: 'Análisis de conversaciones',
  analysis_minutes: 'Minutos de análisis (prueba)',
  maity_chat: 'Mensajes de Maity Chat',
  game_session: 'Sesiones de juego',
  voice_session: 'Roleplays de voz',
  presenter_mode: 'Modo ponente',
  tech_week: 'Tech Week',
  coach_diagnostic: 'Diagnóstico del coach',
  learning_path_premium: 'Ruta de aprendizaje premium',
  custom_voice_agents: 'Agentes de voz personalizados',
  sso: 'SSO empresarial',
};

function featureLabel(code: string): string {
  return FEATURE_LABELS[code] ?? code;
}

function periodLabel(kind: QuotaFeature['kind']): string {
  return kind === 'daily' ? 'hoy' : 'este mes';
}

function UsageRow({ feature }: { feature: QuotaFeature }) {
  if (feature.kind === 'flag') {
    return (
      <div className="flex items-center justify-between py-2">
        <span className="text-sm text-foreground">{featureLabel(feature.code)}</span>
        {feature.enabled ? (
          <Check className="h-4 w-4 text-primary" />
        ) : (
          <Lock className="h-4 w-4 text-muted-foreground" />
        )}
      </div>
    );
  }

  const unlimited = feature.limit === -1;
  const pct = unlimited
    ? 0
    : Math.min(100, Math.round((feature.used / Math.max(1, feature.limit)) * 100));

  return (
    <div className="py-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm text-foreground">{featureLabel(feature.code)}</span>
        <span className="text-xs text-muted-foreground">
          {unlimited
            ? 'Ilimitado'
            : `${feature.used} / ${feature.limit} ${periodLabel(feature.kind)}`}
        </span>
      </div>
      {!unlimited && (
        <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

export function MyPlanSettings() {
  const { data: quotaStatus, isLoading: quotaLoading } = useQuotaStatus();
  const { data: plan, isLoading: planLoading } = useEffectivePlan();

  const loading = quotaLoading || planLoading;
  const active = quotasActive(quotaStatus);
  const planCode = plan?.plan_code ?? quotaStatus?.plan_code ?? 'free';
  const planName = PLAN_LABELS[planCode] ?? planCode;
  const trialing = plan?.status === 'trialing';

  const trialDaysLeft =
    trialing && plan?.trial_end
      ? Math.max(0, Math.ceil((Date.parse(plan.trial_end) - Date.now()) / 86_400_000))
      : null;

  const openPricing = () => {
    void invoke('open_external_url', { url: PRICING_URL });
  };

  if (loading) {
    return (
      <div className="flex items-center gap-3 py-12 justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm">Cargando tu plan...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Plan actual */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CreditCard className="h-5 w-5 text-primary" />
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-semibold text-foreground">Plan {planName}</h3>
                  {trialing && <Badge variant="secondary">Prueba</Badge>}
                </div>
                {trialing && trialDaysLeft !== null && (
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {trialDaysLeft > 0
                      ? `Tu prueba termina en ${trialDaysLeft} día${trialDaysLeft === 1 ? '' : 's'}`
                      : 'Tu prueba termina hoy'}
                  </p>
                )}
                {!trialing && plan?.current_period_end && (
                  <p className="text-sm text-muted-foreground mt-0.5">
                    Período actual hasta{' '}
                    {new Date(plan.current_period_end).toLocaleDateString('es-MX', {
                      day: 'numeric',
                      month: 'long',
                    })}
                  </p>
                )}
              </div>
            </div>
            <Button onClick={openPricing}>
              Ver planes y precios
              <ExternalLink className="h-3.5 w-3.5 ml-2" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Uso del período */}
      {active && quotaStatus && quotaStatus.features.length > 0 ? (
        <Card>
          <CardContent className="p-6">
            <h4 className="text-sm font-medium text-foreground mb-2">Uso de tu plan</h4>
            <div className="divide-y divide-border">
              {quotaStatus.features.map((feature) => (
                <UsageRow key={feature.code} feature={feature} />
              ))}
            </div>
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm text-muted-foreground px-1">
          Los límites de plan no están activos en tu cuenta.
        </p>
      )}
    </div>
  );
}
