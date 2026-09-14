import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ThirdwebProvider } from 'thirdweb/react';
import './globals.css';

/**
 * Fonts are loaded via plain <link> tags rather than `next/font/google`.
 * `next/font/google` needs network access to fonts.googleapis.com at BUILD
 * time (to fetch font metadata/files into the bundle) - this sandbox's
 * network egress blocks that host, the same class of restriction as the
 * Prisma binaries issue (see docs/CHECKPOINT.md). A plain <link> tag has no
 * such dependency: the browser fetches the font CSS at runtime, which works
 * identically here and in any real deployment. The only cost is an ESLint
 * `no-page-custom-font` warning, which is a legacy Pages Router concern and
 * doesn't apply to the App Router pattern used here.
 */

export const metadata: Metadata = {
  title: 'MOMOZUKI | Early Access',
  description: '555 hand-drawn companions. NFT-gated whitelist claim, no gas required.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Rampart+One&family=Zen+Maru+Gothic:wght@400;500;700;900&family=IBM+Plex+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <ThirdwebProvider>{children}</ThirdwebProvider>
      </body>
    </html>
  );
}
