'use client';

import React, { useEffect, useRef, useState } from 'react';
import { User, LogOut } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Indicador de cuenta para las pantallas de onboarding.
 *
 * Por defecto es un ICONO REDONDO (avatar) fijo en la esquina superior derecha.
 * Al hacer clic se despliega un menú con nombre, email y botón de cerrar sesión.
 * El Sidebar (donde normalmente vive este control) no se monta durante el
 * onboarding, así que este badge lo replica.
 *
 * z-[60] para quedar por encima de overlays de onboarding. Va top-right;
 * OnboardingDownloadWidget vive bottom-right, así que no chocan.
 */
export function OnboardingAccountBadge() {
  const { user, maityUser, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Cerrar al hacer clic fuera
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  if (!user) return null;

  const displayName =
    (maityUser?.first_name
      ? `${maityUser.first_name}${maityUser.last_name ? ' ' + maityUser.last_name : ''}`
      : null) ||
    user?.user_metadata?.full_name ||
    user?.email?.split('@')[0] ||
    'Invitado';
  const displayEmail = maityUser?.email || user?.email || 'Sin sesión iniciada';

  return (
    <div ref={rootRef} className="fixed top-4 right-4 z-[60]">
      {/* Icono redondo */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Cuenta"
        title={displayEmail}
        aria-expanded={open}
        className="h-10 w-10 rounded-full bg-primary/15 text-primary border border-border shadow-md backdrop-blur-sm flex items-center justify-center hover:bg-primary/25 transition-colors"
      >
        <User className="w-5 h-5" />
      </button>

      {/* Menú desplegable */}
      {open && (
        <div className="absolute top-12 right-0 w-64 rounded-lg bg-card border border-border shadow-xl p-3 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-full bg-primary/15 text-primary flex items-center justify-center flex-shrink-0">
              <User className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-foreground truncate">{displayName}</div>
              <div className="text-xs text-muted-foreground truncate">{displayEmail}</div>
            </div>
          </div>
          <button
            onClick={() => {
              setOpen(false);
              void signOut();
            }}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-lg bg-secondary hover:bg-secondary/80 text-foreground transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Cerrar sesión
          </button>
        </div>
      )}
    </div>
  );
}
