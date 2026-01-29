import React from 'react';
import { cn } from '@/lib/utils';
import type { StatusIndicatorProps } from '@/types/onboarding';

export function StatusIndicator({ status, size = 'md' }: StatusIndicatorProps) {
  const sizeClasses = {
    sm: 'w-2 h-2',
    md: 'w-3 h-3',
    lg: 'w-4 h-4',
  };

  // MAITY palette colors
  const statusColors = {
    idle: 'bg-[#d0d0d3] dark:bg-gray-600',
    checking: 'bg-[#485df4] animate-pulse',
    success: 'bg-[#1bea9a]',
    error: 'bg-[#ff0050]',
  };

  return <span className={cn('rounded-full inline-block', sizeClasses[size], statusColors[status])} />;
}
