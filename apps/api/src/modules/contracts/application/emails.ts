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
