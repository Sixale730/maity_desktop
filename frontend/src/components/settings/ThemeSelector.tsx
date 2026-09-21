'use client'

import { Moon, Sun } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { useTheme } from '@/contexts/ThemeContext'

/**
 * Switch Claro/Oscuro (sep-2026). Reemplaza al selector de paletas neutral/cool/warm,
 * que se retiró al adoptar la paleta de la web. Escribe vía `useTheme().toggle`
 * (DashboardTheme es el único escritor de `.dark`/`data-portal-theme`).
 */
export function ThemeSelector() {
  const { theme, toggle } = useTheme()
  const dark = theme === 'dark'

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-3">
        {dark ? (
          <Moon className="h-5 w-5 text-foreground" aria-hidden="true" />
        ) : (
          <Sun className="h-5 w-5 text-foreground" aria-hidden="true" />
        )}
        <div className="text-left">
          <div className="font-medium text-foreground">{dark ? 'Oscuro' : 'Claro'}</div>
          <div className="text-sm text-muted-foreground">
            {dark ? 'Fondo oscuro, ideal con poca luz' : 'Fondo claro (predeterminado)'}
          </div>
        </div>
      </div>
      <Switch
        checked={dark}
        onCheckedChange={(next) => {
          if (next !== dark) toggle()
        }}
        aria-label="Tema oscuro"
      />
    </div>
  )
}
