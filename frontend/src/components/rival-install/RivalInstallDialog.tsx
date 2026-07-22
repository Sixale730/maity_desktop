'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { load } from '@tauri-apps/plugin-store'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { AlertTriangle, Trash2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { usePlatform } from '@/hooks/usePlatform'
import { logger } from '@/lib/logger'

/** Espejo de `RivalInstallInfo` en `src-tauri/src/rival_install.rs`. */
interface RivalInstallInfo {
  kind: string
  display_name: string
  version: string
  uninstall_string: string
  install_location: string
}

// Puente entre el clic "Quitar" y el re-arranque automático: durante el uninstall la app se
// cierra (el uninstaller NSIS mata maity-desktop.exe por nombre) y el orquestador la reabre.
// Este flag, persistido ANTES de invocar, dispara el toast de confirmación al volver a abrir.
const JUST_REMOVED_FILE = 'rival-install-just-removed.json'
const PENDING_KEY = 'pending'

/**
 * Aviso de instalación duplicada (Store ⇄ descarga directa).
 *
 * Cuando Maity corre bajo MSIX (Microsoft Store) y detecta la instalación NSIS de
 * descarga directa (que comparte la misma SQLite y provoca errores de DB por version-skew),
 * exige quitarla (sin opción de posponer). Enfoque pull-based: consulta `get_rival_install`
 * al montar (Rust devuelve `null` si no corre empaquetado o no hay rival). Solo en Windows.
 */
export function RivalInstallDialog() {
  const platform = usePlatform()
  const [rival, setRival] = useState<RivalInstallInfo | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [isUninstalling, setIsUninstalling] = useState(false)

  useEffect(() => {
    if (platform !== 'windows') return
    let cancelled = false

    const check = async () => {
      try {
        const info = await invoke<RivalInstallInfo | null>('get_rival_install')
        if (cancelled) return

        // Sin rival: si venimos de un uninstall exitoso (flag pending) y ya no hay rival,
        // confirmar al usuario que se resolvió y limpiar el flag.
        if (!info) {
          try {
            const jr = await load(JUST_REMOVED_FILE, { defaults: { [PENDING_KEY]: false } })
            if ((await jr.get<boolean>(PENDING_KEY)) ?? false) {
              toast.success('Se quitó la versión duplicada de Maity', {
                description: 'Ahora solo corre la versión de Microsoft Store. Tus datos y grabaciones están intactos.',
                duration: 6000,
              })
              await jr.set(PENDING_KEY, false)
              await jr.save()
            }
          } catch (e) {
            logger.warn('[RivalInstall] check just-removed falló:', e)
          }
          return
        }

        logger.info('[RivalInstall] Instalación rival detectada:', info.display_name, info.version)
        setRival(info)
        setIsOpen(true)
      } catch (err) {
        logger.warn('[RivalInstall] check falló:', err)
      }
    }

    void check()
    return () => { cancelled = true }
  }, [platform])

  const handleUninstall = useCallback(async () => {
    setIsUninstalling(true)

    // Persistir el flag ANTES de invocar: el uninstaller cerrará esta app (mata
    // maity-desktop.exe por nombre) y un orquestador desacoplado la reabrirá. El flag
    // dispara el toast de confirmación al volver a arrancar.
    try {
      const jr = await load(JUST_REMOVED_FILE, { defaults: { [PENDING_KEY]: false } })
      await jr.set(PENDING_KEY, true)
      await jr.save()
    } catch (e) {
      logger.warn('[RivalInstall] no se pudo persistir just-removed:', e)
    }

    toast.info('Quitando la versión duplicada…', {
      description: 'Maity se cerrará y se reiniciará automáticamente en unos segundos. No cierres nada.',
      duration: 15000,
    })

    try {
      await invoke('uninstall_rival')
    } catch (err) {
      logger.error('[RivalInstall] uninstall falló:', err)
      toast.error('No se pudo quitar la instalación duplicada', {
        description: err instanceof Error ? err.message : String(err),
        duration: 6000,
      })
      setIsUninstalling(false)
      try {
        const jr = await load(JUST_REMOVED_FILE, { defaults: { [PENDING_KEY]: false } })
        await jr.set(PENDING_KEY, false)
        await jr.save()
      } catch {
        /* noop */
      }
      return
    }

    // El orquestador desacoplado ya corre. Caso normal: el uninstaller cerrará esta app en
    // unos segundos y el orquestador la reabrirá (el toast de éxito sale al re-arrancar, vía
    // el flag). Caso borde (la app NO muere): hacemos polling; cuando el rival desaparece,
    // cerramos limpio aquí mismo para no dejar el spinner pegado.
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1500))
      try {
        const still = await invoke<RivalInstallInfo | null>('get_rival_install')
        if (!still) {
          toast.success('Se quitó la versión duplicada de Maity', {
            description: 'Ahora solo corre la versión de Microsoft Store. Tus datos y grabaciones están intactos.',
            duration: 6000,
          })
          try {
            const jr = await load(JUST_REMOVED_FILE, { defaults: { [PENDING_KEY]: false } })
            await jr.set(PENDING_KEY, false)
            await jr.save()
          } catch {
            /* noop */
          }
          setIsOpen(false)
          setRival(null)
          setIsUninstalling(false)
          return
        }
      } catch {
        /* seguir esperando */
      }
    }
    // Si tras el timeout la app sigue viva y el rival presente, re-habilitar para reintentar.
    setIsUninstalling(false)
  }, [])

  if (platform !== 'windows' || !rival) return null

  const versionLabel = rival.version ? `v${rival.version}` : 'descarga directa'

  return (
    <Dialog open={isOpen} onOpenChange={() => { /* forzado: no se puede posponer */ }}>
      <DialogContent
        className="sm:max-w-md [&>button]:hidden"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Instalación duplicada de Maity
          </DialogTitle>
          <DialogDescription>
            Tienes Maity instalado dos veces: la versión de <strong>Microsoft Store</strong> (la
            que estás usando) y una copia de <strong>descarga directa</strong> ({versionLabel}).
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Ambas comparten la misma base de datos y pueden entrar en conflicto (errores al abrir,
              micrófono ocupado, doble arranque). Para continuar hay que quitar la copia de descarga directa.
              <span className="mt-2 block font-medium">
                Tus datos, grabaciones y configuración no se pierden, y Maity se reiniciará solo.
              </span>
            </AlertDescription>
          </Alert>
        </div>

        <DialogFooter>
          <Button
            variant="destructive"
            onClick={handleUninstall}
            disabled={isUninstalling}
            className="w-full"
          >
            {isUninstalling ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Quitando y reiniciando…
              </>
            ) : (
              <>
                <Trash2 className="mr-2 h-4 w-4" />
                Quitar instalación duplicada
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default RivalInstallDialog
