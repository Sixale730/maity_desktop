import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from '@/lib/router-compat';
import { useQueryClient } from '@tanstack/react-query';
import { AuthService } from '@maity/shared';
import { useToast } from '@/shared/hooks/use-toast';
import { useUser } from '@/contexts/UserContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/components/ui/card';
import { Loader2 } from 'lucide-react';
import { OnboardingFlow } from '../components/onboarding';
import { consumeCheckoutIntent } from '@/features/billing/utils/checkoutIntent';

/**
 * Registration Page - Onboarding Flow
 * Shows multi-step onboarding to users in REGISTRATION phase
 *
 * Flow:
 * 1. Verify user session
 * 2. Check user phase (must not have registration_form_completed)
 * 3. Show onboarding flow (Avatar -> Instructions -> Questionnaire)
 * 4. On completion -> Redirect to levels intro
 * Note: Users without company_id can still complete onboarding
 */

const Registration: React.FC = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { refreshUser } = useUser();

  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [hasCompany, setHasCompany] = useState(false);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    void init();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  const init = async () => {
    console.log('[Registration] 🚀 Starting init...');
    try {
      // 1) Session required
      const session = await AuthService.getSession();
      if (!session) {
        const returnTo = encodeURIComponent(window.location.href);
        navigate(`/auth?returnTo=${returnTo}`);
        return;
      }

      // 2) Check current user phase
      const statusData = await AuthService.getMyStatus();

      if (!statusData) {
        console.error('[Registration] my_status returned no data');
        navigate('/user-status-error', { replace: true });
        return;
      }

      const userStatus = statusData[0];
      console.log('[Registration] User status:', {
        id: userStatus.id,
        company_id: userStatus.company_id,
        registration_form_completed: userStatus.registration_form_completed,
        phase: userStatus.phase
      });

      // Already completed registration? -> Dashboard
      if (userStatus.registration_form_completed) {
        console.log('[Registration] User already completed registration, redirecting to gamified dashboard v2');
        navigate('/gamified-dashboard-v2', { replace: true });
        return;
      }

      // Users without company can still complete onboarding; they get the
      // invite-code step at the start of the flow
      if (!userStatus.company_id) {
        console.log('[Registration] User has no company assigned - showing invite-code step');
      }

      // Ready to show form
      console.log('[Registration] ✅ Ready to show form, userId:', userStatus.id);
      setHasCompany(Boolean(userStatus.company_id));
      setUserId(userStatus.id);
      setLoading(false);
    } catch (error) {
      console.error('[Registration] init error', error);
      toast({
        title: 'Error',
        description: 'No se pudo cargar el formulario de registro.',
        variant: 'destructive',
      });
      navigate('/');
    }
  };

  const handleFormComplete = async () => {
    console.log('[Registration] ✅ Form completed successfully');

    try {
      // Invalidate and WAIT for queries to refetch
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['formResponses'] }),
        queryClient.invalidateQueries({ queryKey: ['user', 'profile'] }),
        queryClient.invalidateQueries({ queryKey: ['user', 'status'] }),
        queryClient.invalidateQueries({ queryKey: ['avatar'] }),
      ]);

      // Small delay to ensure Supabase RLS policies reflect the update
      await new Promise(resolve => setTimeout(resolve, 500));

      // Refresh UserContext to update phase to ACTIVE
      console.log('[Registration] 🔄 Refreshing user context...');
      await refreshUser();
      console.log('[Registration] ✅ User context refreshed');

      toast({
        title: '¡Registro completado!',
        description: 'Tu perfil y autoevaluación han sido guardados exitosamente.',
      });

      // Set flag so ProtectedRoute grants immediate access (safety net for RPC lag)
      sessionStorage.setItem('registration_just_completed', 'true');

      // Todos los usuarios nuevos pasan por la selección de plan al terminar
      // el onboarding ("Continuar gratis" → dashboard). Quien traía intención
      // de pago retoma el checkout directo (?checkout=pro auto-lanza Stripe).
      // /billing/plans vive dentro del app shell — no la landing (/pricing).
      navigate(
        consumeCheckoutIntent() === 'pro' ? '/billing/plans?checkout=pro' : '/billing/plans',
        { replace: true }
      );
    } catch (error) {
      console.error('[Registration] Error invalidating queries:', error);
      // Even on error the form did complete — same destination logic.
      navigate(
        consumeCheckoutIntent() === 'pro' ? '/billing/plans?checkout=pro' : '/billing/plans',
        { replace: true }
      );
    }
  };

  if (loading || !userId) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
            <p className="text-muted-foreground">Cargando formulario...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-4xl">
        <Card>
          <CardHeader className="text-center border-b">
            <CardTitle className="text-2xl sm:text-3xl">
              Bienvenido a Maity
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-2">
              Personaliza tu perfil y completa tu evaluación
            </p>
          </CardHeader>
          <CardContent className="pt-6">
            <OnboardingFlow userId={userId} hasCompany={hasCompany} onComplete={handleFormComplete} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Registration;
