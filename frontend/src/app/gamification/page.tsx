'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { GamifiedDashboard } from '@/features/gamification';
import { useUserRole } from '@/hooks/useUserRole';

export default function GamificationPage() {
  const { isRegularUser } = useUserRole();
  const router = useRouter();

  useEffect(() => {
    if (isRegularUser) {
      router.replace('/');
    }
  }, [isRegularUser, router]);

  if (isRegularUser) return null;

  return <GamifiedDashboard />;
}
