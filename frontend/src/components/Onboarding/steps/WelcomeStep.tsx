import React from 'react';
import { Lock, Sparkles, Cpu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { OnboardingContainer } from '../OnboardingContainer';
import { useOnboarding } from '@/contexts/OnboardingContext';

export function WelcomeStep() {
  const { goNext } = useOnboarding();

  const features = [
    {
      icon: Lock,
      title: 'Tus datos nunca salen de tu dispositivo',
    },
    {
      icon: Sparkles,
      title: 'Resúmenes e insights inteligentes',
    },
    {
      icon: Cpu,
      title: 'Funciona sin conexión, sin necesidad de la nube',
    },
  ];

  return (
    <OnboardingContainer
      title="Bienvenido a Maity"
      description="Graba. Transcribe. Resume. Todo en tu dispositivo."
      step={1}
      hideProgress={true}
    >
      <div className="flex flex-col items-center space-y-10">
        {/* Divider */}
        <div className="w-16 h-px bg-[#b0b0b3] dark:bg-gray-600" />

        {/* Features Card */}
        <div className="w-full max-w-md bg-white dark:bg-gray-800 rounded-lg border border-[#e7e7e9] dark:border-gray-700 shadow-sm p-6 space-y-4">
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
        <div className="w-full max-w-xs space-y-3">
          <Button
            onClick={goNext}
            className="w-full h-11 bg-[#000000] hover:bg-[#1a1a1a] text-white"
          >
            Comenzar
          </Button>
          <p className="text-xs text-center text-[#6a6a6d] dark:text-gray-400">Toma menos de 3 minutos</p>
        </div>
      </div>
    </OnboardingContainer>
  );
}
