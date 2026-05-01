import React from 'react';
import { Download } from 'lucide-react';
import { toast } from 'sonner';
import { UpdateInfo } from '@/services/updateService';

let globalShowDialogCallback: (() => void) | null = null;

export function setUpdateDialogCallback(callback: () => void) {
  globalShowDialogCallback = callback;
}

export function showUpdateNotification(updateInfo: UpdateInfo, onUpdateClick?: () => void) {
  const handleClick = () => {
    if (onUpdateClick) {
      onUpdateClick();
    } else if (globalShowDialogCallback) {
      globalShowDialogCallback();
    }
  };

  toast.info(
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-2">
        <Download className="h-4 w-4" />
        <div>
          <p className="font-medium">Actualización Disponible</p>
          <p className="text-sm text-muted-foreground">
            Versión {updateInfo.version} ya está disponible
          </p>
        </div>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          handleClick();
        }}
        className="text-sm font-medium text-[#3a4ac3] hover:text-[#2b3892] underline"
      >
        Ver Detalles
      </button>
    </div>,
    {
      // Persistente: el user lo cierra explicitamente o abre el dialog.
      // Antes era 10s y se perdia si el user no estaba mirando la pantalla.
      duration: Infinity,
      position: 'bottom-center',
      closeButton: true,
    }
  );
}
