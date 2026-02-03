'use client'

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'

type ThemePalette = 'neutral' | 'cool' | 'warm'

interface ThemeContextType {
  palette: ThemePalette
  setPalette: (palette: ThemePalette) => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

const THEME_STORAGE_KEY = 'maity-theme-palette'

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [palette, setPaletteState] = useState<ThemePalette>('neutral')
  const [isInitialized, setIsInitialized] = useState(false)

  // Cargar preferencia guardada al montar
  useEffect(() => {
    const savedPalette = localStorage.getItem(THEME_STORAGE_KEY) as ThemePalette | null
    if (savedPalette && ['neutral', 'cool', 'warm'].includes(savedPalette)) {
      setPaletteState(savedPalette)
    }
    setIsInitialized(true)
  }, [])

  // Aplicar clase de tema al documento
  useEffect(() => {
    if (!isInitialized) return

    // Remover clases de paleta anteriores
    document.documentElement.classList.remove('theme-neutral', 'theme-cool', 'theme-warm')
    // Agregar clase de paleta actual
    document.documentElement.classList.add(`theme-${palette}`)
    // Asegurar que siempre esté en modo oscuro
    document.documentElement.classList.add('dark')
  }, [palette, isInitialized])

  const setPalette = useCallback((newPalette: ThemePalette) => {
    setPaletteState(newPalette)
    localStorage.setItem(THEME_STORAGE_KEY, newPalette)
  }, [])

  return (
    <ThemeContext.Provider value={{ palette, setPalette }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider')
  }
  return context
}
