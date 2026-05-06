export function translateAuthError(error: unknown): string {
  const msg = (error instanceof Error ? error.message : String(error ?? '')).toLowerCase()
  if (msg.includes('invalid login credentials')) return 'Email o contraseña incorrectos.'
  if (msg.includes('email not confirmed')) return 'Confirma tu correo antes de iniciar sesión. Revisa tu bandeja de entrada.'
  if (msg.includes('user already registered')) return 'Ya existe una cuenta con este correo.'
  if (msg.includes('password should be at least')) return 'La contraseña no cumple los requisitos mínimos.'
  if (msg.includes('rate limit')) return 'Demasiados intentos. Espera unos minutos antes de reintentar.'
  if (msg.includes('network') || msg.includes('failed to fetch')) return 'Sin conexión. Verifica tu internet.'
  return (error instanceof Error && error.message) || 'Error inesperado. Intenta de nuevo.'
}
