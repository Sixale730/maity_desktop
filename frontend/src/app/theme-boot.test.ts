/**
 * Tema claro/oscuro de la ventana principal (paridad web sep-2026).
 *
 * public/theme-boot.js corre bloqueante en el <head> de app/(main)/layout.tsx y estampa
 * `data-portal-theme` + `.dark` en <html> antes del primer paint. Este test:
 *   1. Ejecuta el script real en jsdom: claro por defecto, 'dark' aplica clase + atributo,
 *      storage que truena → claro.
 *   2. Verifica que el layout de la main lo referencie como <script src> externo (la CSP es
 *      script-src 'self', inline no) y ya no fuerce className="dark" en <html>.
 *   3. Verifica que ThemeContext no vuelva a añadir 'dark' incondicionalmente ni reviva las
 *      paletas neutral/cool/warm.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const FRONTEND = path.resolve(__dirname, '..', '..')
const BOOT_PATH = path.join(FRONTEND, 'public', 'theme-boot.js')
const MAIN_LAYOUT = path.join(__dirname, '(main)', 'layout.tsx')
const THEME_CONTEXT = path.resolve(__dirname, '..', 'contexts', 'ThemeContext.tsx')

const bootSource = readFileSync(BOOT_PATH, 'utf8')

function runBoot() {
  // Mismo efecto que el <script src> clásico: ejecución en el scope global del documento.
  new Function(bootSource)()
}

function resetHtml() {
  const html = document.documentElement
  html.classList.remove('dark')
  html.removeAttribute('data-portal-theme')
}

afterEach(() => {
  vi.restoreAllMocks()
  try {
    localStorage.removeItem('maity-portal-theme')
  } catch {
    /* noop */
  }
  resetHtml()
})

describe('public/theme-boot.js', () => {
  it('sin preferencia guardada arranca en claro', () => {
    runBoot()
    expect(document.documentElement.getAttribute('data-portal-theme')).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it("con 'dark' guardado aplica la clase .dark y data-portal-theme='dark'", () => {
    localStorage.setItem('maity-portal-theme', 'dark')
    runBoot()
    expect(document.documentElement.getAttribute('data-portal-theme')).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it("con 'light' guardado quita un .dark previo", () => {
    document.documentElement.classList.add('dark')
    localStorage.setItem('maity-portal-theme', 'light')
    runBoot()
    expect(document.documentElement.getAttribute('data-portal-theme')).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('si el storage truena, cae a claro sin lanzar', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Unavailable')
    })
    expect(() => runBoot()).not.toThrow()
    expect(document.documentElement.getAttribute('data-portal-theme')).toBe('light')
  })
})

describe('app/(main)/layout.tsx carga theme-boot.js', () => {
  const layout = readFileSync(MAIN_LAYOUT, 'utf8')

  it('lo referencia como <script src="/theme-boot.js"> externo dentro de <head>', () => {
    expect(layout).toMatch(/<head>[\s\S]*<script\s+src="\/theme-boot\.js"\s*\/?>[\s\S]*<\/head>/)
  })

  it('no fuerza className="dark" en el <html> de la main (y suprime el warning de hidratación)', () => {
    const mainHtml = layout.match(/<html lang="es"(?! className="dark bg-transparent")[^>]*>/g) ?? []
    expect(mainHtml.length, 'no se encontró el <html> de la main').toBeGreaterThan(0)
    for (const tag of mainHtml) {
      expect(tag).not.toMatch(/className=/)
      expect(tag).toMatch(/suppressHydrationWarning/)
    }
  })

  it('el early-return aux conserva "dark bg-transparent"', () => {
    expect(layout).toContain('<html lang="es" className="dark bg-transparent">')
  })
})

describe('contexts/ThemeContext.tsx', () => {
  const src = readFileSync(THEME_CONTEXT, 'utf8')

  it("no añade 'dark' incondicionalmente (DashboardTheme es el único escritor)", () => {
    expect(src).not.toMatch(/classList\.add\(\s*['"]dark['"]\s*\)/)
  })

  it('no revive las paletas neutral/cool/warm', () => {
    expect(src).not.toMatch(/classList\.add\([^)]*theme-/)
    expect(src).not.toMatch(/setPalette/)
  })
})
