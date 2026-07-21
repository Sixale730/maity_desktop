'use client'

import dynamic from 'next/dynamic'
import { Suspense } from 'react'

// Dynamic import ssr:false — PlanSelection usa useSearchParams (location.search)
// que requiere Suspense, y también usa framer-motion/three indirectamente.
const PlanSelection = dynamic(
  () =>
    import('@/features/billing/components/PlanSelection').then((m) => ({
      default: m.PlanSelection,
    })),
  { ssr: false }
)

export default function BillingPlansPage() {
  return (
    // Contenedor externo scrolleable: mismo patrón que /registration para que
    // el contenido más alto que la ventana sea accesible (globals.css impone
    // overflow:hidden en body; el scroll debe proveerse aquí).
    <div className="h-screen overflow-y-auto bg-background">
      <div className="min-h-full flex items-center justify-center p-4">
        <Suspense fallback={<div className="flex h-screen items-center justify-center bg-black" />}>
          <div className="w-full max-w-5xl py-8">
            <h1 className="mb-2 text-center text-3xl font-bold">Elige tu plan</h1>
            <p className="mb-8 text-center text-muted-foreground">
              Acceso completo a todas las funciones de Maity
            </p>
            {/* showEnterprise=false para usuarios regulares con company_id */}
            <PlanSelection showEnterprise={false} />
          </div>
        </Suspense>
      </div>
    </div>
  )
}
