/**
 * OnboardingCompanyStep Component
 * First onboarding step: lets the user redeem a company invite code
 * (USER or MANAGER) or continue without one. Only shown to users
 * without a company.
 */

import { useState } from 'react';
import { Button } from '@/ui/components/ui/button';
import { Input } from '@/ui/components/ui/input';
import { Building2, CheckCircle2, Loader2, ArrowRight } from 'lucide-react';
import { InviteCodeService, useRedeemInviteCode } from '@maity/shared';

interface OnboardingCompanyStepProps {
  onComplete: () => void;
  preview?: boolean;
}

const CODE_LENGTH = 8;

export function OnboardingCompanyStep({ onComplete, preview }: OnboardingCompanyStepProps) {
  const [code, setCode] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [joinedCompanyName, setJoinedCompanyName] = useState<string | null>(null);
  const redeemMutation = useRedeemInviteCode();

  const handleCodeChange = (value: string) => {
    // Codes are alphanumeric uppercase (Crockford Base32); strip anything else
    setCode(value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH));
    setErrorMessage(null);
  };

  const handleRedeem = async () => {
    if (preview || code.length !== CODE_LENGTH || redeemMutation.isPending) return;

    setErrorMessage(null);
    const result = await redeemMutation.mutateAsync(code);

    if (InviteCodeService.isSuccessful(result)) {
      setJoinedCompanyName(result.company_name ?? 'tu empresa');
      return;
    }

    if (InviteCodeService.userAlreadyHasCompany(result)) {
      // Joined elsewhere (e.g. autojoin in another tab) — nothing to do here
      onComplete();
      return;
    }

    setErrorMessage(InviteCodeService.errorMessage(result));
  };

  // Success state: show the company the user just joined
  if (joinedCompanyName) {
    return (
      <div className="max-w-md mx-auto text-center space-y-6 py-8">
        <div className="mx-auto w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center">
          <CheckCircle2 className="w-8 h-8 text-green-500" />
        </div>
        <div className="space-y-2">
          <h3 className="text-xl font-semibold">¡Código canjeado!</h3>
          <p className="text-muted-foreground">
            Te uniste a <span className="font-semibold text-foreground">{joinedCompanyName}</span>.
          </p>
        </div>
        <Button onClick={onComplete} size="lg" className="w-full sm:w-auto">
          Continuar
          <ArrowRight className="w-4 h-4 ml-2" />
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto space-y-6 py-4">
      <div className="text-center space-y-2">
        <div className="mx-auto w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
          <Building2 className="w-7 h-7 text-primary" />
        </div>
        <h3 className="text-xl font-semibold">¿Vienes por parte de una empresa?</h3>
        <p className="text-sm text-muted-foreground">
          Si tu empresa te compartió un código de invitación, ingrésalo aquí para
          unirte a su equipo. Si no tienes uno, puedes continuar sin código.
        </p>
      </div>

      <div className="space-y-3">
        <Input
          value={code}
          onChange={(e) => handleCodeChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleRedeem();
          }}
          placeholder="CÓDIGO (8 caracteres)"
          maxLength={CODE_LENGTH}
          autoComplete="off"
          spellCheck={false}
          className="text-center font-mono text-lg tracking-[0.3em] uppercase"
          aria-label="Código de invitación"
        />

        {errorMessage && (
          <p className="text-sm text-destructive text-center" role="alert">
            {errorMessage}
          </p>
        )}

        <Button
          onClick={() => void handleRedeem()}
          disabled={preview || code.length !== CODE_LENGTH || redeemMutation.isPending}
          className="w-full"
          title={preview ? 'No disponible en vista previa' : undefined}
        >
          {redeemMutation.isPending ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Canjeando...
            </>
          ) : (
            'Canjear código'
          )}
        </Button>

        <Button
          variant="ghost"
          onClick={onComplete}
          disabled={redeemMutation.isPending}
          className="w-full text-muted-foreground"
        >
          Continuar sin código
          <ArrowRight className="w-4 h-4 ml-2" />
        </Button>
      </div>
    </div>
  );
}
