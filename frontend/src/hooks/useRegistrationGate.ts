'use client'

import { useQuery } from '@tanstack/react-query'
import { AuthService } from '@maity/shared'

/**
 * Verifica el estado de registro del usuario vía RPC `my_status`.
 * Devuelve registration_form_completed para que AppContent pueda
 * redirigir a /registration si es false.
 *
 * El gate se activa entre showOnboarding y modelGateActive en layout.tsx.
 * Solo cuentas con registration_form_completed===false ven /registration;
 * cuentas activas conservan el flujo actual sin cambios.
 */
export function useRegistrationGate() {
  const query = useQuery({
    queryKey: ['user', 'status'],
    queryFn: async () => {
      const statuses = await AuthService.getMyStatus()
      return statuses[0] ?? null
    },
    staleTime: 60 * 1000,
    retry: 1,
  })

  const status = query.data

  return {
    isLoading: query.isLoading,
    isError: query.isError,
    /** null = no data todavía (cargando o error); true/false = determinado */
    registrationFormCompleted: status?.registration_form_completed ?? null,
    invalidate: () => query.refetch(),
  }
}
