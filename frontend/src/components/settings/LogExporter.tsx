'use client'

import React, { useState, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Button } from '@/components/ui/button'
import { FileArchive, FolderOpen, Trash2, Loader2, HardDrive } from 'lucide-react'
import { toast } from 'sonner'

interface LogInfo {
  log_directory: string | null
  total_size_bytes: number
  total_size_human: string
  file_count: number
  files: LogFileInfo[]
}

interface LogFileInfo {
  name: string
  size_bytes: number
  size_human: string
  modified: string | null
}

export function LogExporter() {
  const [isExporting, setIsExporting] = useState(false)
  const [isClearing, setIsClearing] = useState(false)
  const [logInfo, setLogInfo] = useState<LogInfo | null>(null)
  const [isLoadingInfo, setIsLoadingInfo] = useState(false)

  const loadLogInfo = useCallback(async () => {
    setIsLoadingInfo(true)
    try {
      const info = await invoke<LogInfo>('get_log_info')
      setLogInfo(info)
    } catch (error) {
      console.error('Failed to get log info:', error)
    } finally {
      setIsLoadingInfo(false)
    }
  }, [])

  // Load info on first render
  React.useEffect(() => {
    loadLogInfo()
  }, [loadLogInfo])

  const handleExportLogs = async () => {
    setIsExporting(true)
    try {
      const outputPath = await invoke<string>('export_logs', { outputPath: null })
      toast.success('Logs exportados exitosamente', {
        description: `Guardados en: ${outputPath}`,
      })
      // Refresh log info after export
      loadLogInfo()
    } catch (error: any) {
      console.error('Failed to export logs:', error)
      toast.error('Error al exportar logs', {
        description: error?.toString() || 'Error desconocido',
      })
    } finally {
      setIsExporting(false)
    }
  }

  const handleOpenLogDirectory = async () => {
    try {
      await invoke('open_log_directory')
    } catch (error: any) {
      console.error('Failed to open log directory:', error)
      toast.error('Error al abrir carpeta de logs', {
        description: error?.toString() || 'Error desconocido',
      })
    }
  }

  const handleClearOldLogs = async () => {
    setIsClearing(true)
    try {
      const deleted = await invoke<number>('clear_old_logs', { keepCount: 2 })
      if (deleted > 0) {
        toast.success(`${deleted} archivo(s) de log eliminados`)
      } else {
        toast.info('No hay logs antiguos para eliminar')
      }
      // Refresh log info after clearing
      loadLogInfo()
    } catch (error: any) {
      console.error('Failed to clear old logs:', error)
      toast.error('Error al limpiar logs', {
        description: error?.toString() || 'Error desconocido',
      })
    } finally {
      setIsClearing(false)
    }
  }

  return (
    <div className="bg-[#f5f5f6] dark:bg-gray-800 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <HardDrive className="h-4 w-4 text-[#4a4a4c] dark:text-gray-300" />
          <h3 className="font-semibold text-sm text-[#1a1a1a] dark:text-gray-100">Diagnóstico y Soporte</h3>
        </div>
        {logInfo && (
          <span className="text-xs text-[#6a6a6d] dark:text-gray-400">
            {logInfo.file_count} archivo(s) - {logInfo.total_size_human}
          </span>
        )}
      </div>

      <p className="text-xs text-[#4a4a4c] dark:text-gray-300">
        Exporta los logs de la aplicación para compartir con soporte técnico o para diagnóstico.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button
          onClick={handleExportLogs}
          disabled={isExporting || (logInfo?.file_count === 0)}
          variant="outline"
          size="sm"
          className="text-xs"
        >
          {isExporting ? (
            <>
              <Loader2 className="h-3 w-3 mr-2 animate-spin" />
              Exportando...
            </>
          ) : (
            <>
              <FileArchive className="h-3 w-3 mr-2" />
              Exportar Logs
            </>
          )}
        </Button>

        <Button
          onClick={handleOpenLogDirectory}
          disabled={!logInfo?.log_directory}
          variant="outline"
          size="sm"
          className="text-xs"
        >
          <FolderOpen className="h-3 w-3 mr-2" />
          Abrir Carpeta
        </Button>

        <Button
          onClick={handleClearOldLogs}
          disabled={isClearing || (logInfo?.file_count ?? 0) <= 2}
          variant="outline"
          size="sm"
          className="text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
        >
          {isClearing ? (
            <>
              <Loader2 className="h-3 w-3 mr-2 animate-spin" />
              Limpiando...
            </>
          ) : (
            <>
              <Trash2 className="h-3 w-3 mr-2" />
              Limpiar Antiguos
            </>
          )}
        </Button>
      </div>

      {logInfo?.log_directory && (
        <p className="text-xs text-[#8a8a8d] dark:text-gray-500 truncate" title={logInfo.log_directory}>
          Ubicación: {logInfo.log_directory}
        </p>
      )}
    </div>
  )
}

export default LogExporter
