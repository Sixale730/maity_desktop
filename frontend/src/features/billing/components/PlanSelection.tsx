/**
 * PlanSelection — shared plan-picker grid (Free / Pro / Enterprise).
 *
 * Used by two pages with different chrome:
 *  - PricingPage (/pricing): public landing, LandingNavbar + LandingFooter.
 *  - SelectPlanPage (/billing/plans): inside the app shell (AppLayout).
 *
 * Owns the monthly/yearly toggle, the Stripe checkout kickoff, and the
 * ?checkout=pro auto-resume effect (strips the param against the current
 * pathname so it works on both routes).
 *
 * Annual: only the MONTHLY Pro price exists in Stripe. While yearly is
 * selected the Pro CTA becomes "Contáctanos" (the yearly price is NULL, so a
 * checkout would 400 with "Plan price not configured").
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from '@/lib/router-compat';
import { useCreateCheckoutSession, useMyEffectivePlan } from '@maity/shared';
import { env } from '@/lib/env';
import { openExternalUrl } from '@/lib/planLinks';
import { PlanCard } from './PlanCard';
import { ToggleGroup, ToggleGroupItem } from '@/ui/components/ui/toggle-group';
import { useUser } from '@/contexts/UserContext';
import { clearCheckoutIntent } from '../utils/checkoutIntent';

export interface PlanSelectionProps {
  /**
   * Called when a logged-out visitor clicks the Pro CTA (only reachable from
   * the public pricing page — protected routes never render logged-out).
   * When omitted, the click goes straight to checkout.
   */
  onUnauthenticatedPro?: () => void;
  /**
   * Regular company members (company_id set, role user) don't see the
   * Enterprise tier — that conversation belongs to their manager.
   */
  showEnterprise?: boolean;
}

export function PlanSelection({ onUnauthenticatedPro, showEnterprise = true }: PlanSelectionProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [period, setPeriod] = useState<'monthly' | 'yearly'>('monthly');
  const { data: currentPlan } = useMyEffectivePlan();
  const checkout = useCreateCheckoutSession(env.apiUrl);
  const { userProfile, loading: userLoading } = useUser();

  const isCurrentlyPro = currentPlan?.plan_code === 'pro';
  const isYearly = period === 'yearly';

  const startProCheckout = useCallback(async () => {
    clearCheckoutIntent(); // the intent did its job — don't re-fire it later
    try {
      const { url } = await checkout.mutateAsync({
        plan_code: 'pro',
        billing_period: 'monthly',
      });
      // PATCH desktop (port-web-feature): checkout abre navegador externo vía handoff — issue Sixale730/maity#133
      void openExternalUrl(url);
    } catch (err) {
      console.error('[pricing] checkout failed:', err);
      alert(
        err instanceof Error
          ? `No se pudo iniciar el checkout: ${err.message}`
          : 'No se pudo iniciar el checkout'
      );
    }
  }, [checkout]);

  const handleProClick = () => {
    if (!userLoading && !userProfile && onUnauthenticatedPro) {
      onUnauthenticatedPro();
      return;
    }
    void startProCheckout();
  };

  // Enterprise & annual route to the sales calendar (/agenda) — the site's
  // real contact flow (booking + direccion@maity.cloud), not a raw mailto.
  const handleEnterpriseClick = () => navigate('/agenda');
  const handleAnnualContact = () => navigate('/agenda');

  // Auto-resume checkout when the page loads with ?checkout=pro (post-auth
  // returnTo or the post-onboarding redirect from Registration.tsx).
  const resumedRef = useRef(false);
  useEffect(() => {
    if (resumedRef.current) return;
    const wantsCheckout = new URLSearchParams(location.search).get('checkout') === 'pro';
    if (!wantsCheckout || userLoading || !userProfile || isCurrentlyPro) return;
    resumedRef.current = true;
    navigate(location.pathname, { replace: true }); // strip the param so a refresh won't re-fire
    void startProCheckout();
    // react-doctor-disable-next-line react-doctor/no-mutable-in-deps -- useLocation() is reactive (re-renders on navigation); location.search in deps is correct and idiomatic.
  }, [location.search, location.pathname, userLoading, userProfile, isCurrentlyPro, navigate, startProCheckout]);

  return (
    <>
      <ToggleGroup
        type="single"
        value={period}
        onValueChange={(v) => v && setPeriod(v as 'monthly' | 'yearly')}
        className="mx-auto mt-6 mb-10 flex justify-center"
      >
        <ToggleGroupItem value="monthly">Mensual</ToggleGroupItem>
        <ToggleGroupItem value="yearly">Anual (ahorra ~17%)</ToggleGroupItem>
      </ToggleGroup>

      <div className={showEnterprise ? 'grid gap-6 md:grid-cols-3' : 'mx-auto grid max-w-3xl gap-6 md:grid-cols-2'}>
        <PlanCard
          name="Free"
          priceLine="Gratis"
          description="Para explorar Maity sin compromiso"
          features={[
            '3 sesiones de voz al mes',
            '15 análisis de conversación al mes',
            '1 juego por día',
            '25 mensajes de chat con Maity al día',
          ]}
          ctaLabel="Continuar gratis"
          onSelect={() => navigate('/dashboard')}
        />

        <PlanCard
          name="Pro"
          priceLine={period === 'yearly' ? '$2,490 MXN/año' : '$249 MXN/mes'}
          description="Acceso completo a la plataforma"
          features={[
            'Voice sessions ilimitadas',
            'Análisis de conversación ilimitado',
            'Todos los juegos sin tope diario',
            'Chat con Maity ilimitado',
            'Learning paths premium',
            'Facturación CFDI 4.0 incluida',
          ]}
          ctaLabel={
            isCurrentlyPro
              ? 'Tu plan actual'
              : isYearly
                ? 'Contáctanos (plan anual)'
                : 'Suscribirme a Pro'
          }
          onSelect={isYearly ? handleAnnualContact : handleProClick}
          loading={!isYearly && checkout.isPending}
          disabled={isCurrentlyPro}
          highlight
        />

        {showEnterprise && (
          <PlanCard
            name="Enterprise"
            priceLine="A medida"
            description="Para equipos y empresas"
            features={[
              'Todo de Pro',
              'SSO (Google Workspace / Microsoft)',
              'Agentes de voz personalizados',
              'Onboarding y soporte priority',
              'Facturación mensual con condiciones',
            ]}
            ctaLabel="Contáctanos"
            onSelect={handleEnterpriseClick}
          />
        )}
      </div>

      <p className="mt-10 text-center text-sm text-muted-foreground">
        Precios en MXN. IVA incluido. Facturación CFDI 4.0 emitida automáticamente.
      </p>
    </>
  );
}
