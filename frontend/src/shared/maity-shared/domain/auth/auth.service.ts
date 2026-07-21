import { supabase } from '../../api/client/supabase';
import type { UserRole, UserPhase, UserStatus, PostLoginOptions, PostLoginResult } from './auth.types';
import type { Session, User } from '@supabase/supabase-js';
import { hasProperty } from '../../types/supabase-helpers';
import { AutojoinService } from '../organizations/autojoin.service';

/**
 * AuthService - Encapsulates authentication and user status operations
 */
export class AuthService {
  /**
   * Ensures the user exists in the database
   * Creates user record if it doesn't exist
   */
  static async ensureUser(): Promise<void> {
    const { error } = await supabase.rpc('ensure_user');
    if (error) {
      console.error('Error ensuring user exists:', error);
      throw error;
    }
  }

  /**
   * Gets the roles for the current authenticated user
   * @returns Array of user roles (admin, manager, user)
   */
  static async getMyRoles(): Promise<UserRole[]> {
    const { data, error } = await supabase.rpc('my_roles');
    if (error) {
      console.error('Error getting user roles:', error);
      throw error;
    }
    return (data ?? []) as UserRole[];
  }

  /**
   * Returns true if the user's company has beta_access=true.
   * Used to expose features to regular `user` testers without granting admin.
   * Fail-safe: returns false on any error so the user falls back to their
   * normal role-based visibility.
   */
  static async getMyBetaAccess(): Promise<boolean> {
    const { data, error } = await supabase.rpc('my_beta_access');
    if (error) {
      console.error('Error getting beta access:', error);
      return false;
    }
    return Boolean(data);
  }

  /**
   * Gets the current phase of the authenticated user
   * @returns User phase (ACTIVE, REGISTRATION, NO_COMPANY, PENDING, UNAUTHORIZED)
   */
  static async getMyPhase(): Promise<UserPhase> {
    const { data, error } = await supabase.rpc('my_phase');
    if (error) {
      console.error('Error getting user phase:', error);
      throw error;
    }

    // Handle different response formats
    // RPC returns string directly, but handle legacy object/array formats for backwards compatibility
    let phase: string;
    if (typeof data === 'string') {
      phase = data.toUpperCase();
    } else if (data && typeof data === 'object' && hasProperty(data, 'phase')) {
      phase = String((data as Record<string, unknown>).phase).toUpperCase();
    } else if (Array.isArray(data) && data[0] && hasProperty(data[0], 'phase')) {
      phase = String((data[0] as Record<string, unknown>).phase).toUpperCase();
    } else {
      phase = '';
    }

    return phase as UserPhase;
  }

  /**
   * Gets the current status of the authenticated user
   * @returns User status object with registration and company info
   */
  static async getMyStatus(): Promise<UserStatus[]> {
    const { data, error } = await supabase.rpc('my_status');
    if (error) {
      console.error('Error getting user status:', error);
      throw error;
    }
    return (data ?? []) as UserStatus[];
  }

  /**
   * Marks the onboarding as complete for the current user
   */
  static async completeOnboarding(): Promise<void> {
    const { error } = await supabase.rpc('complete_onboarding');
    if (error) {
      console.error('Error completing onboarding:', error);
      throw error;
    }
  }

  /**
   * Gets the current user's session
   */
  static async getSession(): Promise<Session | null> {
    const { data: { session } } = await supabase.auth.getSession();
    return session;
  }

  /**
   * Gets the current authenticated user
   */
  static async getUser(): Promise<User | null> {
    const { data: { user } } = await supabase.auth.getUser();
    return user;
  }

  /**
   * Gets the role for the current authenticated user
   * @returns User role (admin, manager, or user)
   */
  static async getUserRole(): Promise<UserRole> {
    const { data, error } = await supabase.rpc('get_user_role');
    if (error) {
      console.error('Error getting user role:', error);
      throw error;
    }
    return (data ?? 'user') as UserRole;
  }

  /**
   * Marks the platform tour as completed for the current user
   */
  static async markTourCompleted(): Promise<void> {
    const { error } = await supabase.rpc('mark_tour_completed');
    if (error) {
      console.error('Error marking tour completed:', error);
      throw error;
    }
  }

  /**
   * Checks if a user with the given email exists in the system
   * @param email - Email address to check
   * @returns true if user exists, false otherwise
   */
  static async checkUserExistsByEmail(email: string): Promise<boolean> {
    const { data, error } = await supabase.rpc('check_user_exists_by_email', {
      p_email: email
    });

    if (error) {
      console.error('Error checking if user exists:', error);
      // On error, return true to avoid false positives (fail safe)
      return true;
    }

    return data === true;
  }

  /**
   * Handles all post-login processing for both OAuth and email/password flows
   *
   * This centralizes the logic for:
   * - Ensuring user exists in database
   * - Attempting domain-based autojoin
   * - Determining user phase and roles
   * - Calculating appropriate redirect destination
   *
   * @param options - Configuration options for post-login processing
   * @returns Result with destination path and metadata
   *
   * @example
   * ```typescript
   * // After OAuth code exchange or email/password login
   * const result = await AuthService.handlePostLogin({
   *   returnTo: '/dashboard',
   *   apiUrl: 'https://api.example.com'
   * });
   * navigate(result.destination, { replace: true });
   * ```
   */
  static async handlePostLogin(options: PostLoginOptions & { apiUrl: string }): Promise<PostLoginResult> {
    const { returnTo } = options;

    console.log('[AuthService.handlePostLogin] Starting post-login processing');

    try {
      // Step 1: Get current session
      const session = await this.getSession();
      if (!session) {
        throw new Error('No session found after login');
      }

      console.log('[AuthService.handlePostLogin] Session found:', session.user.email);

      // Step 2: Ensure user exists in database
      console.log('[AuthService.handlePostLogin] Ensuring user exists in database...');
      await this.ensureUser();
      console.log('[AuthService.handlePostLogin] User ensured successfully');

      const result: PostLoginResult = {
        destination: '/gamified-dashboard-v2', // Default destination
      };

      // Step 3: Attempt domain-based autojoin BEFORE checking invite cookie
      console.log('[AuthService.handlePostLogin] Attempting autojoin by email domain...');
      try {
        const autojoinResult = await AutojoinService.tryAutojoinByDomain(session.user.email || '');

        if (AutojoinService.isSuccessful(autojoinResult)) {
          console.log('[AuthService.handlePostLogin] ✅ Autojoin successful:', {
            company_id: autojoinResult.company_id,
            company_name: autojoinResult.company_name,
            domain: autojoinResult.domain,
            method: 'autojoin'
          });
          result.autoJoined = true;
          // User successfully auto-joined company - skip invite flow
        } else if (AutojoinService.userAlreadyHasCompany(autojoinResult)) {
          console.log('[AuthService.handlePostLogin] User already has company, skipping autojoin');
          // User already assigned to company - continue normally
        } else if (AutojoinService.noMatchingDomain(autojoinResult)) {
          console.log('[AuthService.handlePostLogin] No matching domain for autojoin');
          // No autojoin available - continue with normal flow
        } else {
          console.log('[AuthService.handlePostLogin] Autojoin failed:', autojoinResult.error);
          // Autojoin failed for other reason - continue with normal flow
        }
      } catch (error) {
        console.error('[AuthService.handlePostLogin] Autojoin error:', error);
        // On error, continue with normal flow
      }

      // Step 4: Check user roles (admin/manager get priority, but only after phase check)
      console.log('[AuthService.handlePostLogin] Checking user roles...');
      let isPrivileged = false;
      try {
        const roles = await this.getMyRoles();
        console.log('[AuthService.handlePostLogin] User roles:', roles);
        result.roles = roles;

        if (roles && Array.isArray(roles)) {
          isPrivileged = roles.includes('admin') || roles.includes('manager');
        }
      } catch (error) {
        console.log('[AuthService.handlePostLogin] Error getting roles:', error);
        // Continue to phase check even if roles fail
      }

      // Step 5: Check user phase to determine destination
      console.log('[AuthService.handlePostLogin] Checking user phase...');
      const phase = await this.getMyPhase();
      console.log('[AuthService.handlePostLogin] User phase:', phase, 'returnTo:', returnTo);
      result.phase = phase;

      // REGISTRATION wins even for admin/manager: a user who just redeemed a
      // MANAGER invite code must still complete onboarding before the dashboard
      if (phase === 'REGISTRATION') {
        console.log('[AuthService.handlePostLogin] User needs REGISTRATION - redirecting to registration');
        result.destination = '/registration';
        return result;
      }

      if (isPrivileged) {
        console.log('[AuthService.handlePostLogin] User has admin/manager role - redirecting to gamified dashboard v2');
        result.destination = '/gamified-dashboard-v2';
        return result;
      }

      // Step 6: Determine final destination based on phase and returnTo
      // If user is ACTIVE and has returnTo, use it
      if (phase === 'ACTIVE' && returnTo && returnTo.startsWith('/')) {
        console.log('[AuthService.handlePostLogin] Redirecting to returnTo:', returnTo);
        result.destination = returnTo;
        return result;
      }

      // Otherwise, redirect based on phase
      if (phase === 'ACTIVE') {
        console.log('[AuthService.handlePostLogin] User is ACTIVE - redirecting to gamified dashboard v2');
        result.destination = '/gamified-dashboard-v2';
      } else if (phase === 'NO_COMPANY' || phase === 'PENDING') {
        // BYPASS PENDING: Send users directly to registration instead of pending page
        // Original code (commented for easy revert):
        // console.log('[AuthService.handlePostLogin] User has NO_COMPANY/PENDING - redirecting to pending');
        // result.destination = '/pending';
        console.log('[AuthService.handlePostLogin] User has NO_COMPANY/PENDING - bypassing pending, redirecting to registration');
        result.destination = '/registration';
      } else {
        // Unknown phase - error state
        console.warn('[AuthService.handlePostLogin] Unknown phase:', phase);
        result.destination = '/user-status-error';
      }

      console.log('[AuthService.handlePostLogin] Post-login processing completed:', result);
      return result;

    } catch (error) {
      console.error('[AuthService.handlePostLogin] Unexpected error during post-login:', error);
      throw error;
    }
  }
}

/**
 * Helper function to build OAuth redirect URL
 * @param returnTo - Optional path to return to after auth
 * @param companyId - Optional company ID for invitation context
 * @returns Full redirect URL for OAuth callback
 */
export function buildRedirectTo(
    returnTo?: string | null,
    companyId?: string | null
  ): string {
    const origin = window.location.origin;                 // usa el origen actual (dev/prod)
    const url = new URL('/auth/callback', origin);         // tu callback (regístralo en Supabase)

    // Sanitiza returnTo: solo mismo origen y lo guarda como ruta relativa
    if (returnTo) {
      try {
        const candidate = new URL(returnTo, origin);
        if (candidate.origin === origin) {
          const rel = candidate.pathname + candidate.search + candidate.hash;
          if (rel.startsWith('/')) url.searchParams.set('returnTo', rel);
        }
      } catch { /* ignora valores inválidos */ }
    }

    if (companyId) url.searchParams.set('company', companyId);
    return url.toString();                                  // sin slash final extra
  }
  