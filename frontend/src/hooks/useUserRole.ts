import { useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getUserRole, isDeveloper as checkIsDeveloper } from '@/lib/roles';

export function useUserRole() {
  const { user, maityUser } = useAuth();

  return useMemo(() => {
    const email = user?.email ?? maityUser?.email ?? null;
    const role = getUserRole(email);
    return {
      role,
      isDeveloper: checkIsDeveloper(role),
      isRegularUser: !checkIsDeveloper(role),
      email,
    };
  }, [user?.email, maityUser?.email]);
}
