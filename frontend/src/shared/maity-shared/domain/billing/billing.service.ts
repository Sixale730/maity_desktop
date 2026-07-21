/**
 * Billing Service
 *
 * Static class that wraps Supabase RPC calls and POSTs to /api/billing/*.
 * Same DI pattern as other shared services: methods that hit the backend
 * API take `apiUrl` as a parameter, methods that hit the DB directly use
 * the singleton supabase client.
 */

import { supabase } from '../../api/client/supabase';
import type {
  AdminBillingConfig,
  BillingFlags,
  BillingPlan,
  BillingQuotas,
  EffectivePlan,
  QuotaCheckResult,
  QuotaStatus,
  RolePreviewState,
  SubscriptionResponse,
  SystemConfigEntry,
  CheckoutInput,
} from './billing.types';

export class BillingService {
  // ==========================================================================
  // Direct DB / RPC
  // ==========================================================================

  /**
   * Resolves the user's effective plan via the public.my_effective_plan() RPC
   * (which calls the SECURITY DEFINER chain into maity.effective_plan_for_user).
   */
  static async getMyEffectivePlan(): Promise<EffectivePlan | null> {
    const { data, error } = await supabase.rpc('my_effective_plan');
    if (error) throw error;
    if (!data || (Array.isArray(data) && data.length === 0)) return null;
    return Array.isArray(data) ? (data[0] as EffectivePlan) : (data as EffectivePlan);
  }

  /**
   * Checks if the user can use a feature right now. Honors the
   * billing_enforcement_enabled kill switch — returns
   * { can_use: true, reason: 'enforcement_disabled' } when OFF.
   */
  static async checkQuota(featureCode: string): Promise<QuotaCheckResult> {
    const { data, error } = await supabase.rpc('fn_check_quota', {
      p_feature_code: featureCode,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return row as QuotaCheckResult;
  }

  /**
   * Full quota snapshot for the credits orb: every feature of the user's
   * effective plan with real usage, regardless of the enforcement kill
   * switch (fn_quota_status is read-only and not gated by it).
   */
  static async getQuotaStatus(): Promise<QuotaStatus | null> {
    const { data, error } = await supabase.rpc('fn_quota_status');
    if (error) throw error;
    return (data as QuotaStatus | null) ?? null;
  }

  // ==========================================================================
  // Admin console (/admin/billing) — RPCs gated server-side with
  // FORBIDDEN_ADMIN_ONLY. No Vercel endpoint involved (12/12 budget intact).
  // ==========================================================================

  static async getAdminBillingConfig(): Promise<AdminBillingConfig> {
    const { data, error } = await supabase.rpc('admin_get_billing_config');
    if (error) throw error;
    return data as AdminBillingConfig;
  }

  static async updateSystemConfig(key: string, value: string): Promise<SystemConfigEntry> {
    const { data, error } = await supabase.rpc('admin_update_system_config', {
      p_key: key,
      p_value: value,
    });
    if (error) throw error;
    return data as SystemConfigEntry;
  }

  static async updatePlanQuotas(
    planCode: string,
    quotas: BillingQuotas
  ): Promise<{ code: string; quotas: BillingQuotas }> {
    const { data, error } = await supabase.rpc('admin_update_plan_quotas', {
      p_plan_code: planCode,
      p_quotas: quotas,
    });
    if (error) throw error;
    return data as { code: string; quotas: BillingQuotas };
  }

  /**
   * Active role preview of the authenticated admin, or null. Used by
   * ViewRoleContext on mount to restore the preview after a reload
   * (the row in maity.admin_preview_state is the source of truth).
   * Returns null for non-admins (the RPC doesn't raise).
   */
  static async getRolePreview(): Promise<RolePreviewState | null> {
    const { data, error } = await supabase.rpc('admin_get_role_preview');
    if (error) throw error;
    return (data as RolePreviewState | null) ?? null;
  }

  /**
   * Activates ('manager'/'user') or clears (null) the admin's role preview.
   * While active, effective_plan_for_user resolves to the FREE plan with
   * source='admin_preview' — the credits orb AND quota enforcement treat
   * the admin as a real free user. Server-side gated (FORBIDDEN_ADMIN_ONLY).
   */
  static async setRolePreview(
    viewRole: 'manager' | 'user' | null
  ): Promise<RolePreviewState | null> {
    const { data, error } = await supabase.rpc('admin_set_role_preview', {
      p_view_role: viewRole,
    });
    if (error) throw error;
    return (data as RolePreviewState | null) ?? null;
  }

  /**
   * Reads the two billing flags from maity.system_config. The table is
   * world-readable (authenticated SELECT policy).
   */
  static async getBillingFlags(): Promise<BillingFlags> {
    const { data, error } = await supabase
      .schema('maity')
      .from('system_config')
      .select('key, value')
      .in('key', ['billing_enforcement_enabled', 'billing_pricing_page_visible']);

    if (error) throw error;

    const flags: BillingFlags = {
      enforcementEnabled: false,
      pricingPageVisible: false,
    };
    for (const row of data ?? []) {
      if (row.key === 'billing_enforcement_enabled') {
        flags.enforcementEnabled = row.value === 'true';
      } else if (row.key === 'billing_pricing_page_visible') {
        flags.pricingPageVisible = row.value === 'true';
      }
    }
    return flags;
  }

  /**
   * Lists active public plans for the pricing page (Free, Pro). Enterprise
   * is `is_public=false` and stays hidden from end users.
   */
  static async listPublicPlans(): Promise<BillingPlan[]> {
    const { data, error } = await supabase
      .schema('maity')
      .from('billing_plans')
      .select('*')
      .eq('is_active', true)
      .eq('is_public', true)
      .order('sort_order', { ascending: true });
    if (error) throw error;
    return (data ?? []) as BillingPlan[];
  }

  // ==========================================================================
  // Backend API calls
  // ==========================================================================

  /**
   * Returns the Stripe Checkout URL the frontend should navigate to.
   *
   * Backend lives at /api/billing?action=checkout — the 4 billing endpoints
   * were consolidated into one router to stay within Vercel Hobby's
   * 12-function limit. See commit history for rationale.
   */
  static async createCheckoutSession(
    apiUrl: string,
    input: CheckoutInput
  ): Promise<{ url: string; session_id: string }> {
    return BillingService.postWithAuth(`${apiUrl}/api/billing?action=checkout`, input);
  }

  /**
   * Returns the Stripe Customer Portal URL the frontend should navigate to.
   */
  static async createPortalSession(apiUrl: string): Promise<{ url: string }> {
    return BillingService.postWithAuth(`${apiUrl}/api/billing?action=portal`, {});
  }

  /**
   * Fetches subscription state + recent transactions + invoices for the
   * My Subscription page.
   */
  static async getSubscription(apiUrl: string): Promise<SubscriptionResponse> {
    const token = await BillingService.getAuthToken();
    const res = await fetch(`${apiUrl}/api/billing?action=subscription`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Subscription fetch failed: ${res.status}`);
    }
    return (await res.json()) as SubscriptionResponse;
  }

  // ==========================================================================
  // Pure helpers (no I/O)
  // ==========================================================================

  static formatPlanPrice(cents: number, currency = 'MXN'): string {
    const amount = cents / 100;
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency }).format(amount);
  }

  static isQuotaUnlimited(value: number | undefined | null): boolean {
    return value === -1;
  }

  // ==========================================================================
  // Private auth helper
  // ==========================================================================

  private static async getAuthToken(): Promise<string> {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) {
      throw new Error('Not authenticated');
    }
    return session.access_token;
  }

  private static async postWithAuth<T>(url: string, body: unknown): Promise<T> {
    const token = await BillingService.getAuthToken();
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Request failed: ${res.status}`);
    }
    return (await res.json()) as T;
  }
}
