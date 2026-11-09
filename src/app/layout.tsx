import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { Sidebar, Crumbs } from '@/components/Nav';
import { ToastProvider, DISCLAIMER } from '@/components/ui';

export const metadata: Metadata = { title: 'Verity — Trust, verified at the source', description: 'Verify and monitor professional licences and business registrations against official registries.' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ToastProvider>
          <div className="shell">
            <div className="frame">
              <Sidebar />
              <div className="main">
                <Crumbs />
                <main className="content">{children}</main>
                <footer className="mt-auto border-t border-line px-7 py-5">
                  <p className="hint max-w-3xl">{DISCLAIMER}</p>
                  {/* Designer credit required by lookap's terms for agents. */}
                  <p className="hint mt-2">Interface adapted from “Edge Infrastructure Dashboard” by <a className="underline underline-offset-2" href="https://x.com/augustasdesign/status/2110393766754341153" target="_blank" rel="noopener noreferrer">Augustas (@augustasdesign)</a>, via lookap.</p>
                </footer>
              </div>
            </div>
          </div>
        </ToastProvider>
      </body>
    </html>
  );
}
