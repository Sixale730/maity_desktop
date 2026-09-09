import type { Metadata } from 'next'
import '../globals.css'

/**
 * Root layout de las ventanas webview AUXILIARES (`/coach-float`,
 * `/recording-widget`, `/device-picker`; lista canónica en lib/auxWindows.ts).
 *
 * Es un root layout aparte (route group `(aux)`) y NO el de `(main)` a
 * propósito (#23 de la auditoría de recursos, sep-2026): Next empaqueta por
 * layout, así que todo lo que importa el root layout viaja a cada ruta que
 * cuelga de él. Con las aux colgadas del layout principal, `coach-float.html`
 * cargaba 1.17 MB de JS (providers, sonner, Radix, TanStack, fuentes,
 * supabase-js) de los que la página eran 27 KB; el early-return en runtime
 * evitaba MONTAR los providers, no CARGARLOS.
 *
 * Reglas (las vigila `layout.test.ts` de esta carpeta):
 * - Server component: sin 'use client'. Solo html/body + globals.css.
 * - Sin `next/font`: el body de la app usa `font-sans` (stack default de
 *   Tailwind, no hay override); las vars `--font-*` solo las consumen
 *   componentes de la main.
 * - Transparencia por CLASES, nunca `style=""`: Tauri inyecta un nonce a los
 *   <style> del HTML buildeado y eso hace que la CSP ignore 'unsafe-inline'
 *   (ver el comentario de SplashScreen en (main)/layout.tsx). `bg-transparent`
 *   es utility y le gana al `body { @apply bg-background }` de @layer base;
 *   sin él el body negro tapa el blur de la ventana `transparent: true`.
 * - `dark` se conserva: globals.css define las vars de color bajo `.dark`.
 * - Nada de providers, Toaster ni supabase aquí: si una ventana aux necesita
 *   telemetría, va por `lib/auxAnalytics.ts` (comando nativo → outbox), no
 *   por platformLogger.
 *
 * El título nativo de cada ventana lo pone Rust (`.title()` del builder); el
 * <title> del HTML es solo cosmético y por eso es uno para las tres.
 */
export const metadata: Metadata = {
  title: 'Maity',
}

export default function AuxRootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="es" className="dark bg-transparent">
      <body className="bg-transparent overflow-hidden antialiased">{children}</body>
    </html>
  )
}
