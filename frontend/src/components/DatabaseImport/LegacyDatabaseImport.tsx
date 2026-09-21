'use client';

import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Loader2, FolderOpen, Database, CheckCircle2, XCircle } from 'lucide-react';
import { HomebrewDatabaseDetector } from './HomebrewDatabaseDetector';

interface LegacyDatabaseImportProps {
  isOpen: boolean;
  onComplete: () => void;
}

type ImportState = 'idle' | 'selecting' | 'detecting' | 'importing' | 'success' | 'error';

export function LegacyDatabaseImport({ isOpen, onComplete }: LegacyDatabaseImportProps) {
  const [importState, setImportState] = useState<ImportState>('idle');
  const [detectedPath, setDetectedPath] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');

  const handleBrowse = async () => {
    try {
      setImportState('selecting');

      // Open file picker
      const selectedPath = await invoke<string | null>('select_legacy_database_path');

      if (!selectedPath) {
        setImportState('idle');
        return;
      }

      setImportState('detecting');

      // Detect database from selected path
      const dbPath = await invoke<string | null>('detect_legacy_database', {
        selectedPath,
      });

      if (dbPath) {
        setDetectedPath(dbPath);
        setImportState('idle');
      } else {
        setErrorMessage('No se encontró base de datos en la ubicación seleccionada. Por favor selecciona la carpeta Maity, carpeta backend o el archivo de base de datos directamente.');
        setDetectedPath(null);
        setImportState('error');
        setTimeout(() => setImportState('idle'), 3000);
      }
    } catch (error) {
      console.error('Error browsing for database:', error);
      setErrorMessage(String(error));
      setImportState('error');
      setTimeout(() => setImportState('idle'), 3000);
    }
  };

  const handleImport = async () => {
    if (!detectedPath) return;

    try {
      setImportState('importing');

      await invoke('import_and_initialize_database', {
        legacyDbPath: detectedPath,
      });

      setImportState('success');
      toast.success('¡Base de datos importada exitosamente! Recargando...');

      // Wait 1 second for user to see success, then reload window to refresh all data
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } catch (error) {
      console.error('Error importing database:', error);
      setErrorMessage(String(error));
      setImportState('error');
      toast.error(`Error al importar: ${error}`);
      setTimeout(() => setImportState('idle'), 3000);
    }
  };

  const handleStartFresh = async () => {
    try {
      setImportState('importing');

      await invoke('initialize_fresh_database');

      setImportState('success');
      toast.success('¡Base de datos inicializada exitosamente! Iniciando aplicación...');

      // Wait 1 second for user to see success, then reload window to start fresh
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } catch (error) {
      console.error('Error initializing database:', error);
      setErrorMessage(String(error));
      setImportState('error');
      toast.error(`Error de inicialización: ${error}`);
      setTimeout(() => setImportState('idle'), 3000);
    }
  };

  const isLoading = ['selecting', 'detecting', 'importing'].includes(importState);
  const canImport = detectedPath && importState === 'idle';

  const handleHomebrewImportSuccess = () => {
    // The HomebrewDatabaseDetector handles the reload itself
    onComplete();
  };

  const handleHomebrewDecline = () => {
    // User declined homebrew import, they can continue with manual browse
  };

  return (
    <Dialog open={isOpen} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-[600px]" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="text-2xl">¡Bienvenido a Maity!</DialogTitle>
          <DialogDescription className="text-base pt-2">
            ¿Tienes datos de una instalación anterior de Maity?
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Homebrew Database Auto-Detection */}
          <HomebrewDatabaseDetector 
            onImportSuccess={handleHomebrewImportSuccess}
            onDecline={handleHomebrewDecline}
          />

          {/* Browse Section */}
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Selecciona tu carpeta anterior de Maity, directorio backend o archivo de base de datos:
            </p>

            <button
              onClick={handleBrowse}
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-[#3a4ac3] text-white rounded-lg hover:bg-[#2b3892] disabled:bg-[#8a8a8d] disabled:cursor-not-allowed transition-colors"
            >
              {importState === 'selecting' || importState === 'detecting' ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span>{importState === 'selecting' ? 'Seleccionando...' : 'Detectando base de datos...'}</span>
                </>
              ) : (
                <>
                  <FolderOpen className="h-5 w-5" />
                  <span>Buscar Base de Datos</span>
                </>
              )}
            </button>
          </div>

          {/* Detection Result */}
          {detectedPath && (
            <div className="p-3 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 rounded-lg">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">¡Base de datos encontrada!</p>
                  <p className="text-xs text-emerald-700 dark:text-emerald-300 mt-1 break-all">{detectedPath}</p>
                </div>
              </div>
            </div>
          )}

          {/* Error Message */}
          {importState === 'error' && errorMessage && (
            <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg">
              <div className="flex items-start gap-2">
                <XCircle className="h-5 w-5 text-destructive mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-sm text-destructive">{errorMessage}</p>
                </div>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-col gap-3 pt-2">
            <button
              onClick={handleImport}
              disabled={!canImport || isLoading}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-[#16bb7b] text-white rounded-lg hover:bg-[#108c5c] disabled:bg-[#b0b0b3] disabled:cursor-not-allowed transition-colors"
            >
              {importState === 'importing' ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span>Importando...</span>
                </>
              ) : importState === 'success' ? (
                <>
                  <CheckCircle2 className="h-5 w-5" />
                  <span>¡Éxito!</span>
                </>
              ) : (
                <>
                  <Database className="h-5 w-5" />
                  <span>Importar Base de Datos</span>
                </>
              )}
            </button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-input"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-card text-muted-foreground">o</span>
              </div>
            </div>

            <button
              onClick={handleStartFresh}
              disabled={isLoading}
              className="w-full px-4 py-3 border-2 border-input text-foreground rounded-lg hover:bg-muted disabled:bg-card-hi disabled:cursor-not-allowed transition-colors"
            >
              Comenzar Nuevo (Sin Importar)
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
