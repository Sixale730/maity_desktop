/**
 * Hooks de plan de pago y cuotas.
 *
 * Leen los wrappers RPC de `public` (grant a `authenticated` verificado):
 *   - public.fn_quota_status()  → uso por feature del período actual
 *   - public.my_effective_plan() → plan efectivo (trial_end, current_period_end)
 *
 * OJO: el cliente supabase del desktop usa schema 'maity' por default y las
 * versiones maity.* de estas funciones son service_role-only → SIEMPRE llamar
 * vía supabase.schema('public').rpc(...).
 *
 * Filosofía fail-open: el enforcement real vive en la nube. Si estamos
 * offline, el RPC falla o el kill switch está apagado, la UI de plan se
 * oculta y ningún gate bloquea nada.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

export type QuotaFeatureKind = 'flag' | 'daily' | 'monthly';

export interface QuotaFeature {
  code: string;
  kind: QuotaFeatureKind;
  enabled: boolean;
  used: number;
  limit: number; // -1 = ilimitado
  period_key: string | null;
}

export interface QuotaStatus {
  plan_code: string;
  source: string;
  enforcement_enabled: boolean;
  features: QuotaFeature[];
}

export interface EffectivePlan {
  plan_code: string;
  source: string;
  status: string; // 'trialing' = trial activo
  quotas: Record<string, unknown> | null;
  trial_end: string | null;
  current_period_end: string | null;
}

/** Feature codes del catálogo de billing_plans (contrato con issue maity#132). */
export const ANALYSIS_FEATURE = 'omi_conversation';
export const PRESENTER_MODE_FEATURE = 'presenter_mode';
export const TRIAL_MINUTES_FEATURE = 'analysis_minutes';

export const QUOTA_STATUS_QUERY_KEY = 'quota-status';
export const EFFECTIVE_PLAN_QUERY_KEY = 'effective-plan';

function normalizeQuotaStatus(data: unknown): QuotaStatus | null {
  if (!data || typeof data !== 'object') return null;
  const raw = data as Record<string, unknown>;
  const rawFeatures = Array.isArray(raw.features) ? raw.features : [];
  const features: QuotaFeature[] = [];
  for (const f of rawFeatures) {
    if (!f || typeof f !== 'object') continue;
    const rf = f as Record<string, unknown>;
    if (typeof rf.code !== 'string') continue;
    const kind = rf.kind === 'daily' || rf.kind === 'monthly' ? rf.kind : 'flag';
    features.push({
      code: rf.code,
      kind,
      enabled: rf.enabled !== false,
      used: typeof rf.used === 'number' ? rf.used : 0,
      limit: typeof rf.limit === 'number' ? rf.limit : -1,
      period_key: typeof rf.period_key === 'string' ? rf.period_key : null,
    });
  }
  return {
    plan_code: typeof raw.plan_code === 'string' ? raw.plan_code : 'unknown',
    source: typeof raw.source === 'string' ? raw.source : 'unknown',
    enforcement_enabled: raw.enforcement_enabled !== false,
    features,
  };
}

function normalizeEffectivePlan(data: unknown): EffectivePlan | null {
  // my_effective_plan es RETURNS TABLE → llega como array de una fila.
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') return null;
  const raw = row as Record<string, unknown>;
  return {
    plan_code: typeof raw.plan_code === 'string' ? raw.plan_code : 'unknown',
    source: typeof raw.source === 'string' ? raw.source : 'unknown',
    status: typeof raw.status === 'string' ? raw.status : 'unknown',
    quotas:
      raw.quotas && typeof raw.quotas === 'object'
        ? (raw.quotas as Record<string, unknown>)
        : null,
    trial_end: typeof raw.trial_end === 'string' ? raw.trial_end : null,
    current_period_end:
      typeof raw.current_period_end === 'string' ? raw.current_period_end : null,
  };
}

/** Uso por feature del período actual. Refresca solo (staleTime 60s + interval 5min). */
export function useQuotaStatus() {
  const { maityUser } = useAuth();
  return useQuery<QuotaStatus | null>({
    queryKey: [QUOTA_STATUS_QUERY_KEY, maityUser?.id],
    queryFn: async () => {
      const { data, error } = await supabase.schema('public').rpc('fn_quota_status');
      if (error) throw error;
      return normalizeQuotaStatus(data);
    },
    enabled: !!maityUser?.id,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    retry: 1,
  });
}

/** Plan efectivo (para trial countdown y nombre del plan). */
export function useEffectivePlan() {
  const { maityUser } = useAuth();
  return useQuery<EffectivePlan | null>({
    queryKey: [EFFECTIVE_PLAN_QUERY_KEY, maityUser?.id],
    queryFn: async () => {
      const { data, error } = await supabase.schema('public').rpc('my_effective_plan');
      if (error) throw error;
      return normalizeEffectivePlan(data);
    },
    enabled: !!maityUser?.id,
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

// ---------------------------------------------------------------------------
// Helpers puros (usables fuera de React vía queryClient.getQueryData)
// ---------------------------------------------------------------------------

export function getQuotaFeature(
  qs: QuotaStatus | null | undefined,
  code: string
): QuotaFeature | undefined {
  return qs?.features.find((f) => f.code === code);
}

/**
 * ¿El plan permite usar la feature ahora mismo?
 * FAIL-OPEN por diseño: sin datos (offline/error/loading), kill switch apagado
 * o feature ausente del catálogo → true. El servidor es quien enforza.
 */
export function isFeatureEnabled(
  qs: QuotaStatus | null | undefined,
  code: string
): boolean {
  if (!qs || qs.enforcement_enabled === false) return true;
  const feature = getQuotaFeature(qs, code);
  if (!feature) return true;
  if (feature.kind === 'flag') return feature.enabled;
  if (!feature.enabled) return false;
  return feature.limit === -1 || feature.used < feature.limit;
}

/** ¿Hay cuotas activas que valga la pena mostrar en UI? (kill switch global) */
export function quotasActive(qs: QuotaStatus | null | undefined): boolean {
  return !!qs && qs.enforcement_enabled !== false;
}

/** ¿El plan es ilimitado en análisis? (pro/enterprise → sin indicador en UI) */
export function isUnlimitedPlan(qs: QuotaStatus | null | undefined): boolean {
  if (!qs) return true;
  const analysis = getQuotaFeature(qs, ANALYSIS_FEATURE);
  return !analysis || analysis.limit === -1;
}
