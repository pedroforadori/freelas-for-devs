import { faq } from '@/content/home';
import { site } from './site';

/** Dados estruturados (schema.org) da home: FAQ e serviço. Strings vêm de constantes, não do usuário. */
export const homeJsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'FAQPage',
      mainEntity: faq.map((item) => ({
        '@type': 'Question',
        name: item.question,
        acceptedAnswer: { '@type': 'Answer', text: item.answer },
      })),
    },
    {
      '@type': 'Service',
      name: 'Contratação de desenvolvedores freelancers',
      serviceType: 'Desenvolvimento de software sob demanda',
      provider: { '@type': 'Organization', name: site.name, url: site.url },
      areaServed: { '@type': 'Country', name: 'Brasil' },
      description: site.description,
    },
  ],
};

/** Serializa para <script type="application/ld+json"> escapando `<` (evita fechar a tag). */
export const jsonLdScript = (data: unknown): string =>
  JSON.stringify(data).replace(/</g, '\\u003c');
