import { simpleEmail as simple } from '../../../shared/application/simple-email.js';

export const clarificationNeededEmail = (to: string, name: string, title: string, url: string) =>
  simple(
    to,
    'projects.clarification-needed',
    'Precisamos de 2 ou 3 respostas sobre o seu projeto',
    [
      `Olá, ${name}! Para estimar o projeto "${title}" com mais precisão, faltam algumas informações.`,
      'São perguntas rápidas, de múltipla escolha. Assim que você responder, a estimativa fica pronta.',
    ],
    { label: 'Responder agora', url },
  );

export const estimateReadyEmail = (to: string, name: string, title: string, url: string) =>
  simple(
    to,
    'projects.estimate-ready',
    'A estimativa do seu projeto está pronta',
    [
      `Olá, ${name}! A estimativa preliminar do projeto "${title}" está pronta, com faixa de preço e prazo.`,
      'O próximo passo é fechar o escopo com um especialista da plataforma. Ele entra em contato por aqui.',
    ],
    { label: 'Ver estimativa', url },
  );

export const scopeApprovedEmail = (to: string, name: string, title: string, url: string) =>
  simple(
    to,
    'projects.scope-approved',
    'O escopo do seu projeto foi aprovado',
    [
      `Olá, ${name}! O escopo do projeto "${title}" foi fechado pelo especialista, com faixa de preço, prazo e critérios de aceite.`,
      'O próximo passo é a distribuição: devs compatíveis são convidados em rodadas e enviam propostas dentro da faixa aprovada. Você não paga nada até escolher uma.',
    ],
    { label: 'Ver escopo', url },
  );

export const projectRejectedEmail = (
  to: string,
  name: string,
  title: string,
  reason: string,
  url: string,
) =>
  simple(
    to,
    'projects.rejected',
    'Não pudemos aceitar o seu projeto',
    [
      `Olá, ${name}. Analisamos o projeto "${title}" e não vamos poder publicá-lo na plataforma.`,
      `Motivo: ${reason}`,
      'Se quiser, descreva de novo com mais detalhes ou responda este e-mail.',
    ],
    { label: 'Ver projeto', url },
  );
