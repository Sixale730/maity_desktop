'use client'

/**
 * DbInitErrorGate: blocking screen that intercepts the entire app when the
 * Rust side reports `db-init-failed` during startup.
 *
 * Without this gate the user would reach the main menu, navigate around (auth
 * works against Supabase, dashboard reads from cloud), and only discover the
 * broken state when trying to record — at which point engine.rs:240 surfaces
 * "La base de datos no se pudo inicializar" without any way to recover. This
 * component listens for the same failure earlier and offers a one-click reset
 * (backup + rename, app must be restarted manually) plus log export.
 *
 * Mounted OUTSIDE AuthProvider in layout.tsx so it can block before auth runs.
 */

import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { AlertTriangle, RefreshCw, FileArchive, X, CheckCircle2 } from 'lucide-react'

interface DbInitErrorPayload {
  error: string
  sqlitePath: string
}

type ResetState = 'idle' | 'resetting' | 'done' | 'failed'

export function DbInitErrorGate({ children }: { children: React.ReactNode }) {
  const [errorPayload, setErrorPayload] = useState<DbInitErrorPayload | null>(null)
  const [resetState, setResetState] = useState<ResetState>('idle')
  const [resetMessage, setResetMessage] = useState<string>('')
  const [isExporting, setIsExporting] = useState(false)
  const [exportPath, setExportPath] = useState<string | null>(null)

  useEffect(() => {
    const unlistenPromise = listen<DbInitErrorPayload>('db-init-failed', (event) => {
      console.error('[DbInitErrorGate] db-init-failed event:', event.payload)
      setErrorPayload(event.payload)
    })
    return () => {
      void unlistenPromise.then((fn) => fn())
    }
  }, [])

  if (!errorPayload) {
    return <>{children}</>
  }

  const handleReset = async () => {
    if (!window.confirm(
      'Se hará una copia de respaldo de tu base de datos local actual y se renombrará. ' +
      'Tendrás que cerrar y volver a abrir Maity. ¿Continuar?'
    )) {
      return
    }
    setResetState('resetting')
    try {
      const backupPath = await invoke<string>('reset_database')
      setResetState('done')
      setResetMessage(
        backupPath
          ? `Respaldado en: ${backupPath}\n\nCierra y vuelve a abrir Maity.`
          : 'No había base de datos que respaldar. Cierra y vuelve a abrir Maity.'
      )
    } catch (err) {
      setResetState('failed')
      setResetMessage(err instanceof Error ? err.message : String(err))
    }
  }

  const handleExportLogs = async () => {
    setIsExporting(true)
    try {
      const path = await invoke<string>('export_logs', { outputPath: null })
      setExportPath(path)
    } catch (err) {
      console.error('[DbInitErrorGate] export_logs failed:', err)
      setExportPath(null)
    } finally {
      setIsExporting(false)
    }
  }

  const handleClose = async () => {
    try {
      await getCurrentWindow().close()
    } catch (err) {
      console.error('[DbInitErrorGate] window.close failed:', err)
    }
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black p-6">
      <div className="max-w-xl w-full bg-zinc-900 border border-red-500/30 rounded-2xl p-8 shadow-2xl">
        <div className="flex items-start gap-4 mb-5">
          <div className="shrink-0 w-12 h-12 rounded-full bg-red-500/15 flex items-center justify-center">
            <AlertTriangle className="w-6 h-6 text-red-400" />
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-semibold text-white mb-1">
              No se pudo iniciar la base de datos local
            </h2>
            <p className="text-sm text-zinc-400">
              Maity no puede arrancar correctamente. Esto suele pasar tras una actualización
              que modificó migraciones, una corrupción del archivo (apagón / antivirus), o
              porque otro proceso lo dejó bloqueado.
            </p>
          </div>
        </div>

        <details className="mb-5 text-xs text-zinc-500">
          <summary className="cursor-pointer hover:text-zinc-300 transition-colors">
            Detalle técnico
          </summary>
          <pre className="mt-2 p-3 bg-black/40 rounded-lg overflow-auto whitespace-pre-wrap break-words text-zinc-400">
            {errorPayload.error}
            {errorPayload.sqlitePath && `\n\nArchivo: ${errorPayload.sqlitePath}`}
          </pre>
        </details>

        {resetState === 'done' && (
          <div className="mb-5 p-3 bg-green-500/10 border border-green-500/20 rounded-lg flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0 mt-0.5" />
            <pre className="text-xs text-zinc-300 whitespace-pre-wrap break-words flex-1">
              {resetMessage}
            </pre>
          </div>
        )}

        {resetState === 'failed' && (
          <div className="mb-5 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
            <p className="text-xs text-red-300 mb-1 font-medium">No se pudo restablecer:</p>
            <pre className="text-xs text-zinc-300 whitespace-pre-wrap break-words">{resetMessage}</pre>
          </div>
        )}

        {exportPath && (
          <div className="mb-5 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg flex items-start gap-2">
            <FileArchive className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
            <p className="text-xs text-zinc-300 break-all flex-1">
              Logs exportados a: <span className="font-mono">{exportPath}</span>
            </p>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <button
            onClick={handleReset}
            disabled={resetState === 'resetting' || resetState === 'done'}
            className="w-full px-4 py-2.5 rounded-lg bg-red-600 hover:bg-red-500 disabled:bg-zinc-700 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors flex items-center justify-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${resetState === 'resetting' ? 'animate-spin' : ''}`} />
            {resetState === 'resetting'
              ? 'Restableciendo...'
              : resetState === 'done'
                ? 'Base de datos restablecida'
                : 'Restablecer base de datos'}
          </button>

          <button
            onClick={handleExportLogs}
            disabled={isExporting}
            className="w-full px-4 py-2.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-800 text-zinc-200 text-sm font-medium transition-colors flex items-center justify-center gap-2"
          >
            <FileArchive className={`w-4 h-4 ${isExporting ? 'animate-pulse' : ''}`} />
            {isExporting ? 'Exportando...' : 'Exportar logs'}
          </button>

          <button
            onClick={handleClose}
            className="w-full px-4 py-2.5 rounded-lg bg-transparent hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 text-sm font-medium transition-colors flex items-center justify-center gap-2"
          >
            <X className="w-4 h-4" />
            Cerrar Maity
          </button>
        </div>

        <p className="mt-5 text-xs text-zinc-600 text-center">
          Si el problema persiste tras restablecer, exporta los logs y compártelos con soporte.
        </p>
      </div>
    </div>
  )
}
