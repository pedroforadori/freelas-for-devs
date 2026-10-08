import { LegalPage } from '@/components/legal-page';
import { buildMetadata, site } from '@/lib/site';

export const metadata = buildMetadata({
  title: 'Termos de uso',
  description: 'Termos de uso da Freelas 4 Devs.',
  path: '/termos',
});

export default function TermsPage() {
  return (
    <LegalPage title="Termos de uso" updatedAt="outubro de 2026">
      <p>
        A Freelas 4 Devs está em pré-lançamento. Enquanto isso, este site apresenta a plataforma e
        recebe inscrições na lista de espera. Os termos completos de uso da plataforma —
        contratação, pagamento em custódia, entregas, disputas e responsabilidades de clientes e
        freelancers — serão publicados antes da abertura e precisarão ser aceitos no cadastro.
      </p>
      <p>
        Dúvidas:{' '}
        <a href={`mailto:${site.contactEmail}`} className="underline">
          {site.contactEmail}
        </a>
        .
      </p>
    </LegalPage>
  );
}
