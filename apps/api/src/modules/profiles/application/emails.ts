import { simpleEmail as simple } from '../../../shared/application/simple-email.js';

export const profileApprovedEmail = (to: string, name: string, levelName: string, url: string) =>
  simple(
    to,
    'profiles.approved',
    'Seu perfil foi aprovado!',
    [
      `Olá, ${name}! Seu perfil de freelancer foi aprovado no nível ${levelName}.`,
      'A partir de agora você entra na fila de distribuição e começa a receber convites de projetos compatíveis com suas stacks — sem pagar nada por destaque.',
    ],
    { label: 'Ver meu perfil', url },
  );

export const profileChangesRequestedEmail = (
  to: string,
  name: string,
  reason: string,
  url: string,
) =>
  simple(
    to,
    'profiles.changes-requested',
    'Ajustes no seu perfil',
    [
      `Olá, ${name}! Analisamos seu perfil e precisamos de alguns ajustes antes de aprovar:`,
      reason,
      'Depois de ajustar, envie novamente para análise.',
    ],
    { label: 'Ajustar perfil', url },
  );

export const levelChangedEmail = (
  to: string,
  name: string,
  levelName: string,
  url: string,
  reason?: string,
) =>
  simple(
    to,
    'profiles.level-changed',
    `Seu nível agora é ${levelName}`,
    [
      `Olá, ${name}! Seu nível na plataforma foi atualizado para ${levelName}.`,
      ...(reason ? [reason] : []),
    ],
    { label: 'Ver meu perfil', url },
  );
