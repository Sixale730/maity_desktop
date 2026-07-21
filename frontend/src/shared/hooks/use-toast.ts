/**
 * Shim de use-toast sobre sonner.
 * La web usa { useToast, toast } con variante "destructive" para errores.
 * En el desktop usamos sonner directamente.
 *
 * Exporta { useToast, toast } con la misma API que shadcn/ui useToast.
 */
import { toast as sonnerToast } from 'sonner'

type ToastVariant = 'default' | 'destructive'

interface ToastOptions {
  title?: string
  description?: string
  variant?: ToastVariant
  duration?: number
}

function toastCompat({ title, description, variant, duration }: ToastOptions) {
  const message = title ?? ''
  const detail = description

  if (variant === 'destructive') {
    sonnerToast.error(message, { description: detail, duration })
  } else {
    sonnerToast.success(message, { description: detail, duration })
  }
}

export function useToast() {
  return {
    toast: toastCompat,
  }
}

// También exportar toast directo para los casos donde se usa como función
export { toastCompat as toast }
