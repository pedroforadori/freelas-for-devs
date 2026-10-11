import { simpleEmail as simple } from '../../../shared/application/simple-email.js';

export const paymentConfirmedClientEmail = (to: string, name: string, title: string, url: string) =>
  simple(
    to,
    'contracts.payment-confirmed',
    `Pagamento confirmado: ${title}`,
    [
      `Olá, ${name}! Recebemos o pagamento do projeto "${title}". O valor fica em custódia na plataforma e só é liberado ao dev quando você aprovar a entrega final.`,
      'O projeto já começou. Você acompanha as entregas por aqui.',
    ],
    { label: 'Ver projeto', url },
  );

export const workStartsFreelancerEmail = (to: string, name: string, title: string, url: string) =>
  simple(
    to,
    'contracts.work-starts',
    `Pode começar: ${title}`,
    [
      `Olá, ${name}! O cliente pagou o projeto "${title}" e o valor está em custódia na plataforma.`,
      'Você recebe ao final, depois da aprovação da entrega. Configure sua conta de recebimento, se ainda não fez.',
    ],
    { label: 'Ver projeto', url },
  );

export const paymentExpiredClientEmail = (to: string, name: string, title: string, url: string) =>
  simple(
    to,
    'contracts.payment-expired',
    `O prazo de pagamento terminou: ${title}`,
    [
      `Olá, ${name}. O prazo para pagar a proposta escolhida no projeto "${title}" terminou.`,
      'As outras propostas voltaram a valer: você pode escolher de novo quando quiser.',
    ],
    { label: 'Ver propostas', url },
  );

export const lateRefundEmail = (to: string, name: string, title: string, url: string) =>
  simple(
    to,
    'contracts.late-payment-refunded',
    `Pagamento devolvido: ${title}`,
    [
      `Olá, ${name}. Um pagamento do projeto "${title}" chegou depois que o contrato já tinha sido encerrado.`,
      'Por isso devolvemos o valor integral para o mesmo meio de pagamento. O prazo de compensação depende do banco.',
    ],
    { label: 'Ver projeto', url },
  );

export const deliverySubmittedEmail = (
  to: string,
  name: string,
  title: string,
  number: number,
  deadline: string,
  url: string,
) =>
  simple(
    to,
    'contracts.delivery-submitted',
    `${number === 3 ? 'Entrega final' : `${number}ª entrega`} recebida: ${title}`,
    [
      `Olá, ${name}! O dev enviou a ${number === 3 ? 'entrega final' : `${number}ª entrega`} do projeto "${title}".`,
      number === 3
        ? `Revise até ${deadline}. Sem resposta até lá, a entrega é aprovada automaticamente e o pagamento liberado.`
        : `Revise até ${deadline} e, se precisar, envie a lista de ajustes (uma lista por entrega). Sem resposta, o projeto segue para a próxima etapa sem ajustes.`,
    ],
    { label: 'Revisar entrega', url },
  );

export const deliveryReviewedEmail = (
  to: string,
  name: string,
  title: string,
  outcome: 'ADJUSTMENTS' | 'CORRECTION' | 'TIMEOUT',
  url: string,
) =>
  simple(
    to,
    `contracts.delivery-${outcome.toLowerCase()}`,
    outcome === 'TIMEOUT' ? `Siga para a próxima entrega: ${title}` : `Ajustes pedidos: ${title}`,
    [
      `Olá, ${name}!`,
      outcome === 'TIMEOUT'
        ? `O cliente não revisou a última entrega de "${title}" no prazo. Siga para a próxima etapa sem ajustes.`
        : `O cliente revisou a entrega de "${title}" e pediu ${outcome === 'CORRECTION' ? 'uma correção pontual' : 'ajustes'}. Veja a lista e envie a próxima entrega.`,
    ],
    { label: 'Ver contrato', url },
  );

export const approvedEmail = (
  to: string,
  name: string,
  title: string,
  automatic: boolean,
  needsAccount: boolean,
  url: string,
) =>
  simple(
    to,
    'contracts.approved',
    `Entrega aprovada: ${title}`,
    [
      automatic
        ? `Parabéns, ${name}! O prazo de revisão terminou e a entrega final do projeto "${title}" foi aprovada automaticamente.`
        : `Parabéns, ${name}! O cliente aprovou a entrega final do projeto "${title}".`,
      needsAccount
        ? 'Para receber, configure sua conta de recebimento: o repasse sai assim que ela estiver pronta.'
        : 'O repasse do pagamento já foi solicitado ao nosso parceiro de pagamentos.',
    ],
    { label: needsAccount ? 'Configurar recebimentos' : 'Ver contrato', url },
  );

export const releasedEmail = (
  to: string,
  name: string,
  title: string,
  amount: string,
  url: string,
) =>
  simple(
    to,
    'contracts.released',
    `Pagamento liberado: ${title}`,
    [
      `Olá, ${name}! Repassamos ${amount} referentes ao projeto "${title}" para a sua conta de recebimento.`,
      'O prazo para o dinheiro cair na conta bancária depende do parceiro de pagamentos.',
    ],
    { label: 'Ver contrato', url },
  );
