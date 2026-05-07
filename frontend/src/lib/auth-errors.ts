type AuthErrorLike = { code?: string; message?: string; status?: number }

const OVER_EMAIL_SEND_RATE_LIMIT = 'over_email_send_rate_limit'

export function isOverEmailSendRateLimit(error: unknown): boolean {
  const e = error as AuthErrorLike
  if (e?.code === OVER_EMAIL_SEND_RATE_LIMIT) return true
  const msg = (e?.message ?? '').toLowerCase()
  return msg.includes('email rate limit exceeded') || msg.includes(OVER_EMAIL_SEND_RATE_LIMIT)
}

export function translateAuthError(error: unknown): string {
  const e = error as AuthErrorLike
  const msg = (e?.message ?? (error instanceof Error ? error.message : String(error ?? ''))).toLowerCase()
  if (isOverEmailSendRateLimit(error)) {
    return 'Estamos recibiendo muchos registros en este momento. Vuelve a intentarlo en ~1 hora, o regístrate con Google/Microsoft/Apple.'
  }
  if (msg.includes('invalid login credentials')) return 'Email o contraseña incorrectos.'
  if (msg.includes('email not confirmed')) return 'Confirma tu correo antes de iniciar sesión. Revisa tu bandeja de entrada.'
  if (msg.includes('user already registered')) return 'Ya existe una cuenta con este correo.'
  if (msg.includes('password should be at least')) return 'La contraseña no cumple los requisitos mínimos.'
  if (msg.includes('rate limit') || e?.status === 429) return 'Demasiados intentos. Espera unos minutos antes de reintentar.'
  if (msg.includes('network') || msg.includes('failed to fetch')) return 'Sin conexión. Verifica tu internet.'
  if (msg.includes('timeout') || msg.includes('aborted')) return 'La solicitud tardó demasiado. Verifica tu conexión e intenta de nuevo.'
  return (error instanceof Error && error.message) || 'Error inesperado. Intenta de nuevo.'
}
