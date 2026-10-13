import type { Metadata } from 'next';

export const site = {
  name: 'Freelas 4 Devs',
  url: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3001',
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3010',
  allowIndexing: process.env.NEXT_PUBLIC_ALLOW_INDEXING === 'true',
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3333',
  /**
   * Antes do lançamento, todos os CTAs levam à lista de espera; depois, ao cadastro no app.
   * Troca por variável de ambiente, sem deploy de código.
   */
  appLive: process.env.NEXT_PUBLIC_APP_LIVE === 'true',
  contactEmail: process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? 'contato@freelas4devs.com.br',
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

/**
 * Destino dos CTAs conforme a fase (lista de espera ou app no ar). O cliente vai direto ao
 * rascunho do projeto, sem cadastro; `projectType` pré-seleciona o tipo no formulário.
 */
export const ctaHref = (audience: 'client' | 'freelancer', projectType?: string): string => {
  if (!site.appLive) return '#lista-de-espera';
  if (audience === 'freelancer') return `${site.appUrl}/cadastro?perfil=freelancer`;
  return `${site.appUrl}/novo-projeto${projectType ? `?tipo=${projectType}` : ''}`;
};
