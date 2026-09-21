/**
 * Guard del barrido de tokens (paridad con el rediseño web sep-2026, tema claro por defecto).
 *
 * Cuenta, por carpeta de `src/`, los anti-patrones de "color oscuro hardcodeado" que rompen
 * el tema claro (superficies negras, texto blanco/gris fijo, fondos #0x/#1x) y los compara con
 * un baseline que SOLO puede bajar (ratchet). Lo que queda en el baseline es intencional:
 * botones de marca con `text-white` sobre `bg-[#3a4ac3]`/`bg-[#cc0040]`/…, puntos de estado
 * `bg-[#1bea9a]`, overlays `bg-black/50`, iconos blancos sobre fondo de color.
 *
 * - Si agregaste un anti-patrón: usa tokens (`bg-background/card/muted`, `text-foreground`,
 *   `text-muted-foreground`, `border-border`) en vez de subir el baseline.
 * - Si lo bajaste: baja el número del baseline en el mismo commit (el test lo exige para que
 *   el ratchet no quede flojo).
 *
 * `app/(aux)/**` queda fuera a propósito: las ventanas aux siguen oscuras y transparentes.
 * Los tests (`*.test.ts[x]`) no cuentan.
 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = path.resolve(__dirname, '..')

const PATTERNS: RegExp[] = [
  /\btext-white\b(?!\/)/g,
  /\bbg-black\b/g,
  /\bbg-\[#[01][0-9a-fA-F]{2,5}\]/g,
  /\bborder-white\//g,
  /\btext-gray-\d{2,3}\b/g,
  /\bbg-gray-9\d{2}\b/g,
]

// Conteo tras el barrido de sep-2026 (integración del port web 3ef2914). Solo puede bajar.
const BASELINE: Record<string, number> = {
  'app/(main)': 11,
  components: 2,
  'components/Auth': 1,
  'components/coach': 1,
  'components/ConfirmationModal': 2,
  'components/DatabaseImport': 7,
  'components/ModelDownloadGate': 1,
  'components/models': 23,
  'components/Onboarding': 2,
  'components/recording': 17,
  'components/shared': 2,
  'components/Sidebar': 3,
  'components/transcript': 6,
  'components/ui': 7,
  'features/auth': 9,
  'features/avatar': 4,
  'features/conversations': 2,
  'features/dashboard': 2,
  'features/maity-chat': 5,
  'features/tasks': 1,
  'shared/components': 1,
}

function folderOf(rel: string): string {
  const parts = rel.split('/')
  return parts.length > 2 ? parts.slice(0, 2).join('/') : parts.slice(0, -1).join('/') || '.'
}

function countAntiPatterns(): Record<string, number> {
  const counts: Record<string, number> = {}
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) {
        walk(p)
        continue
      }
      if (!/\.(tsx|ts)$/.test(e.name) || /\.(test|spec)\.tsx?$/.test(e.name)) continue
      const rel = path.relative(SRC, p).replace(/\\/g, '/')
      if (rel.startsWith('app/(aux)/')) continue
      const src = readFileSync(p, 'utf8')
      let n = 0
      for (const re of PATTERNS) n += (src.match(re) || []).length
      if (n) {
        const folder = folderOf(rel)
        counts[folder] = (counts[folder] || 0) + n
      }
    }
  }
  walk(SRC)
  return counts
}

describe('tokens de tema: colores oscuros hardcodeados (ratchet por carpeta)', () => {
  const counts = countAntiPatterns()

  it('ninguna carpeta supera su baseline (carpetas nuevas arrancan en 0)', () => {
    const over = Object.entries(counts)
      .filter(([folder, n]) => n > (BASELINE[folder] ?? 0))
      .map(([folder, n]) => `${folder}: ${n} > baseline ${BASELINE[folder] ?? 0}`)
    expect(over, 'usa tokens (bg-background/card/muted, text-foreground, border-border) en vez de colores fijos').toEqual([])
  })

  it('el baseline está ajustado (si bajaste el conteo, baja también el número)', () => {
    const loose = Object.entries(BASELINE)
      .filter(([folder, n]) => (counts[folder] ?? 0) < n)
      .map(([folder, n]) => `${folder}: baseline ${n}, ahora ${counts[folder] ?? 0}`)
    expect(loose).toEqual([])
  })
})
