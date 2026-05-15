import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Maity Recording',
};

export default function RecordingWidgetLayout({
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
