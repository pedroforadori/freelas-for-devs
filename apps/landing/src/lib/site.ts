import type { Metadata } from 'next';

export const site = {
  name: 'Freelas 4 Devs',
  url: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3001',
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
  allowIndexing: process.env.NEXT_PUBLIC_ALLOW_INDEXING === 'true',
  description:
    'Marketplace de freelancers de desenvolvimento: publique seu projeto de site, loja virtual, app ou sistema sem precisar saber quanto custa.',
} as const;

interface PageSeo {
  title: string;
  description: string;
  path: `/${string}`;
}

/** Metadata padronizada por página: título ≤ 60, descrição ≤ 155, canonical e Open Graph. */
export const buildMetadata = ({ title, description, path }: PageSeo): Metadata => ({
  title,
  description,
  alternates: { canonical: path },
  openGraph: {
    type: 'website',
    locale: 'pt_BR',
    siteName: site.name,
    url: path,
    title,
    description,
  },
  twitter: { card: 'summary_large_image', title, description },
});
