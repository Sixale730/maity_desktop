/**
 * PlanCard — reusable card for the pricing page.
 *
 * Renders a single tier (Free / Pro / Enterprise) with title, price line,
 * feature bullets, and a primary CTA. The CTA's behavior is fully owned by
 * the parent: it just calls onSelect.
 */

import { Button } from '@/ui/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/ui/components/ui/card';
import { Check } from 'lucide-react';
import type { ReactNode } from 'react';

export interface PlanCardProps {
  name: string;
  priceLine: string;                   // e.g. "$199 MXN/mes" or "Gratis"
  description?: string;
  features: string[];
  ctaLabel: string;
  onSelect?: () => void;
  loading?: boolean;
  highlight?: boolean;                 // visually accentuates the recommended tier
  disabled?: boolean;
  footer?: ReactNode;
}

export function PlanCard({
  name,
  priceLine,
  description,
  features,
  ctaLabel,
  onSelect,
  loading = false,
  highlight = false,
  disabled = false,
  footer,
}: PlanCardProps) {
  return (
    <Card className={highlight ? 'border-primary shadow-lg' : ''}>
      <CardHeader>
        <CardTitle className="text-2xl">{name}</CardTitle>
        <div className="mt-2 text-3xl font-bold">{priceLine}</div>
        {description && <CardDescription className="mt-2">{description}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-2">
        <ul className="space-y-2">
          {features.map((feature) => (
            <li key={feature} className="flex items-start gap-2">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
              <span className="text-sm">{feature}</span>
            </li>
          ))}
        </ul>
      </CardContent>
      <CardFooter className="flex-col gap-3">
        <Button
          className="w-full"
          variant={highlight ? 'default' : 'outline'}
          onClick={onSelect}
          disabled={disabled || loading || !onSelect}
        >
          {loading ? 'Redirigiendo…' : ctaLabel}
        </Button>
        {footer}
      </CardFooter>
    </Card>
  );
}
