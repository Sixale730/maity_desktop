import { supabase } from '../../api/client/supabase';

/**
 * Result returned by an invite code redemption attempt
 */
export interface RedeemInviteCodeResult {
  success: boolean;
  error?: string;
  message?: string;
  company_id?: string;
  company_name?: string;
  company_slug?: string;
  role_assigned?: string;
  method?: string;
}

/**
 * Result returned by an invite code regeneration (admin only)
 */
export interface RegenerateInviteCodeResult {
  success: boolean;
  error?: string;
  message?: string;
  invite_link_id?: string;
  code?: string;
  audience?: string;
}

/**
 * InviteCodeService - Handles company invite codes (join by code)
 *
 * Each company has two short 8-char codes (Crockford Base32): one for the
 * USER audience and one for MANAGER. Redeeming a code assigns the user to
 * the company with the corresponding role. Codes are managed (viewed,
 * copied, regenerated) by admins from the Organizations console.
 */
export class InviteCodeService {
  /**
   * Redeem an invite code for the current authenticated user
   *
   * @param code - 8-char invite code (case-insensitive; O/I/L are normalized server-side)
   * @returns RedeemInviteCodeResult with success status and company details
   *
   * @example
   * ```typescript
   * const result = await InviteCodeService.redeemCode('X4K9PM2T');
   * if (result.success) {
   *   console.log(`Joined ${result.company_name} as ${result.role_assigned}`);
   * }
   * ```
   */
  static async redeemCode(code: string): Promise<RedeemInviteCodeResult> {
    try {
      const { data, error } = await supabase.rpc('redeem_invite_code', {
        p_code: code
      });

      if (error) {
        console.error('[InviteCodeService] RPC error:', error);
        return {
          success: false,
          error: 'RPC_ERROR',
          message: error.message
        };
      }

      return data as RedeemInviteCodeResult;
    } catch (err) {
      console.error('[InviteCodeService] Unexpected error:', err);
      return {
        success: false,
        error: 'UNEXPECTED_ERROR',
        message: err instanceof Error ? err.message : 'Unknown error'
      };
    }
  }

  /**
   * Regenerate the code of an invite link (admin only).
   * The previous code stops working and used_count resets to 0.
   *
   * @param inviteLinkId - UUID of the maity.invite_links row
   */
  static async regenerateCode(inviteLinkId: string): Promise<RegenerateInviteCodeResult> {
    try {
      const { data, error } = await supabase.rpc('regenerate_invite_code', {
        p_invite_link_id: inviteLinkId
      });

      if (error) {
        console.error('[InviteCodeService] RPC error:', error);
        return {
          success: false,
          error: 'RPC_ERROR',
          message: error.message
        };
      }

      return data as RegenerateInviteCodeResult;
    } catch (err) {
      console.error('[InviteCodeService] Unexpected error:', err);
      return {
        success: false,
        error: 'UNEXPECTED_ERROR',
        message: err instanceof Error ? err.message : 'Unknown error'
      };
    }
  }

  /**
   * Check if redemption was successful
   */
  static isSuccessful(result: RedeemInviteCodeResult): boolean {
    return result.success === true && !!result.company_id;
  }

  /**
   * Check if redemption failed because the user already belongs to a company
   */
  static userAlreadyHasCompany(result: RedeemInviteCodeResult): boolean {
    return result.error === 'USER_ALREADY_HAS_COMPANY';
  }

  /**
   * Map a failed redemption result to a user-facing Spanish message
   */
  static errorMessage(result: RedeemInviteCodeResult): string {
    switch (result.error) {
      case 'INVALID_CODE':
        return 'Código no válido. Verifica que esté bien escrito.';
      case 'CODE_REVOKED':
      case 'CODE_EXPIRED':
        return 'Este código ya no está activo. Pide uno nuevo a tu empresa.';
      case 'CODE_EXHAUSTED':
        return 'Este código alcanzó su límite de usos. Pide uno nuevo a tu empresa.';
      case 'COMPANY_INACTIVE':
        return 'La empresa de este código no está activa.';
      case 'USER_ALREADY_HAS_COMPANY':
        return 'Ya perteneces a una empresa.';
      default:
        return 'No se pudo canjear el código. Intenta de nuevo.';
    }
  }
}
