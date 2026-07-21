import { supabase } from '../../api/client/supabase';

/**
 * Result returned by autojoin attempt
 */
export interface AutojoinResult {
  success: boolean;
  error?: string;
  message?: string;
  company_id?: string;
  company_name?: string;
  company_slug?: string;
  role_assigned?: string;
  method?: string;
  domain?: string;
}

/**
 * AutojoinService - Handles domain-based automatic organization assignment
 *
 * This service allows users to automatically join organizations based on their email domain.
 * For example, users with @acme.com emails can automatically join the ACME organization
 * if autojoin is enabled for that domain.
 */
export class AutojoinService {
  /**
   * Attempt to auto-join organization by email domain
   *
   * @param email - User's email address
   * @returns AutojoinResult with success status and company details
   *
   * @example
   * ```typescript
   * const result = await AutojoinService.tryAutojoinByDomain('john@acme.com');
   * if (result.success) {
   *   console.log(`Joined company: ${result.company_name}`);
   * } else {
   *   console.log(`Autojoin failed: ${result.error}`);
   * }
   * ```
   */
  static async tryAutojoinByDomain(email: string): Promise<AutojoinResult> {
    try {
      const { data, error } = await supabase.rpc('try_autojoin_by_domain', {
        p_email: email
      });

      if (error) {
        console.error('[AutojoinService] RPC error:', error);
        return {
          success: false,
          error: 'RPC_ERROR',
          message: error.message
        };
      }

      return data as AutojoinResult;
    } catch (err) {
      console.error('[AutojoinService] Unexpected error:', err);
      return {
        success: false,
        error: 'UNEXPECTED_ERROR',
        message: err instanceof Error ? err.message : 'Unknown error'
      };
    }
  }

  /**
   * Extract domain from email address
   *
   * @param email - Email address
   * @returns Domain part (everything after @) in lowercase
   *
   * @example
   * ```typescript
   * AutojoinService.extractDomain('john@acme.com'); // returns 'acme.com'
   * ```
   */
  static extractDomain(email: string): string | null {
    if (!email || typeof email !== 'string') {
      return null;
    }

    const atIndex = email.lastIndexOf('@');
    if (atIndex === -1 || atIndex === email.length - 1) {
      return null;
    }

    return email.substring(atIndex + 1).toLowerCase();
  }

  /**
   * Check if autojoin was successful
   *
   * @param result - AutojoinResult from tryAutojoinByDomain
   * @returns true if user was successfully assigned to company
   */
  static isSuccessful(result: AutojoinResult): boolean {
    return result.success === true && !!result.company_id;
  }

  /**
   * Check if autojoin failed because user already has company
   *
   * @param result - AutojoinResult from tryAutojoinByDomain
   * @returns true if user already belongs to a company
   */
  static userAlreadyHasCompany(result: AutojoinResult): boolean {
    return result.error === 'USER_ALREADY_HAS_COMPANY';
  }

  /**
   * Check if autojoin failed because no matching domain was found
   *
   * @param result - AutojoinResult from tryAutojoinByDomain
   * @returns true if no company with autojoin enabled was found for the domain
   */
  static noMatchingDomain(result: AutojoinResult): boolean {
    return result.error === 'NO_MATCHING_DOMAIN';
  }
}
