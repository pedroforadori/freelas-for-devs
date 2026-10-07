import type { EmailMessage } from '../../../shared/application/mailer.js';

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

const layout = (
  title: string,
  body: string,
  cta: { label: string; url: string },
): string => `<!doctype html>
<html lang="pt-BR"><body style="margin:0;background:#f3f3f3;font-family:Arial,sans-serif;color:#191a23">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:560px;background:#fff;border:1px solid #191a23;border-radius:24px">
<tr><td style="padding:32px">
<p style="margin:0 0 24px;font-size:14px"><strong>Freelas 4 Devs</strong></p>
<h1 style="margin:0 0 16px;font-size:24px">${title}</h1>
${body}
<p style="margin:32px 0"><a href="${cta.url}" style="background:#191a23;color:#fff;padding:16px 28px;border-radius:14px;text-decoration:none;display:inline-block">${cta.label}</a></p>
<p style="margin:0;font-size:12px;color:#6b6c75">Se o botão não funcionar, copie este link: ${cta.url}</p>
</td></tr></table></td></tr></table></body></html>`;

export const verificationEmail = (
  to: string,
  displayName: string,
  url: string,
  ttlHours: number,
): EmailMessage => ({
  to,
  tag: 'auth.verify-email',
  subject: 'Confirme seu e-mail na Freelas 4 Devs',
  text: `Olá, ${displayName}!\n\nConfirme seu e-mail para continuar: ${url}\n\nO link vale por ${ttlHours} horas. Se você não criou esta conta, ignore esta mensagem.`,
  html: layout(
    `Olá, ${escapeHtml(displayName)}!`,
    `<p style="margin:0;line-height:1.5">Confirme seu e-mail para continuar. O link vale por ${ttlHours} horas.</p>
<p style="margin:16px 0 0;line-height:1.5;color:#6b6c75">Se você não criou esta conta, ignore esta mensagem.</p>`,
    { label: 'Confirmar e-mail', url },
  ),
});

export const passwordResetEmail = (
  to: string,
  displayName: string,
  url: string,
  ttlMinutes: number,
): EmailMessage => ({
  to,
  tag: 'auth.password-reset',
  subject: 'Redefina sua senha na Freelas 4 Devs',
  text: `Olá, ${displayName}!\n\nRecebemos um pedido para redefinir sua senha: ${url}\n\nO link vale por ${ttlMinutes} minutos. Se não foi você, ignore esta mensagem — sua senha continua a mesma.`,
  html: layout(
    `Olá, ${escapeHtml(displayName)}!`,
    `<p style="margin:0;line-height:1.5">Recebemos um pedido para redefinir sua senha. O link vale por ${ttlMinutes} minutos.</p>
<p style="margin:16px 0 0;line-height:1.5;color:#6b6c75">Se não foi você, ignore esta mensagem — sua senha continua a mesma.</p>`,
    { label: 'Redefinir senha', url },
  ),
});
