'use client'

import dynamic from 'next/dynamic'
import { Suspense } from 'react'

// Dynamic import ssr:false para aislar three.js/framer-motion al chunk de esta ruta
// y evitar errores de prerender en el build de Next.js
const Registration = dynamic(
  () => import('@/features/auth/pages/Registration'),
  { ssr: false }
)

export default function RegistrationPage() {
  return (
    // Contenedor externo scrolleable: h-screen overflow-y-auto para que el contenido
    // más alto que la ventana sea accesible (botón "Continuar" inaccesible sin esto
    // cuando globals.css impone overflow:hidden en body).
    // El wrapper inner min-h-full centra cuando cabe, scrollea cuando no.
    <div className="h-screen overflow-y-auto bg-background">
      <div className="min-h-full flex items-center justify-center p-4">
        <Suspense fallback={<div className="flex h-screen items-center justify-center bg-black" />}>
          <Registration />
        </Suspense>
      </div>
    </div>
  )
}
