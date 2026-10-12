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
        Lei Geral de Proteção de Dados (Lei 13.709/2018), tanto na lista de espera quanto no uso da
        plataforma.
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
      <h2>Uso da plataforma</h2>
      <ul>
        <li>
          <strong>Conta:</strong> nome, e-mail, senha (guardada só como hash), papéis e, se você
          usar, o vínculo com GitHub ou Google (só e-mail e identificador). Finalidade: autenticar
          você e prestar o serviço. Base legal: execução do contrato.
        </li>
        <li>
          <strong>Perfil de dev:</strong> apresentação, stacks, links e portfólio, que você escolhe
          publicar para clientes. Base legal: execução do contrato.
        </li>
        <li>
          <strong>Projetos, propostas, entregas, mensagens e avaliações:</strong> o conteúdo que
          você envia para contratar ou trabalhar. Mensagens passam por uma triagem automática que
          remove telefone, e-mail e links pessoais; o texto original fica cifrado e é apagado após
          180 dias. Base legal: execução do contrato e legítimo interesse (segurança das partes e
          prevenção de fraude).
        </li>
        <li>
          <strong>Pagamentos:</strong> processados pela Stripe; não guardamos dados de cartão. Para
          receber, o dev faz o cadastro direto na Stripe. Guardamos valores, datas e o razão
          contábil por 5 anos. Base legal: obrigação legal e execução do contrato.
        </li>
        <li>
          <strong>Segurança:</strong> registros de acesso (IP, navegador e ações na conta) por no
          mínimo 6 meses, como exige o Marco Civil da Internet, para proteger sua conta e apurar
          fraudes.
        </li>
        <li>
          <strong>Estimativa por IA:</strong> o título e a descrição do seu projeto (nunca os
          anexos) são enviados ao provedor de IA para sugerir faixa de preço e prazo, revisada por
          um especialista. Não inclua dados pessoais na descrição.
        </li>
        <li>
          <strong>Operadores:</strong> Stripe (pagamentos), provedor de e-mail, provedor de IA,
          hospedagem, banco de dados e armazenamento em nuvem, e monitoramento de erros — cada um
          com contrato de tratamento de dados.
        </li>
      </ul>
      <h2>Seus direitos</h2>
      <p>
        Na plataforma, em <strong>Conta → Privacidade</strong>, você baixa todos os seus dados
        (JSON) e exclui sua conta. Na exclusão, apagamos perfil, portfólio e vínculos de login e
        anonimizamos a conta; contratos e pagamentos continuam registrados sem identificar você,
        pelo prazo legal, e mensagens que você enviou seguem visíveis para quem as recebeu como
        &ldquo;Conta excluída&rdquo;.
      </p>
      <p>
        Você também pode pedir acesso, correção ou exclusão dos seus dados, ou retirar o
        consentimento, a qualquer momento, escrevendo para{' '}
        <a href={`mailto:${site.contactEmail}`} className="underline">
          {site.contactEmail}
        </a>
        .
      </p>
    </LegalPage>
  );
}
