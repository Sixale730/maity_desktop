import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Maity Coach',
};

export default function CoachFloatLayout({
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
