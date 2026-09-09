'use client'

import { Inter } from 'next/font/google'
import { GeistSans } from 'geist/font/sans'
import { MaityChatLayout } from '@/features/maity-chat'

// Geist (encabezados, `font-geist`) e Inter (cuerpo, `font-inter`) sólo las
// usan shell-v5 y maity-chat, así que se declaran AQUÍ y no en el root layout:
// su CSS de @font-face y sus .woff2 viajan con chat.html, no con index.html
// (#24 de la auditoría de recursos). Los tokens `fontFamily.geist/inter` de
// tailwind.config.ts leen las custom properties `--font-geist-sans` /
// `--font-inter` que estas clases definen; se heredan a todo el subárbol.
const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-inter',
})

export default function ChatPage() {
  // `contents`: el wrapper no genera caja (no altera el layout flex/h-full de
  // MainContent) pero sí participa en la herencia de las custom properties.
  return (
    <div className={`${inter.variable} ${GeistSans.variable} contents`}>
      <MaityChatLayout />
    </div>
  )
}
