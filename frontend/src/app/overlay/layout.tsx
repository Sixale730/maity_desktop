'use client'

import '../globals.css'

export default function OverlayLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className="dark">
      <body className="bg-transparent overflow-hidden select-none">
        {children}
      </body>
    </html>
  )
}
