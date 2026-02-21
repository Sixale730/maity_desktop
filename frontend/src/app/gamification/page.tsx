'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { GamifiedDashboard } from '@/features/gamification';
import { useUserRole } from '@/hooks/useUserRole';

export default function GamificationPage() {
  const { isAdmin } = useUserRole();
  const router = useRouter();

  useEffect(() => {
    if (!isAdmin) {
      router.replace('/');
    }
  }, [isAdmin, router]);

  if (!isAdmin) return null;

  return <GamifiedDashboard />;
}
