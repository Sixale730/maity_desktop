import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import {
  type UserRole,
  isAdmin as checkIsAdmin,
  isManager as checkIsManager,
  getUserRoleFromEmail,
  getUserRoleFromRPC,
} from '@/lib/roles';

export function useUserRole() {
  const { user, maityUser } = useAuth();
  const email = user?.email ?? maityUser?.email ?? null;

  const [rpcRole, setRpcRole] = useState<UserRole | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchRole() {
      setLoading(true);
      const role = await getUserRoleFromRPC(supabase);
      if (!cancelled) {
        setRpcRole(role);
        setLoading(false);
      }
    }

    fetchRole();
    return () => { cancelled = true; };
  }, [email]);

  return useMemo(() => {
    const role: UserRole = rpcRole ?? getUserRoleFromEmail(email);
    return {
      role,
      isAdmin: checkIsAdmin(role),
      isManager: checkIsManager(role),
      isUser: role === 'user',
      loading,
    };
  }, [rpcRole, email, loading]);
}
