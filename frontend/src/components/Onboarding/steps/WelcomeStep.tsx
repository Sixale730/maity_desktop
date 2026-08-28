import React, { useEffect, useState } from 'react';
import { ShieldCheck, Mic, Sparkles, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { OnboardingContainer } from '../OnboardingContainer';
import { useOnboarding } from '@/contexts/OnboardingContext';

// Tamaños aproximados de los modelos (MB). El de análisis (Gemma) depende de la
// plataforma: gemma3:1b (~1 GB) en Windows/RAM<16GB, gemma3:4b (~2.4 GB) en macOS>16GB.
const GEMMA_SIZE_MB: Record<string, number> = {
  'gemma3:1b': 1019,
  'gemma3:4b': 2374,
};
const PARAKEET_SIZE_MB = 600;

export function WelcomeStep() {
  const {
    goNext,
    completeOnboarding,
    startBackgroundDownloads,
    selectedSummaryModel,
    summaryModelRequired,
  } = useOnboarding();
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    const checkPlatform = async () => {
      try {
        const { platform } = await import('@tauri-apps/plugin-os');
        setIsMac(platform() === 'macos');
      } catch {
        setIsMac(navigator.userAgent.includes('Mac'));
      }
    };
    checkPlatform();
  }, []);

  // En tier Low no se baja el modelo de análisis (el coach usa heurísticos), así
  // que la cifra que ve el usuario tiene que reflejarlo: prometer ~1.6 GB y bajar
  // 600 MB es tan confuso como al revés.
  const gemmaSizeMb = summaryModelRequired
    ? GEMMA_SIZE_MB[selectedSummaryModel] ?? GEMMA_SIZE_MB['gemma3:4b']
    : 0;
  const totalGb = ((PARAKEET_SIZE_MB + gemmaSizeMb) / 1024).toFixed(1);

  // Único punto de arranque de descargas: con este botón empieza a descargar
  // (Parakeet + Gemma en background) y avanza. En macOS pasa antes por permisos.
  const handleStart = () => {
    void startBackgroundDownloads(true);
    if (isMac) {
      goNext();               // macOS → paso 2 (Permisos); la descarga sigue en background
    } else {
      void completeOnboarding(); // Windows → directo al registro
    }
  };

  const features = [
    {
      icon: ShieldCheck,
      title: 'Tus datos están seguros y protegidos',
    },
    {
      icon: Mic,
      title: 'Transcripción en tiempo real con IA',
    },
    {
      icon: Sparkles,
      title: 'Resúmenes e insights inteligentes',
    },
  ];

  return (
    <OnboardingContainer
      title="Bienvenido a Maity"
      description="Graba. Transcribe. Resume. Tu asistente de reuniones con IA."
      step={1}
      hideProgress={true}
    >
      <div className="flex flex-col items-center space-y-8">
        {/* Logo */}
        <img
          src="icon_128x128.png"
          alt="Maity"
          width={80}
          height={80}
          className="w-20 h-20 rounded-2xl shadow-sm"
        />

        {/* Features Card */}
        <div className="w-full max-w-md mx-auto bg-white dark:bg-gray-800/50 rounded-lg border border-[#e7e7e9] dark:border-gray-700 shadow-sm p-6 space-y-4">
          {features.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <div key={index} className="flex items-start gap-3">
                <div className="flex-shrink-0 mt-0.5">
                  <div className="w-5 h-5 rounded-full bg-[#e7e7e9] dark:bg-gray-700 flex items-center justify-center">
                    <Icon className="w-3 h-3 text-[#3a3a3c] dark:text-gray-200" />
                  </div>
                </div>
                <p className="text-sm text-[#3a3a3c] dark:text-gray-200 leading-relaxed">{feature.title}</p>
              </div>
            );
          })}
        </div>

        {/* Nota de descarga de modelos */}
        <p className="text-xs text-[#6a6a6d] dark:text-gray-400 text-center max-w-md mx-auto">
          Al comenzar se descarga{summaryModelRequired ? 'n los modelos locales' : ' el modelo local'}{' '}
          ({summaryModelRequired ? 'voz + análisis' : 'voz'}, ~{totalGb} GB, solo la primera vez).
          Puedes continuar con tu registro mientras se descarga{summaryModelRequired ? 'n' : ''} en
          segundo plano.
        </p>

        {/* CTA */}
        <div className="w-full max-w-xs mx-auto">
          <Button
            onClick={handleStart}
            className="w-full h-11 bg-[#1bea9a] hover:bg-[#17d48b] text-gray-900 font-medium"
          >
            <Download className="w-4 h-4 mr-2" />
            Comenzar y descargar
          </Button>
        </div>
      </div>
    </OnboardingContainer>
  );
}
