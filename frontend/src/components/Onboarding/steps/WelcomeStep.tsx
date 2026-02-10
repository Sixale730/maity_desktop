import React, { useEffect, useState } from 'react';
import { ShieldCheck, Mic, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { OnboardingContainer } from '../OnboardingContainer';
import { useOnboarding } from '@/contexts/OnboardingContext';

export function WelcomeStep() {
  const { goNext, completeOnboarding } = useOnboarding();
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

  const handleStart = async () => {
    if (isMac) {
      // macOS needs permissions step
      goNext();
    } else {
      // Windows: complete onboarding directly
      try {
        await completeOnboarding();
      } catch (error) {
        console.error('Failed to complete onboarding:', error);
      }
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
      <div className="flex flex-col items-center space-y-10">
        {/* Divider */}
        <div className="w-16 h-px bg-[#b0b0b3] dark:bg-gray-600" />

        {/* Features Card */}
        <div className="w-full max-w-md bg-white dark:bg-gray-800/50 rounded-lg border border-[#e7e7e9] dark:border-gray-700 shadow-sm p-6 space-y-4">
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

        {/* CTA Section */}
        <div className="w-full max-w-xs">
          <Button
            onClick={handleStart}
            className="w-full h-11 bg-[#1bea9a] hover:bg-[#17d48b] text-gray-900 font-medium"
          >
            Comenzar
          </Button>
        </div>
      </div>
    </OnboardingContainer>
  );
}
