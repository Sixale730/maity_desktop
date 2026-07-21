/**
 * Billing Types
 *
 * Manual interfaces for the maity.billing_* tables. Once supabase gen types
 * is re-run after migrations 20260512120000+ these will be available in
 * database-maity.types.ts and we can switch to importing the generated
 * Row types. For now, these are the source of truth in the frontend.
 *
 * The shapes mirror the migration files in supabase/migrations/.
 */

export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'incomplete'
  | 'incomplete_expired'
  | 'unpaid'
  | 'paused';

export type BillingSubjectType = 'user' | 'company';

export type PaymentTransactionType = 'charge' | 'refund' | 'credit' | 'adjustment' | 'manual_grant';

export interface BillingQuotas {
  [featureCode: string]: {
    monthly?: number;   // -1 = unlimited
    daily?: number;     // -1 = unlimited
    enabled?: boolean;
  };
}

export interface BillingPlan {
  id: string;
  code: string;                      // 'free' | 'pro' | 'enterprise'
  name: string;
  description: string | null;
  is_active: boolean;
  is_public: boolean;
  stripe_price_id_monthly: string | null;
  stripe_price_id_yearly: string | null;
  quotas: BillingQuotas;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

/**
 * Where the effective plan came from. 'admin_preview' = an admin has the
 * role preview active (maity.admin_preview_state) and is being treated as
 * a free-plan user end-to-end (orb + enforcement) until they switch back.
 */
export type EffectivePlanSource = 'company' | 'user' | 'default_free' | 'admin_preview';

export interface EffectivePlan {
  plan_id: string;
  plan_code: string;
  source: EffectivePlanSource;
  status: SubscriptionStatus | null;  // null when default_free / admin_preview
  quotas: BillingQuotas;
  trial_end: string | null;
  current_period_end: string | null;
}

/** Active role preview of the authenticated admin (admin_get_role_preview). */
export interface RolePreviewState {
  view_role: 'manager' | 'user';
  plan_code: string;                  // plan being simulated, always 'free' today
}

export interface QuotaCheckResult {
  can_use: boolean;
  reason: 'allowed' | 'enforcement_disabled' | 'no_user' | 'feature_disabled' | 'limit_reached';
  used: number;
  limit_val: number;                 // -1 = unlimited
  period_kind: 'monthly' | 'daily' | null;
  period_key: string | null;          // '2026-05' or '2026-05-12'
}

export interface PaymentTransaction {
  id: string;
  type: PaymentTransactionType;
  amount_cents: number;
  currency: string;
  status: string;                    // 'succeeded' | 'failed' | 'pending' | 'refunded'
  failure_reason: string | null;
  description: string | null;
  created_at: string;
  stripe_invoice_id: string | null;
}

export interface Invoice {
  id: string;
  total_cents: number;
  iva_cents: number;
  currency: string;
  cfdi_status: 'pending' | 'stamped' | 'canceled' | 'failed' | null;
  cfdi_uuid: string | null;
  cfdi_pdf_url: string | null;
  cfdi_xml_url: string | null;
  issued_at: string | null;
  paid_at: string | null;
}

export interface BillingFlags {
  enforcementEnabled: boolean;
  pricingPageVisible: boolean;
}

/**
 * One feature row from public.fn_quota_status(). kind='flag' features carry
 * only `enabled`; monthly/daily features carry used/limit/period_key.
 */
export interface QuotaStatusFeature {
  code: string;                       // 'voice_session' | 'omi_conversation' | ...
  kind: 'monthly' | 'daily' | 'flag';
  used?: number;
  limit?: number;                     // -1 = unlimited
  period_key?: string;                // '2026-06' or '2026-06-09'
  enabled: boolean;
}

/**
 * Trial state from maity.trial_status(), embedded in the quota snapshot (#132).
 *
 * Sigue viniendo con `exhausted: true` DESPUÉS de que el trial se agotó — para
 * entonces `plan_code` ya dice 'free', y sin este objeto la UI no podría
 * explicar por qué. `minutes_limit: -1` = sin tope de minutos (solo la fecha).
 */
export interface QuotaStatusTrial {
  is_trial: boolean;
  trial_start: string | null;
  trial_end: string | null;
  minutes_used: number;
  minutes_limit: number;
  exhausted: boolean;
  exhausted_reason: 'expired' | 'minutes' | null;
}

/**
 * Full quota snapshot for the credits orb. Unlike fn_check_quota, this
 * reports REAL usage even while billing_enforcement_enabled='false' —
 * `enforcement_enabled` tells the UI whether limits are being applied or
 * are informational only.
 */
export interface QuotaStatus {
  plan_code: string;
  source: EffectivePlanSource;
  enforcement_enabled: boolean;
  features: QuotaStatusFeature[];
  /** null cuando el usuario nunca tuvo trial. */
  trial?: QuotaStatusTrial | null;
}

/** Row of maity.system_config as returned by admin_get_billing_config(). */
export interface SystemConfigEntry {
  key: string;
  value: string;
  description: string | null;
  updated_at: string;
}

/** Payload of admin_get_billing_config() for the /admin/billing panel. */
export interface AdminBillingConfig {
  flags: SystemConfigEntry[];
  rate_limits: SystemConfigEntry[];
  plans: Array<Pick<BillingPlan, 'code' | 'name' | 'is_active' | 'is_public' | 'quotas'>>;
}

export interface SubscriptionResponse {
  plan: EffectivePlan | null;
  transactions: PaymentTransaction[];
  invoices: Invoice[];
}

export interface CheckoutInput {
  plan_code: 'pro';
  billing_period?: 'monthly' | 'yearly';
  /**
   * Admin-only escape hatch: forces Stripe test mode for this checkout.
   * The backend gates this with the `admin` role and returns 403 if any
   * other user passes it. Omit for normal end-user purchases.
   */
  mode?: 'test';
}
