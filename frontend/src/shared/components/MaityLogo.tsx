/**
 * Shim para `@/shared/components/MaityLogo` — el componente que la web usa
 * en el rail, sidebar y empty state. El desktop ya tiene su propio Logo en
 * `@/components/shared/Logo`, pero con API diferente (Dialog wrapper +
 * isCollapsed). Aquí exponemos la API esperada por el web.
 *
 * Va en `src/shared/components/MaityLogo.tsx`.
 *
 * Logo source: usa el mismo `/logo-collapsed.png` que ya está en `public/`.
 * Si tu logo símbolo está en otro path, cambia SYMBOL_SRC.
 */
'use client'

import Image from 'next/image'

const SYMBOL_SRC = '/logo-collapsed.png'  // viene del public/ del desktop

interface MaityLogoProps {
  variant?: 'symbol' | 'full'
  size?: 'xs' | 'sm' | 'md' | 'lg'
  className?: string
}

const SIZE_PX: Record<NonNullable<MaityLogoProps['size']>, number> = {
  xs: 16,
  sm: 22,
  md: 28,
  lg: 40,
}

export function MaityLogo({
  variant: _variant = 'symbol',
  size = 'sm',
  className,
}: MaityLogoProps) {
  const px = SIZE_PX[size]
  // `variant="full"` mostraría logo + wordmark. La web solo usa `symbol`
  // en los lugares donde montamos el shell v5, así que mapeamos full → symbol.
  return (
    <Image
      src={SYMBOL_SRC}
      alt="Maity"
      width={px}
      height={px}
      className={className}
      priority
    />
  )
}

export default MaityLogo
