/**
 * Stub de `@maity/shared` — el package monorepo que la web usa. El desktop no
 * lo tiene, así que re-exportamos los símbolos que los componentes del web
 * importan desde aquí.
 *
 * Vía path alias en tsconfig: `"@maity/shared": ["./src/shared/maity-shared.ts"]`.
 */
'use client'

import { useMemo } from 'react'

// Asume que el desktop tiene su propio cliente supabase en `@/lib/supabase`.
export { supabase } from '@/lib/supabase'

/**
 * Stub de `useAvatarWithDefault` — la web devuelve un objeto config de voxel
 * avatar. El desktop no usa voxel avatars, así que devolvemos un objeto
 * estable que LazyVoxelAvatar ignora.
 */
export function useAvatarWithDefault(_userId?: string) {
  const avatar = useMemo(() => ({}), [])
  return { avatar }
}

/**
 * Stub mínimo de `PDFService` — la web usa esto para exportar el chat como PDF.
 * En el desktop la feature no es crítica todavía; devolvemos un no-op que
 * notifica al usuario que la exportación a PDF aún no está disponible.
 *
 * Cuando se quiera implementar PDF export en el desktop, reemplazar este stub
 * con una implementación real (probablemente vía comando Tauri o jsPDF).
 */
export const PDFService = {
  async generateChatDocumentPDF(_data: unknown): Promise<void> {
    // Lazy import de sonner para no acoplar el stub al toast system
    const { toast } = await import('sonner')
    toast.info('Exportar a PDF aún no está disponible en el desktop.')
  },
}
