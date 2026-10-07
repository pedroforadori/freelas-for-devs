import type { EmailMessage } from '../../../shared/application/mailer.js';

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

const simple = (
  to: string,
  tag: string,
  subject: string,
  paragraphs: string[],
  cta: { label: string; url: string },
): EmailMessage => ({
  to,
  tag,
  subject,
  text: `${paragraphs.join('\n\n')}\n\n${cta.label}: ${cta.url}`,
  html: `<!doctype html><html lang="pt-BR"><body style="font-family:Arial,sans-serif;color:#191a23;background:#f3f3f3;padding:32px 16px">
<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #191a23;border-radius:24px;padding:32px">
<p style="margin:0 0 24px;font-size:14px"><strong>Freelas 4 Devs</strong></p>
${paragraphs.map((p) => `<p style="line-height:1.5">${escapeHtml(p)}</p>`).join('\n')}
<p style="margin:32px 0 0"><a href="${cta.url}" style="background:#191a23;color:#fff;padding:16px 28px;border-radius:14px;text-decoration:none;display:inline-block">${cta.label}</a></p>
</div></body></html>`,
});

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

export const levelChangedEmail = (to: string, name: string, levelName: string, url: string) =>
  simple(
    to,
    'profiles.level-changed',
    `Seu nível agora é ${levelName}`,
    [`Olá, ${name}! Seu nível na plataforma foi atualizado para ${levelName}.`],
    { label: 'Ver meu perfil', url },
  );
