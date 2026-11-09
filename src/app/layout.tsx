import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { Nav } from '@/components/Nav';
import { ToastProvider, DISCLAIMER } from '@/components/ui';

export const metadata: Metadata = { title: 'Verity — Trust, verified at the source', description: 'Verify and monitor professional licences and business registrations against official registries.' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ToastProvider>
          <Nav />
          <main className="mx-auto max-w-6xl px-4 py-8 sm:py-10">{children}</main>
          <footer className="mx-auto max-w-6xl border-t border-line px-4 py-6">
            <p className="hint max-w-3xl">{DISCLAIMER}</p>
          </footer>
        </ToastProvider>
      </body>
    </html>
  );
}
