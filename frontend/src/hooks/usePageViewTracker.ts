'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { platformLogger } from '@/lib/platformLogger'

/**
 * Emits `nav.page_view` to platform_logs whenever the Next.js route changes.
 * Mount once at the top of AppContent (or any component that lives across
 * all navigations).
 *
 * Skips duplicate emissions for the same path (e.g., due to re-renders).
 */
export function usePageViewTracker() {
  const pathname = usePathname()
  const lastTrackedRef = useRef<string | null>(null)

  useEffect(() => {
    if (!pathname) return
    if (lastTrackedRef.current === pathname) return
    lastTrackedRef.current = pathname
    void platformLogger.log('nav.page_view', { path: pathname })
  }, [pathname])
}
