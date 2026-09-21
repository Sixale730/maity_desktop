'use client'
// Origen: web Sixale730/maity@3ef2914 src/ui/components/ui/sonner.tsx
// Adaptaciones desktop: 'use client'; sin el eslint-disable de react-refresh (regla que el
// desktop no usa). El `position` default de la web (top-right) lo sobreescribe el
// <Toaster position="bottom-center" …> literal de app/(main)/layout.tsx (lo vigila layout.test.ts).
import { useEffect, useState } from "react"
import { Toaster as Sonner, toast } from "sonner"

type ToasterProps = React.ComponentProps<typeof Sonner>
type PortalTheme = "light" | "dark"

const readTheme = (): PortalTheme =>
  typeof document !== "undefined" && document.documentElement.dataset.portalTheme === "dark" ? "dark" : "light"

/**
 * Sigue el tema global del documento (`data-portal-theme`), que estampa `public/theme-boot.js`
 * antes del primer pintado y actualiza `DashboardTheme` al alternar. El Toaster se monta fuera
 * del router y del provider, así que no puede leer el contexto de React.
 */
function usePortalTheme(): PortalTheme {
  const [theme, setTheme] = useState<PortalTheme>(readTheme)
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(readTheme()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-portal-theme"] })
    setTheme(readTheme())
    return () => observer.disconnect()
  }, [])
  return theme
}

const Toaster = ({ ...props }: ToasterProps) => {
  const theme = usePortalTheme()

  return (
    <Sonner
      theme={theme}
      position="top-right"
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  )
}

export { Toaster, toast }
