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


export function About() {
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
            await invoke('open_external_url', { url: 'https://maity.zackriya.com/#about' });
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
                    Notas y resúmenes en tiempo real que nunca salen de tu dispositivo.
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
                <div className="grid grid-cols-2 gap-2">
                    <div className="bg-secondary rounded p-3 hover:bg-muted transition-colors">
                        <h3 className="font-bold text-sm text-foreground mb-1">Privacidad primero</h3>
                        <p className="text-xs text-muted-foreground leading-relaxed">Tus datos y el procesamiento de IA pueden quedarse en tu dispositivo. Sin nube, sin filtraciones.</p>
                    </div>
                    <div className="bg-secondary rounded p-3 hover:bg-muted transition-colors">
                        <h3 className="font-bold text-sm text-foreground mb-1">Usa Cualquier Modelo</h3>
                        <p className="text-xs text-muted-foreground leading-relaxed">¿Prefieres modelos locales de código abierto? Genial. ¿Quieres usar una API externa? También está bien. Sin ataduras.</p>
                    </div>
                    <div className="bg-secondary rounded p-3 hover:bg-muted transition-colors">
                        <h3 className="font-bold text-sm text-foreground mb-1">Ahorro Inteligente</h3>
                        <p className="text-xs text-muted-foreground leading-relaxed">Evita facturas por minuto ejecutando modelos localmente (o paga solo por las llamadas que elijas).</p>
                    </div>
                    <div className="bg-secondary rounded p-3 hover:bg-muted transition-colors">
                        <h3 className="font-bold text-sm text-foreground mb-1">Funciona en todas partes</h3>
                        <p className="text-xs text-muted-foreground leading-relaxed">Google Meet, Zoom, Teams - en línea o sin conexión.</p>
                    </div>
                </div>
            </div>

            {/* Coming Soon - Compact */}
            <div className="bg-primary/10 rounded p-3">
                <p className="text-s text-primary">
                    <span className="font-bold">Próximamente:</span> Una biblioteca de agentes de IA en dispositivo - automatizando seguimientos, rastreo de acciones y más.
                </p>
            </div>

            {/* CTA Section - Compact */}
            <div className="text-center space-y-2">
                <h3 className="text-medium font-semibold text-foreground">¿Listo para llevar tu negocio más lejos?</h3>
                <p className="text-s text-muted-foreground">
                    Si planeas construir agentes de IA personalizados con privacidad primero o un producto totalmente adaptado para tu <span className="font-bold">negocio</span>, podemos ayudarte a construirlo.
                </p>
                <button
                    onClick={handleContactClick}
                    className="inline-flex items-center px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-medium rounded transition-colors duration-200 shadow-sm hover:shadow-md"
                >
                    Habla con el equipo de Zackriya
                </button>
            </div>

            {/* Footer - Compact */}
            <div className="pt-2 border-t border-border text-center">
                <p className="text-xs text-muted-foreground">
                    Creado por Zackriya Solutions
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