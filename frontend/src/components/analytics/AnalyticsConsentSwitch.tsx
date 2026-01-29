import React, { useContext, useState, useEffect } from 'react';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Info, Loader2, Copy, Check } from 'lucide-react';
import { AnalyticsContext } from './AnalyticsProvider';
import { load } from '@tauri-apps/plugin-store';
import { invoke } from '@tauri-apps/api/core';
import { Analytics } from '@/lib/analytics';
import AnalyticsDataModal from './AnalyticsDataModal';


export default function AnalyticsConsentSwitch() {
  const { setIsAnalyticsOptedIn, isAnalyticsOptedIn } = useContext(AnalyticsContext);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [userId, setUserId] = useState<string>('');
  const [isCopied, setIsCopied] = useState(false);

  // Note: Store loading is handled by AnalyticsProvider to avoid race conditions

  useEffect(() => {
    const loadUserId = async () => {
      if (isAnalyticsOptedIn) {
        try {
          const id = await Analytics.getPersistentUserId();
          setUserId(id);
        } catch (error) {
          console.error('Failed to load user ID:', error);
        }
      } else {
        setUserId('');
      }
    };
    loadUserId();
  }, [isAnalyticsOptedIn]);

  const handleCopyUserId = async () => {
    if (!userId) return;

    try {
      await navigator.clipboard.writeText(userId);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);

      // Track that user copied their ID
      await Analytics.track('user_id_copied', {
        user_id: userId
      });
    } catch (error) {
      console.error('Failed to copy user ID:', error);
    }
  };

  const handleToggle = async (enabled: boolean) => {
    // If user is trying to DISABLE, show the modal first
    if (!enabled) {
      setShowModal(true);
      // Track that user viewed the transparency modal
      try {
        await invoke('track_analytics_transparency_viewed');
      } catch (error) {
        console.error('Failed to track transparency view:', error);
      }
      return; // Don't disable yet, wait for modal confirmation
    }

    // If ENABLING, proceed immediately
    await performToggle(enabled);
  };

  const performToggle = async (enabled: boolean) => {
    // Optimistic update - immediately update UI state
    setIsAnalyticsOptedIn(enabled);
    setIsProcessing(true);

    try {
      const store = await load('analytics.json', {
        autoSave: false,
        defaults: {
          analyticsOptedIn: true
        }
      });
      await store.set('analyticsOptedIn', enabled);
      await store.save();

      if (enabled) {
        // Full analytics initialization (same as AnalyticsProvider)
        const userId = await Analytics.getPersistentUserId();

        // Initialize analytics
        await Analytics.init();

        // Identify user with enhanced properties immediately after init
        await Analytics.identify(userId, {
          app_version: '0.2.0',
          platform: 'tauri',
          first_seen: new Date().toISOString(),
          os: navigator.platform,
          user_agent: navigator.userAgent,
        });

        // Start analytics session with the same user ID
        await Analytics.startSession(userId);

        // Track app started (re-enabled)
        await Analytics.trackAppStarted();

        // Track that user enabled analytics
        try {
          await invoke('track_analytics_enabled');
        } catch (error) {
          console.error('Failed to track analytics enabled:', error);
        }

        console.log('Analytics re-enabled successfully');
      } else {
        // Track that user disabled analytics BEFORE disabling
        try {
          await invoke('track_analytics_disabled');
        } catch (error) {
          console.error('Failed to track analytics disabled:', error);
        }

        await Analytics.disable();
        console.log('Analytics disabled successfully');
      }
    } catch (error) {
      console.error('Failed to toggle analytics:', error);
      // Revert the optimistic update on error
      setIsAnalyticsOptedIn(!enabled);
      // You could also show a toast notification here to inform the user
    } finally {
      setIsProcessing(false);
    }
  };

  const handleConfirmDisable = async () => {
    setShowModal(false);
    await performToggle(false);
  };

  const handleCancelDisable = () => {
    setShowModal(false);
    // Keep analytics enabled, no state change needed
  };

  const handlePrivacyPolicyClick = async () => {
    try {
      await invoke('open_external_url', { url: 'https://github.com/Zackriya-Solutions/meeting-minutes/blob/main/PRIVACY_POLICY.md' });
    } catch (error) {
      console.error('Failed to open privacy policy link:', error);
    }
  };

  return (
    <>
      <div className="space-y-4">
        <div>
          <h3 className="text-base font-semibold text-[#1a1a1a] dark:text-white mb-2">Analíticas de Uso</h3>
          <p className="text-sm text-[#4a4a4c] dark:text-gray-300 mb-4">
            Ayúdanos a mejorar Maity compartiendo datos de uso anónimos. No se recopila contenido personal—todo permanece en tu dispositivo.
          </p>
        </div>

        <div className="flex items-center justify-between p-3 bg-[#f5f5f6] dark:bg-gray-800 rounded-lg border border-[#e7e7e9] dark:border-gray-700">
          <div>
            <h4 className="font-semibold text-[#1a1a1a] dark:text-white">Habilitar Analíticas</h4>
            <p className="text-sm text-[#4a4a4c] dark:text-gray-300">
              {isProcessing ? 'Actualizando...' : 'Solo patrones de uso anónimos'}
            </p>
          </div>
          <div className="flex items-center gap-2 ml-4">
            {isProcessing && (
              <Loader2 className="w-4 h-4 animate-spin text-[#6a6a6d] dark:text-gray-400" />
            )}
            <Switch
              checked={isAnalyticsOptedIn}
              onCheckedChange={handleToggle}
              disabled={isProcessing}
            />
          </div>
        </div>

        {/* User ID Display */}
        {isAnalyticsOptedIn && userId && (
          <div className="p-4 border dark:border-gray-700 rounded-lg bg-[#f5f5f6] dark:bg-gray-800">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="font-medium text-[#1a1a1a] dark:text-white mb-1">Tu ID de Usuario</div>
                <p className="text-xs text-[#4a4a4c] dark:text-gray-300 mb-2">
                  Comparte este ID al reportar problemas para ayudarnos a investigar tus registros
                </p>
                <div className="flex items-center gap-2">
                  <code className="text-xs text-[#3a3a3c] dark:text-gray-200 bg-white dark:bg-gray-700 px-2 py-1 rounded border border-[#d0d0d3] dark:border-gray-600 font-mono flex-1 truncate">
                    {userId}
                  </code>
                  <Button
                    onClick={handleCopyUserId}
                    variant="outline"
                    size="sm"
                    className="flex-shrink-0"
                    title="Copiar ID de Usuario"
                  >
                    {isCopied ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-[#16bb7b]" />
                        <span className="text-[#16bb7b]">¡Copiado!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copiar</span>
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-start gap-2 p-2 bg-[#f0f2fe] dark:bg-blue-900/30 rounded border border-[#c0cbfb] dark:border-blue-700">
          <Info className="w-4 h-4 text-[#3a4ac3] dark:text-blue-400 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-[#2b3892] dark:text-blue-300">
            <p className="mb-1">
              Tus reuniones, transcripciones y grabaciones permanecen completamente privadas y locales.
            </p>
            <button
              onClick={handlePrivacyPolicyClick}
              className="text-[#3a4ac3] hover:text-[#1e2a6e] underline hover:no-underline"
            >
              Ver Política de Privacidad
            </button>
          </div>
        </div>
      </div>

      {/* 2-Step Opt-Out Modal */}
      <AnalyticsDataModal
        isOpen={showModal}
        onClose={handleCancelDisable}
        onConfirmDisable={handleConfirmDisable}
      />
    </>
  );
}