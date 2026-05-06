export interface PasswordRule { label: string; met: boolean }

export function validatePassword(password: string): { isValid: boolean; rules: PasswordRule[] } {
  const rules: PasswordRule[] = [
    { label: 'Mínimo 8 caracteres', met: password.length >= 8 },
    { label: 'Al menos 1 mayúscula', met: /[A-Z]/.test(password) },
    { label: 'Al menos 1 minúscula', met: /[a-z]/.test(password) },
    { label: 'Al menos 1 número', met: /[0-9]/.test(password) },
    { label: 'Al menos 1 carácter especial', met: /[!@#$%^&*()_+\-=[\]{}|;:,.<>?]/.test(password) },
  ]
  return { isValid: rules.every((r) => r.met), rules }
}
