'use client'

import { useState } from 'react'
import { useOnboarding } from '@/contexts/OnboardingContext'
import { CheckCircle2, X, AlertCircle, Download } from 'lucide-react'

/**
 * Widget compacto que muestra el progreso de las descargas de modelos.
 *
 * Por defecto es una BOLITA redonda (bottom-4 right-4) con un anillo de progreso
 * con el % combinado. Al hacer clic se EXPANDE al modal completo con las filas
 * Parakeet / Gemma. Se auto-oculta cuando ambos modelos están descargados o cuando
 * no hay actividad (para no aparecer inerte en cuentas con los modelos ya presentes).
 *
 * Es la ÚNICA superficie de progreso de descarga de modelos (se eliminó
 * DownloadProgressToastProvider). Las descargas las arranca WelcomeStep
 * ("Bienvenido a Maity", cuentas nuevas) o BackgroundDownloadStarter (cuentas
 * existentes sin modelo) vía startBackgroundDownloads.
 */
export function OnboardingDownloadWidget() {
  const {
    parakeetDownloaded,
    parakeetProgressInfo,
    summaryModelDownloaded,
    summaryModelReady,
    summaryModelProgressInfo,
    isBackgroundDownloading,
    retryParakeetDownload,
  } = useOnboarding()

  // Arranca colapsado como bolita; el usuario expande al modal con un clic.
  const [expanded, setExpanded] = useState(false)

  // No mostrar si ya no falta nada. `summaryModelReady`, no
  // `summaryModelDownloaded`: en tier Low el modelo de resumen no se descarga
  // nunca, así que el segundo se queda en `false` y el widget no se cerraría jamás.
  if (parakeetDownloaded && summaryModelReady) return null

  const parakeetError =
    !parakeetDownloaded &&
    !isBackgroundDownloading &&
    parakeetProgressInfo.percent === 0 &&
    parakeetProgressInfo.totalMb === 0 &&
    parakeetProgressInfo.downloadedMb > 0 // solo error si hubo bytes previos

  const hasActivity =
    isBackgroundDownloading ||
    parakeetProgressInfo.percent > 0 ||
    parakeetProgressInfo.totalMb > 0 ||
    summaryModelProgressInfo.percent > 0 ||
    summaryModelProgressInfo.totalMb > 0 ||
    parakeetError

  if (!hasActivity) return null

  // % combinado: promedio de las descargas aún no completadas (si solo una está
  // activa, usa esa). Sirve para el anillo de la bolita.
  const parts: number[] = []
  if (!parakeetDownloaded) parts.push(Math.min(parakeetProgressInfo.percent, 100))
  if (!summaryModelReady) parts.push(Math.min(summaryModelProgressInfo.percent, 100))
  const combinedPercent = parts.length
    ? Math.round(parts.reduce((a, b) => a + b, 0) / parts.length)
    : 0

  const parakeetPreparing =
    !parakeetDownloaded &&
    !parakeetError &&
    parakeetProgressInfo.percent === 0 &&
    parakeetProgressInfo.totalMb === 0

  // ---- BOLITA (colapsada) ----
  if (!expanded) {
    const R = 22
    const C = 2 * Math.PI * R
    const dash = (Math.min(combinedPercent, 100) / 100) * C
    return (
      <button
        onClick={() => setExpanded(true)}
        aria-label="Ver progreso de descarga de modelos"
        title={`Descargando modelos · ${combinedPercent}%`}
        className="fixed bottom-4 right-4 z-50 h-14 w-14 rounded-full bg-zinc-900 border border-zinc-700 shadow-xl flex items-center justify-center hover:scale-105 transition-transform"
      >
        <svg className="absolute inset-0 h-14 w-14 -rotate-90" viewBox="0 0 56 56">
          <circle cx="28" cy="28" r={R} fill="none" stroke="rgb(39 39 42)" strokeWidth="4" />
          <circle
            cx="28"
            cy="28"
            r={R}
            fill="none"
            stroke={parakeetError ? 'rgb(248 113 113)' : 'rgb(139 92 246)'}
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${C}`}
            className="transition-all duration-300"
          />
        </svg>
        {parakeetError ? (
          <AlertCircle className="h-5 w-5 text-red-400" />
        ) : (
          <span className="relative flex flex-col items-center leading-none">
            <Download className="h-3.5 w-3.5 text-violet-400" />
            <span className="mt-0.5 text-[10px] font-semibold text-white tabular-nums">
              {combinedPercent}%
            </span>
          </span>
        )}
      </button>
    )
  }

  // ---- MODAL (expandido) ----
  const renderRow = ({
    label,
    done,
    percent,
    downloadedMb,
    totalMb,
    speedMbps,
    hasError,
    isPreparing,
    onRetry,
  }: {
    label: string
    done: boolean
    percent: number
    downloadedMb: number
    totalMb: number
    speedMbps: number
    hasError?: boolean
    isPreparing?: boolean
    onRetry?: () => void
  }) => (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="flex items-center gap-1">
          {done ? (
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          ) : hasError ? (
            <button
              onClick={onRetry}
              className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300"
            >
              <AlertCircle className="h-3 w-3" />
              Reintentar
            </button>
          ) : isPreparing ? (
            <span className="text-xs text-muted-foreground">Preparando descarga…</span>
          ) : (
            <span className="text-xs text-muted-foreground">
              {percent > 0 ? `${percent}%` : 'Iniciando...'}
              {speedMbps > 0 && ` · ${speedMbps.toFixed(1)} MB/s`}
            </span>
          )}
        </span>
      </div>
      {!done && !hasError && !isPreparing && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full bg-violet-500 transition-all duration-300"
            style={{ width: `${Math.min(percent, 100)}%` }}
          />
        </div>
      )}
      {!done && totalMb > 0 && (
        <p className="text-xs text-muted-foreground">
          {downloadedMb.toFixed(1)} / {totalMb.toFixed(0)} MB
        </p>
      )}
    </div>
  )

  return (
    <div className="fixed bottom-4 right-4 z-50 w-72 rounded-xl border border-zinc-700 bg-zinc-900 p-4 shadow-xl">
      <div className="flex w-full items-center justify-between text-sm font-medium text-white">
        <span>Descargando modelos</span>
        <button
          onClick={() => setExpanded(false)}
          aria-label="Minimizar"
          title="Minimizar"
          className="text-muted-foreground hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 flex flex-col gap-3">
        {!parakeetDownloaded &&
          renderRow({
            label: 'Voz (Parakeet)',
            done: parakeetDownloaded,
            percent: parakeetProgressInfo.percent,
            downloadedMb: parakeetProgressInfo.downloadedMb,
            totalMb: parakeetProgressInfo.totalMb,
            speedMbps: parakeetProgressInfo.speedMbps,
            hasError: parakeetError,
            isPreparing: parakeetPreparing,
            onRetry: () => void retryParakeetDownload(),
          })}
        {!summaryModelReady &&
          renderRow({
            label: 'Análisis (Gemma)',
            done: summaryModelDownloaded,
            percent: summaryModelProgressInfo.percent,
            downloadedMb: summaryModelProgressInfo.downloadedMb,
            totalMb: summaryModelProgressInfo.totalMb,
            speedMbps: summaryModelProgressInfo.speedMbps,
            // Gemma no tiene retry expuesto en el contexto; solo muestra progreso.
          })}

        <p className="text-xs text-muted-foreground">
          Los modelos se usan localmente para transcribir y analizar reuniones.
        </p>
      </div>
    </div>
  )
}
