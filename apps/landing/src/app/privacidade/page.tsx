import { LegalPage } from '@/components/legal-page';
import { buildMetadata, site } from '@/lib/site';

export const metadata = buildMetadata({
  title: 'Política de privacidade',
  description: 'Como a Freelas 4 Devs trata seus dados pessoais, em conformidade com a LGPD.',
  path: '/privacidade',
});

export default function PrivacyPage() {
  return (
    <LegalPage title="Política de privacidade" updatedAt="outubro de 2026">
      <p>
        Esta política explica quais dados a Freelas 4 Devs coleta neste site e por quê, conforme a
        Lei Geral de Proteção de Dados (Lei 13.709/2018). A versão completa, que cobrirá também o
        uso da plataforma, será publicada no lançamento.
      </p>
      <h2>Lista de espera</h2>
      <ul>
        <li>
          <strong>Dados coletados:</strong> nome, e-mail, se você quer contratar ou trabalhar como
          dev, sua principal stack (opcional) e a campanha que trouxe você até aqui (parâmetros
          UTM).
        </li>
        <li>
          <strong>Finalidade:</strong> avisar sobre o lançamento e convidar você para usar a
          plataforma.
        </li>
        <li>
          <strong>Base legal:</strong> seu consentimento, registrado com data e versão do texto
          aceito.
        </li>
        <li>
          <strong>Compartilhamento:</strong> não vendemos nem compartilhamos seus dados. Usamos
          fornecedores de infraestrutura (hospedagem e envio de e-mails) apenas para operar o
          serviço.
        </li>
      </ul>
      <h2>Navegação</h2>
      <p>
        Este site não usa cookies de rastreamento nem de publicidade. Quando há medição de
        audiência, ela é feita sem cookies e sem identificar você.
      </p>
      <h2>Seus direitos</h2>
      <p>
        Você pode pedir acesso, correção ou exclusão dos seus dados, ou retirar o consentimento, a
        qualquer momento, escrevendo para{' '}
        <a href={`mailto:${site.contactEmail}`} className="underline">
          {site.contactEmail}
        </a>
        .
      </p>
    </LegalPage>
  );
}
