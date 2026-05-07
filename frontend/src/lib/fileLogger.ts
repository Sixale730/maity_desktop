/**
 * File logger bridge: opt-in wrapper that pipes diagnosis-critical events
 * from the frontend into the Rust file logger via a Tauri command.
 *
 * The default `@/lib/logger` writes only to `console.*` and is invisible
 * after the session ends. `fileLogger` additionally invokes the Rust
 * `log_frontend_event` command so messages land in the daily file appender
 * (`maity.YYYY-MM-DD.log`) and are included in the export ZIP that users
 * share for support.
 *
 * Use this for explicit instrumentation only — auth state transitions,
 * dashboard query lifecycle, anything you need to grep in a user's exported
 * logs. Do NOT route every existing `logger.warn` through here; volume.
 */
import { invoke } from '@tauri-apps/api/core'
import { logger } from './logger'

type Level = 'error' | 'warn' | 'info'

async function send(level: Level, target: string, message: string, context?: unknown) {
  const formatted = `[${target}] ${message}`
  if (level === 'error') logger.error(formatted, context ?? '')
  else if (level === 'warn') logger.warn(formatted, context ?? '')
  else logger.info(formatted, context ?? '')

  try {
    await invoke('log_frontend_event', {
      level,
      target,
      message,
      context: context === undefined ? null : context,
    })
  } catch {
    // Bridge unavailable (e.g. running in pure browser dev outside Tauri).
    // Swallow — console output above still surfaces the event live.
  }
}

export const fileLogger = {
  error: (target: string, message: string, ctx?: unknown) => send('error', target, message, ctx),
  warn: (target: string, message: string, ctx?: unknown) => send('warn', target, message, ctx),
  info: (target: string, message: string, ctx?: unknown) => send('info', target, message, ctx),
}
