'use client'

import dynamic from 'next/dynamic'
import { Suspense, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'

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
  const router = useRouter()

  // Esta ruta se alcanza por dos caminos: el gate de registro (entrada directa,
  // sin historial) y ahora también desde dentro de la app (CTA "Ver planes" del
  // detalle de conversación). `layout.tsx` excluye el Sidebar aquí, así que sin
  // este control el segundo camino deja al usuario atrapado. Se pinta solo si
  // hay a dónde volver, para no ofrecer un botón muerto durante el onboarding.
  const [canGoBack, setCanGoBack] = useState(false)
  useEffect(() => {
    setCanGoBack(window.history.length > 1)
  }, [])

  return (
    // Contenedor externo scrolleable: mismo patrón que /registration para que
    // el contenido más alto que la ventana sea accesible (globals.css impone
    // overflow:hidden en body; el scroll debe proveerse aquí).
    <div className="h-screen overflow-y-auto bg-background">
      {canGoBack && (
        <Button
          variant="ghost"
          size="sm"
          className="fixed left-4 top-4 z-50"
          onClick={() => router.back()}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Volver
        </Button>
      )}
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
