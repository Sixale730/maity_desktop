'use client';

import React, { createContext, useContext, ReactNode } from 'react';
import { useParakeetAutoDownload, type ParakeetAutoDownloadState } from '@/hooks/useParakeetAutoDownload';

const ParakeetAutoDownloadContext = createContext<ParakeetAutoDownloadState | undefined>(undefined);

export function ParakeetAutoDownloadProvider({ children }: { children: ReactNode }) {
  const state = useParakeetAutoDownload();

  return (
    <ParakeetAutoDownloadContext.Provider value={state}>
      {children}
    </ParakeetAutoDownloadContext.Provider>
  );
}

export function useParakeetAutoDownloadContext() {
  const context = useContext(ParakeetAutoDownloadContext);
  if (context === undefined) {
    throw new Error('useParakeetAutoDownloadContext must be used within a ParakeetAutoDownloadProvider');
  }
  return context;
}
