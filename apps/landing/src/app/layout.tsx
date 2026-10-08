import type { Metadata } from 'next';
import { Space_Grotesk } from 'next/font/google';
import type { ReactNode } from 'react';
import Script from 'next/script';
import { jsonLdScript } from '@/lib/jsonld';
import { site } from '@/lib/site';
import './globals.css';

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-space-grotesk',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: `${site.name} — freelancers de desenvolvimento`,
    template: `%s · ${site.name}`,
  },
  description: site.description,
  robots: site.allowIndexing ? { index: true, follow: true } : { index: false, follow: false },
};

const organizationJsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'Organization', name: site.name, url: site.url },
    { '@type': 'WebSite', name: site.name, url: site.url, inLanguage: 'pt-BR' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className={spaceGrotesk.variable}>
      <body className="min-h-dvh font-sans">
        {children}
        {/* Analytics sem cookies (Plausible): dispensa banner de consentimento (LGPD). Opcional. */}
        {process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN ? (
          <Script
            src="https://plausible.io/js/script.outbound-links.js"
            data-domain={process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN}
            strategy="lazyOnload"
          />
        ) : null}
        <script
          type="application/ld+json"
          // JSON estático gerado no servidor a partir de constantes; sem entrada de usuário.
          dangerouslySetInnerHTML={{ __html: jsonLdScript(organizationJsonLd) }}
        />
      </body>
    </html>
  );
}
