import type { SupabaseClient } from '@supabase/supabase-js';

export type UserRole = 'admin' | 'manager' | 'user';

export const ADMIN_DOMAINS = ['asertio.mx', 'maity.cloud'];

export function isAdmin(role: UserRole): boolean {
  return role === 'admin';
}

export function isManager(role: UserRole): boolean {
  return role === 'manager';
}

/**
 * Fallback: derive role from email domain.
 * Returns 'admin' if domain is in ADMIN_DOMAINS, otherwise 'user'.
 */
export function getUserRoleFromEmail(email: string | null | undefined): UserRole {
  if (!email) return 'user';
  const domain = email.split('@')[1]?.toLowerCase();
  return domain && ADMIN_DOMAINS.includes(domain) ? 'admin' : 'user';
}

/**
 * Primary source of truth: fetch role from Supabase RPC.
 * Returns the role string or null on failure.
 */
export async function getUserRoleFromRPC(supabase: SupabaseClient): Promise<UserRole | null> {
  try {
    const { data, error } = await supabase.rpc('get_user_role');
    if (error || !data) return null;
    const role = String(data).toLowerCase();
    if (role === 'admin' || role === 'manager' || role === 'user') {
      return role;
    }
    return null;
  } catch {
    return null;
  }
}
