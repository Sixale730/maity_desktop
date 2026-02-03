'use client'

import { useTheme } from '@/contexts/ThemeContext'
import { Check } from 'lucide-react'

const PALETTES = [
  {
    id: 'neutral' as const,
    name: 'Gris Neutro',
    description: 'Estilo minimalista tipo VS Code',
    preview: ['#121212', '#1a1a1a', '#2e2e2e']
  },
  {
    id: 'cool' as const,
    name: 'Gris Frío',
    description: 'Tinte azulado moderno',
    preview: ['#0f0f14', '#16161e', '#2a2a3d']
  },
  {
    id: 'warm' as const,
    name: 'Gris Cálido',
    description: 'Tinte marrón acogedor',
    preview: ['#141210', '#1a1816', '#2e2a26']
  }
]

export function ThemeSelector() {
  const { palette, setPalette } = useTheme()

  return (
    <div className="space-y-3">
      {PALETTES.map((p) => (
        <button
          key={p.id}
          onClick={() => setPalette(p.id)}
          className={`w-full p-4 rounded-lg border transition-all flex items-center gap-4 ${
            palette === p.id
              ? 'border-[#ff0050] bg-[#ff0050]/10'
              : 'border-border hover:border-muted-foreground/50 bg-card'
          }`}
        >
          {/* Preview de colores */}
          <div className="flex gap-1">
            {p.preview.map((color, i) => (
              <div
                key={i}
                className="w-6 h-6 rounded"
                style={{ backgroundColor: color }}
              />
            ))}
          </div>

          {/* Info */}
          <div className="flex-1 text-left">
            <div className="font-medium text-foreground">{p.name}</div>
            <div className="text-sm text-muted-foreground">{p.description}</div>
          </div>

          {/* Check */}
          {palette === p.id && (
            <Check className="w-5 h-5 text-[#ff0050]" />
          )}
        </button>
      ))}
    </div>
  )
}
