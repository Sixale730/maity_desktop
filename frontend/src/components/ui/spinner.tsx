// Origen: web Sixale730/maity@3ef2914 src/ui/components/ui/spinner.tsx
// Adaptaciones desktop: `cn` de @/lib/utils (el shim @maity/shared arrastra supabase-js);
// MaityLogo es el shim de src/shared/components/MaityLogo.tsx. `animate-spin-pause` está en
// tailwind.config.ts.
import { cn } from "@/lib/utils"
import { MaityLogo } from "@/shared/components/MaityLogo"

const sizeMap = {
  sm: { container: "w-6 h-6", logo: "sm" as const },
  md: { container: "w-8 h-8", logo: "sm" as const },
  lg: { container: "w-12 h-12", logo: "md" as const },
} as const

interface SpinnerProps {
  size?: keyof typeof sizeMap
  className?: string
}

export function Spinner({ size = "md", className }: SpinnerProps) {
  const { container, logo } = sizeMap[size]

  return (
    <output className={cn("inline-flex items-center justify-center", className)}>
      <div className={cn("animate-spin-pause", container)}>
        <MaityLogo variant="symbol" size={logo} className="w-full h-full" />
      </div>
      <span className="sr-only">Cargando...</span>
    </output>
  )
}
