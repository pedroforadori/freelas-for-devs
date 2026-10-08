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
