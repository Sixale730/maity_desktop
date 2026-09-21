/**
 * Tokens de color: todo `var(--x)` que referencia tailwind.config.ts debe estar definido
 * en `:root` (tema claro) Y en `.dark` (tema oscuro + ventanas aux) de globals.css.
 *
 * Por qué: un token sin definir no rompe el build — Tailwind emite `hsl(var(--x) / 1)`, el
 * navegador lo descarta en silencio y el elemento cae a transparente/heredado. Así vivieron
 * `sidebar.*` y `surface-elevated` sin vars en el desktop hasta sep-2026.
 *
 * También vigila que el lienzo (background) viva SOLO bajo html[data-portal-theme=…]: un
 * background en `html` o `html.dark`/`.dark` taparía las esquinas transparentes de las
 * ventanas aux (`class="dark bg-transparent"`, sin theme-boot).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const FRONTEND = path.resolve(__dirname, '..', '..')
const TAILWIND = readFileSync(path.join(FRONTEND, 'tailwind.config.ts'), 'utf8')
const GLOBALS = readFileSync(path.join(__dirname, 'globals.css'), 'utf8')

/** Sin comentarios para no confundir selectores o vars mencionados en prosa. */
const CSS = GLOBALS.replace(/\/\*[\s\S]*?\*\//g, '')

/** Regla hoja `selector { decls }`; el selector arranca tras el último `;`, `{` o `}`. */
const RULE_RE = /([^{};]+)\{([^{}]*)\}/g

/** Cuerpos concatenados de TODOS los bloques cuyo selector es exactamente `selector`. */
function blockBody(selector: string): string {
  const bodies: string[] = []
  for (const m of CSS.matchAll(RULE_RE)) {
    if (m[1].trim() === selector) bodies.push(m[2])
  }
  if (bodies.length === 0) throw new Error(`no se encontró el bloque "${selector}" en globals.css`)
  return bodies.join('\n')
}

function definedVars(body: string): Set<string> {
  return new Set([...body.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]))
}

// Vars de fuentes: las define next/font en runtime (chat), no globals.css.
const TAILWIND_VARS = [
  ...new Set([...TAILWIND.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1])),
].filter((v) => !v.startsWith('--font-'))

describe('globals.css define todos los tokens que usa tailwind.config.ts', () => {
  it('tailwind referencia tokens (sanity)', () => {
    expect(TAILWIND_VARS.length).toBeGreaterThan(20)
    for (const v of ['--sidebar-background', '--surface-elevated', '--maity-amber', '--dashboard-gold']) {
      expect(TAILWIND_VARS).toContain(v)
    }
  })

  for (const selector of [':root', '.dark']) {
    it(`todos definidos en ${selector}`, () => {
      const defined = definedVars(blockBody(selector))
      const missing = TAILWIND_VARS.filter((v) => !defined.has(v))
      expect(missing, `tokens sin definir en ${selector}`).toEqual([])
    })
  }

  it('los tokens con <alpha-value> no llevan alpha propio (sería `hsl(h s l / a / 1)`, inválido)', () => {
    const alphaVars = [...TAILWIND.matchAll(/hsl\(var\((--[\w-]+)\)\s*\/\s*<alpha-value>\)/g)].map((m) => m[1])
    const bad: string[] = []
    for (const selector of [':root', '.dark']) {
      const body = blockBody(selector)
      for (const v of alphaVars) {
        const decl = body.match(new RegExp(`${v}\\s*:\\s*([^;]+);`))
        if (decl && decl[1].includes('/')) bad.push(`${selector} ${v}: ${decl[1].trim()}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('ya no existen las paletas retiradas .dark.theme-*', () => {
    expect(CSS).not.toMatch(/\.dark\.theme-/)
  })
})

describe('el lienzo del documento no rompe la transparencia de las ventanas aux', () => {
  /** Todos los bloques `selector { … }` de primer nivel dentro del CSS (sin at-rules). */
  function rulesFor(predicate: (selector: string) => boolean): string[] {
    const out: string[] = []
    for (const m of CSS.matchAll(RULE_RE)) {
      const selectors = m[1].split(',').map((s) => s.trim())
      if (selectors.some(predicate)) out.push(`${m[1].trim()} { ${m[2].trim()} }`)
    }
    return out
  }

  it('ninguna regla pone background en `html`, `html.dark` o `.dark` a secas', () => {
    const bare = rulesFor((s) => s === 'html' || s === 'html.dark' || s === '.dark' || s === ':root')
    const withBg = bare.filter((r) => /(^|[\s;{])background(-color)?\s*:/.test(r))
    expect(withBg).toEqual([])
  })

  it('el lienzo claro y el oscuro viven bajo html[data-portal-theme=…]', () => {
    expect(CSS).toMatch(/html\[data-portal-theme='light'\]\s*\{[^}]*background\s*:/)
    expect(CSS).toMatch(/html\[data-portal-theme='dark'\]\s*\{[^}]*background\s*:/)
  })
})
