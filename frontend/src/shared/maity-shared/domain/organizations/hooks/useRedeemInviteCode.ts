import { useMutation, useQueryClient } from '@tanstack/react-query';
import { InviteCodeService, type RedeemInviteCodeResult } from '../invite-code.service';

/**
 * Mutation hook to redeem a company invite code for the current user.
 * On success, invalidates user status/profile queries so the UI picks up
 * the new company (and possibly the new manager role).
 */
export function useRedeemInviteCode() {
  const queryClient = useQueryClient();

  return useMutation<RedeemInviteCodeResult, Error, string>({
    mutationFn: (code: string) => InviteCodeService.redeemCode(code),
    onSuccess: (result) => {
      if (InviteCodeService.isSuccessful(result)) {
        void queryClient.invalidateQueries({ queryKey: ['user', 'status'] });
        void queryClient.invalidateQueries({ queryKey: ['user', 'profile'] });
        void queryClient.invalidateQueries({ queryKey: ['organizations'] });
      }
    },
  });
}
