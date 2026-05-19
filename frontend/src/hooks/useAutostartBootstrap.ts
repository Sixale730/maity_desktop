'use client';

import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { enable, isEnabled } from '@tauri-apps/plugin-autostart';
import { load } from '@tauri-apps/plugin-store';
import { toast } from 'sonner';
import { logger } from '@/lib/logger';

const STORE_FILE = 'autostart-bootstrapped.json';
const FLAG_KEY = 'done';

// Pref del coach-float (la ÚNICA ventana flotante de la app per commit 45a4cbd).
// El bootstrap fuerza esto a true junto al enable del autostart, garantizando que
// el modal aparezca al primer arranque post-instalación aunque algún test previo
// haya quedado con la pref en false. Es una red de seguridad — el override en
// lib.rs setup() también lo aplica cada vez que se arranca por autostart.
const COACH_PREFS_FILE = 'widget-preferences.json';
const COACH_VISIBLE_KEY = 'coach_float_visible';

/**
 * Bootstrap one-shot del autostart del OS (US-1 del plan).
 *
 * Comportamiento esperado:
 * - Al primer arranque post-instalación, si estamos en un build de release,
 *   registra el ejecutable en el autostart del OS (Run key Windows / LaunchAgent macOS /
 *   .desktop Linux) sin preguntar al usuario, y muestra un toast informativo.
 * - Persiste un flag en `autostart-bootstrapped.json` para que no se vuelva a ejecutar.
 * - Si Maity se reinstala tras un uninstall, el store vive en `%APPDATA%\com.maity.ai\`
 *   y el desinstalador NO lo borra, así el flag persiste — pero si el usuario borra
 *   manualmente el folder o usa un installer que limpie, el bootstrap se reaplica.
 *
 * El bootstrap NO corre en builds debug (`cfg!(debug_assertions)`) — evitamos registrar
 * paths de `target/debug/` que dejarían un autostart inválido tras `cargo clean`.
 *
 * Si el usuario después desactiva el toggle desde Settings, el bootstrap NO lo vuelve a
 * activar (el flag persistido es independiente del estado real del registry: una vez
 * marcado `done=true`, respeta la decisión del usuario).
 */
export function useAutostartBootstrap() {
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    const run = async () => {
      try {
        const isProduction = await invoke<boolean>('is_production_build');
        if (!isProduction) {
          logger.debug('[AutostartBootstrap] skipping in dev build');
          return;
        }

        // StoreOptions del plugin-store requiere `defaults`; pasamos el flag en false
        // así la primera lectura tras instalación devuelve false y dispara el bootstrap.
        const store = await load(STORE_FILE, { defaults: { [FLAG_KEY]: false } });
        const done = (await store.get<boolean>(FLAG_KEY)) ?? false;
        if (done) {
          logger.debug('[AutostartBootstrap] flag already set, skipping');
          return;
        }

        const alreadyEnabled = await isEnabled().catch(() => false);
        if (!alreadyEnabled) {
          await enable();
          toast.success('Maity se iniciará con tu PC', {
            description: 'El modal de grabación aparecerá listo para usar. Puedes desactivarlo en Configuración → Preferencias.',
            duration: 6000,
          });
          logger.info('[AutostartBootstrap] autostart enabled (first run)');
        } else {
          logger.debug('[AutostartBootstrap] OS already had autostart enabled, just marking flag');
        }

        // Forzar la pref de visibilidad del coach-float a true. Si una sesión previa
        // dejó la pref en false (por ej. usuario cerró el modal con la X durante
        // testing), el primer arranque post-instalación con autostart on debe garantizar
        // que el modal aparezca — el coach-float es el único entry point cuando la
        // main window está minimizada por boot del OS.
        try {
          const coachStore = await load(COACH_PREFS_FILE, { defaults: { [COACH_VISIBLE_KEY]: true } });
          await coachStore.set(COACH_VISIBLE_KEY, true);
          await coachStore.save();
          logger.debug('[AutostartBootstrap] coach_float_visible forzado a true');
        } catch (e) {
          logger.warn('[AutostartBootstrap] no se pudo forzar coach_float_visible:', e);
        }

        await store.set(FLAG_KEY, true);
        await store.save();
      } catch (err) {
        logger.warn('[AutostartBootstrap] bootstrap failed:', err);
      }
    };

    void run();
  }, []);
}
