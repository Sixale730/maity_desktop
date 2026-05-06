'use client'

import React from 'react'
import { Check, X } from 'lucide-react'
import { validatePassword } from '@/lib/password-validation'

interface PasswordStrengthIndicatorProps {
  password: string
}

export function PasswordStrengthIndicator({ password }: PasswordStrengthIndicatorProps) {
  if (password.length === 0) return null

  const { rules } = validatePassword(password)

  return (
    <ul className="mt-2 space-y-1">
      {rules.map((rule, index) => (
        <li
          key={index}
          className="flex items-center gap-2 text-xs"
        >
          {rule.met ? (
            <Check className="w-3.5 h-3.5 text-green-600 dark:text-green-400 shrink-0" />
          ) : (
            <X className="w-3.5 h-3.5 text-[#9a9a9d] dark:text-gray-500 shrink-0" />
          )}
          <span
            className={
              rule.met
                ? 'text-green-700 dark:text-green-400'
                : 'text-[#6a6a6d] dark:text-gray-400'
            }
          >
            {rule.label}
          </span>
        </li>
      ))}
    </ul>
  )
}
