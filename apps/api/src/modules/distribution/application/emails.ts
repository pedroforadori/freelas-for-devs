import { simpleEmail as simple } from '../../../shared/application/simple-email.js';

export const invitationEmail = (
  to: string,
  name: string,
  title: string,
  hours: number,
  url: string,
) =>
  simple(
    to,
    'distribution.invitation',
    `Novo convite: ${title}`,
    [
      `Olá, ${name}! Você chegou à frente da fila e foi convidado para o projeto "${title}".`,
      `O escopo já foi fechado com um especialista. Responda em até ${hours} horas: envie sua proposta dentro da faixa aprovada ou recuse para passar a vez.`,
    ],
    { label: 'Ver convite', url },
  );

export const newProposalEmail = (to: string, name: string, title: string, url: string) =>
  simple(
    to,
    'distribution.new-proposal',
    `Nova proposta para "${title}"`,
    [
      `Olá, ${name}! Seu projeto "${title}" recebeu uma nova proposta.`,
      'Compare valor, prazo e o portfólio de cada dev. Você pode escolher quando quiser.',
    ],
    { label: 'Ver propostas', url },
  );

export const selectedEmail = (to: string, name: string, title: string, url: string) =>
  simple(
    to,
    'distribution.selected',
    `Sua proposta foi escolhida: ${title}`,
    [
      `Parabéns, ${name}! O cliente escolheu a sua proposta para "${title}".`,
      'Assim que o pagamento for confirmado (em custódia na plataforma), o projeto começa. Avisamos você por e-mail.',
    ],
    { label: 'Ver proposta', url },
  );
