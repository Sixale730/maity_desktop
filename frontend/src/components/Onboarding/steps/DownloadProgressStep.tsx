import React, { useEffect, useState } from 'react';
import { Cloud, Mic, Sparkles, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { OnboardingContainer } from '../OnboardingContainer';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { toast } from 'sonner';

/**
 * Cloud Setup Step - Confirms cloud provider configuration
 *
 * This step informs the user that Maity uses cloud APIs:
 * - Deepgram for real-time transcription
 * - OpenAI for meeting summaries
 *
 * No local model downloads are required.
 */
export function DownloadProgressStep() {
  const {
    goNext,
    completeOnboarding,
    setUseCloudTranscription,
  } = useOnboarding();

  const [isMac, setIsMac] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);

  // Detect platform on mount
  useEffect(() => {
    const checkPlatform = async () => {
      try {
        const { platform } = await import('@tauri-apps/plugin-os');
        setIsMac(platform() === 'macos');
      } catch (e) {
        setIsMac(navigator.userAgent.includes('Mac'));
      }
    };
    checkPlatform();
  }, []);

  const handleContinue = async () => {
    setUseCloudTranscription(true);
    setIsCompleting(true);

    try {
      if (isMac) {
        // macOS: Go to Permissions step first
        goNext();
      } else {
        // Non-macOS: Complete onboarding immediately
        await completeOnboarding();
        await new Promise(resolve => setTimeout(resolve, 100));
        window.location.reload();
      }
    } catch (error) {
      console.error('Failed to complete setup:', error);
      toast.error('Error al completar la configuración', {
        description: 'Por favor intenta de nuevo.',
      });
      setIsCompleting(false);
    }
  };

  const cloudProviders = [
    {
      name: 'Deepgram',
      description: 'Transcripción en tiempo real',
      icon: <Mic className="w-5 h-5 text-[#3a4ac3]" />,
      model: 'Nova-2',
    },
    {
      name: 'OpenAI',
      description: 'Resúmenes de reuniones',
      icon: <Sparkles className="w-5 h-5 text-[#16bb7b]" />,
      model: 'GPT-4o',
    },
  ];

  return (
    <OnboardingContainer
      title="IA Potenciada por la Nube"
      description="Maity usa APIs en la nube para transcripción rápida y precisa, y resúmenes inteligentes."
      step={3}
      totalSteps={isMac ? 4 : 3}
    >
      <div className="flex flex-col items-center space-y-8">
        {/* Cloud Icon */}
        <div className="w-16 h-16 rounded-full bg-[#f0f2fe] flex items-center justify-center">
          <Cloud className="w-8 h-8 text-[#3a4ac3]" />
        </div>

        {/* Provider Cards */}
        <div className="w-full max-w-md space-y-3">
          {cloudProviders.map((provider) => (
            <div
              key={provider.name}
              className="bg-white dark:bg-gray-800 rounded-xl border border-[#e7e7e9] dark:border-gray-700 p-4 flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[#f5f5f6] flex items-center justify-center">
                  {provider.icon}
                </div>
                <div>
                  <h3 className="font-medium text-[#000000]">{provider.name}</h3>
                  <p className="text-sm text-[#6a6a6d]">{provider.description}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-[#8a8a8d] bg-[#e7e7e9] px-2 py-1 rounded">
                  {provider.model}
                </span>
                <div className="w-6 h-6 rounded-full bg-[#c5fceb] flex items-center justify-center">
                  <Check className="w-4 h-4 text-[#16bb7b]" />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Benefits */}
        <div className="w-full max-w-md bg-[#f5f5f6] rounded-lg p-4">
          <p className="text-sm text-[#4a4a4c] text-center">
            Sin descargas necesarias. Tus reuniones se procesan de forma segura en la nube
            con modelos de IA líderes en la industria.
          </p>
        </div>

        {/* API Key Note */}
        <p className="text-xs text-[#6a6a6d] text-center max-w-md">
          Asegúrate de haber configurado tus claves API en el archivo .env o en Configuración.
        </p>

        {/* Continue Button */}
        <div className="w-full max-w-xs">
          <Button
            onClick={handleContinue}
            disabled={isCompleting}
            className="w-full h-11 bg-[#000000] hover:bg-[#1a1a1a] text-white"
          >
            {isCompleting ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              'Continuar'
            )}
          </Button>
        </div>
      </div>
    </OnboardingContainer>
  );
}
