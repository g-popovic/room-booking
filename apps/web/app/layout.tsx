import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Roomwell — Meeting room bookings',
  description: 'Browse and reserve meeting rooms at the Commons.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
