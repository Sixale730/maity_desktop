import React, { useState, useEffect } from "react";
import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import Image from 'next/image';
import AnalyticsConsentSwitch from "@/components/analytics/AnalyticsConsentSwitch";
import { UpdateDialog } from "@/components/updates/UpdateDialog";
import { updateService, UpdateInfo } from '@/services/updateService';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { LogExporter } from '@/components/settings/LogExporter';
import { useAuth } from '@/contexts/AuthContext';


export function About() {
    const { user, maityUser } = useAuth();
    const [currentVersion, setCurrentVersion] = useState<string>('0.2.0');
    const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
    const [isChecking, setIsChecking] = useState(false);
    const [showUpdateDialog, setShowUpdateDialog] = useState(false);

    useEffect(() => {
        // Get current version on mount
        getVersion().then(setCurrentVersion).catch(console.error);
    }, []);

    const handleContactClick = async () => {
        try {
            await invoke('open_external_url', { url: 'https://maity.com.mx' });
        } catch (error) {
            console.error('Failed to open link:', error);
        }
    };

    const handleCheckForUpdates = async () => {
        setIsChecking(true);
        try {
            const info = await updateService.checkForUpdates(true);
            setUpdateInfo(info);
            if (info.available) {
                setShowUpdateDialog(true);
            } else {
                toast.success('Estás ejecutando la última versión');
            }
        } catch (error: any) {
            console.error('Failed to check for updates:', error);
            toast.error('Error al buscar actualizaciones: ' + (error.message || 'Error desconocido'));
        } finally {
            setIsChecking(false);
        }
    };

    return (
        <div className="p-4 space-y-4 h-[80vh] overflow-y-auto">
            {/* Compact Header */}
            <div className="text-center">
                <div className="mb-3">
                    <Image
                        src="icon_128x128.png"
                        alt="Maity Logo"
                        width={64}
                        height={64}
                        className="mx-auto"
                    />
                </div>
                {/* <h1 className="text-xl font-bold text-[#000000] dark:text-white">Maity</h1> */}
                <span className="text-sm text-muted-foreground"> v{currentVersion}</span>
                <p className="text-medium text-muted-foreground mt-1">
                    Tu coach de comunicación con IA para reuniones profesionales.
                </p>
                <div className="mt-3">
                    <Button
                        onClick={handleCheckForUpdates}
                        disabled={isChecking}
                        variant="outline"
                        size="sm"
                        className="text-xs"
                    >
                        {isChecking ? (
                            <>
                                <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                                Verificando...
                            </>
                        ) : (
                            <>
                                <CheckCircle2 className="h-3 w-3 mr-2" />
                                Buscar Actualizaciones
                            </>
                        )}
                    </Button>
                    {updateInfo?.available && (
                        <div className="mt-2 text-xs text-primary">
                            Actualización disponible: v{updateInfo.version}
                        </div>
                    )}
                </div>
            </div>

            {/* Features Grid - Compact */}
            <div className="space-y-3">
                <h2 className="text-base font-semibold text-foreground">Qué hace diferente a Maity</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    <div className="bg-secondary rounded p-3 hover:bg-muted transition-colors">
                        <h3 className="font-bold text-sm text-foreground mb-1">Privacidad primero</h3>
                        <p className="text-xs text-muted-foreground leading-relaxed">Tus datos y el procesamiento de IA pueden quedarse en tu dispositivo. Sin nube, sin filtraciones.</p>
                    </div>
                    <div className="bg-secondary rounded p-3 hover:bg-muted transition-colors">
                        <h3 className="font-bold text-sm text-foreground mb-1">Funciona en todas partes</h3>
                        <p className="text-xs text-muted-foreground leading-relaxed">Google Meet, Zoom, Teams - en línea o sin conexión.</p>
                    </div>
                    <div className="bg-secondary rounded p-3 hover:bg-muted transition-colors">
                        <h3 className="font-bold text-sm text-foreground mb-1">Evaluación con IA</h3>
                        <p className="text-xs text-muted-foreground leading-relaxed">Tu comunicación se evalúa automáticamente después de cada reunión con feedback personalizado.</p>
                    </div>
                </div>
            </div>

            {/* Account & Language Info */}
            {user?.email && (
                <div className="bg-secondary rounded p-3 space-y-1">
                    <p className="text-xs text-muted-foreground">
                        Sesión iniciada como <span className="font-medium text-foreground">{user.email}</span>
                    </p>
                    {maityUser?.id && (
                        <p className="text-xs text-muted-foreground">
                            ID: <span className="font-mono text-foreground">{maityUser.id}</span>
                        </p>
                    )}
                </div>
            )}
            <div className="bg-secondary/50 rounded p-3">
                <p className="text-xs text-muted-foreground">
                    La interfaz está en español porque Maity está diseñado para equipos en Latinoamérica. Soporte multilenguaje próximamente.
                </p>
            </div>

            {/* Footer - Compact */}
            <div className="pt-2 border-t border-border text-center">
                <p className="text-xs text-muted-foreground">
                    Creado por Maity
                </p>
            </div>
            {/* Log Export Section */}
            <LogExporter />

            <AnalyticsConsentSwitch />

            {/* Update Dialog */}
            <UpdateDialog
                open={showUpdateDialog}
                onOpenChange={setShowUpdateDialog}
                updateInfo={updateInfo}
            />
        </div>

    )
}