import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Maity Device Picker',
};

/**
 * Mini-ventana flotante para seleccionar dispositivos de audio (mic/sis)
 * desde el coach-float (iter 9). Body transparente para que la ventana Tauri
 * (transparent: true) muestre el blur del SO debajo. El root del page.tsx
 * aplica el efecto glass.
 */
export default function DevicePickerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body className="bg-transparent overflow-hidden">{children}</body>
    </html>
  );
}
